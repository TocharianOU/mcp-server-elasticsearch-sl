#!/usr/bin/env node

/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client, estypes, ClientOptions } from "@elastic/elasticsearch";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { randomUUID } from "crypto";
import fs from "fs";
import { checkTokenLimit, calculateTokens } from "./src/token-limiter.js";
import { 
  generateIndexSummary, 
  formatSummaryText,
  formatCompactSummary,
  formatMinimalSummary,
  generateSuggestions 
} from "./src/index-analyzer.js";
import {
  analyzeShardHealth,
  formatShardSummary,
  formatShardProblems,
  generateShardRecommendations
} from "./src/shard-analyzer.js";

// Configuration schema with auth options
const ConfigSchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1, "Elasticsearch URL cannot be empty")
      .url("Invalid Elasticsearch URL format")
      .describe("Elasticsearch server URL"),

    apiKey: z
      .string()
      .optional()
      .describe("API key for Elasticsearch authentication"),

    username: z
      .string()
      .optional()
      .describe("Username for Elasticsearch authentication"),

    password: z
      .string()
      .optional()
      .describe("Password for Elasticsearch authentication"),

    caCert: z
      .string()
      .optional()
      .describe("Path to custom CA certificate for Elasticsearch"),
  })
  .refine(
    (data) => {
      // If username is provided, password must be provided
      if (data.username) {
        return !!data.password;
      }

      // If password is provided, username must be provided
      if (data.password) {
        return !!data.username;
      }

      // If apiKey is provided, it's valid
      if (data.apiKey) {
        return true;
      }

      // No auth is also valid (for local development)
      return true;
    },
    {
      message:
        "Either ES_API_KEY or both ES_USERNAME and ES_PASSWORD must be provided, or no auth for local development",
      path: ["username", "password"],
    }
  );

type ElasticsearchConfig = z.infer<typeof ConfigSchema>;


// Add ML related type definitions
interface MlJobStats {
  processed_record_count?: number;
  processed_field_count?: number;
  input_bytes?: number;
  input_field_count?: number;
  invalid_date_count?: number;
  missing_field_count?: number;
  out_of_order_timestamp_count?: number;
  empty_bucket_count?: number;
  sparse_bucket_count?: number;
}

interface ExtendedMlJob {
  job_id: string;
  description?: string;
  create_time?: string;
  finished_time?: string;
  model_snapshot_id?: string;
  job_state?: string;
  data_counts?: MlJobStats;
}

// ML Job Creation Types
interface DetectorConfig {
  detector_description?: string;
  function: string;
  field_name?: string;
  by_field_name?: string;
  over_field_name?: string;
  partition_field_name?: string;
  use_null?: boolean;
  exclude_frequent?: "all" | "none" | "by" | "over";
}

interface AnalysisConfig {
  bucket_span: string;
  detectors: DetectorConfig[];
  influencers?: string[];
  summary_count_field_name?: string;
  categorization_field_name?: string;
  categorization_filters?: string[];
  latency?: string;
  multivariate_by_fields?: boolean;
}

interface DataDescription {
  time_field: string;
  time_format?: string;
  field_delimiter?: string;
  format?: string;
}

interface AnalysisLimits {
  model_memory_limit?: string;
  categorization_examples_limit?: number;
}

interface ModelPlotConfig {
  enabled: boolean;
  annotations_enabled?: boolean;
  terms?: string[];
}

interface DatafeedConfig {
  indices: string[];
  query?: Record<string, any>;
  runtime_mappings?: Record<string, any>;
  datafeed_id?: string;
  scroll_size?: number;
  frequency?: string;
  delayed_data_check_config?: {
    enabled: boolean;
    check_window?: string;
  };
}

interface CreateMlJobRequest {
  analysis_config: AnalysisConfig;
  data_description: DataDescription;
  description?: string;
  groups?: string[];
  analysis_limits?: AnalysisLimits;
  model_plot_config?: ModelPlotConfig;
  results_index_name?: string;
  allow_lazy_open?: boolean;
  datafeed_config?: DatafeedConfig;
}


export async function createElasticsearchMcpServer(
  config: ElasticsearchConfig
) {
  const validatedConfig = ConfigSchema.parse(config);
  const { url, apiKey, username, password, caCert } = validatedConfig;

  // Get token limit configuration
  const maxTokenCall = parseInt(process.env.MAX_TOKEN_CALL || "20000", 10);

  const clientOptions: ClientOptions = {
    node: url,
    maxRetries: 5,
    requestTimeout: 60000, // 60 seconds
    compression: true
  };

  // Set up authentication
  if (apiKey) {
    clientOptions.auth = { apiKey };
  } else if (username && password) {
    clientOptions.auth = { username, password };
  }

  // Set up SSL/TLS certificate if provided
  if (caCert) {
    try {
      const ca = fs.readFileSync(caCert);
      clientOptions.tls = { ca };
    } catch (error) {
      console.error(
        `Failed to read certificate file: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const esClient = new Client(clientOptions);

  const server = new McpServer({
    name: "elasticsearch-mcp-server-js",
    version: "0.3.0",
  });

  // Tool 1: List indices with smart detection and filtering
  server.tool(
    "list_indices",
    "List all available Elasticsearch indices with smart filtering and analysis for large index sets",
    {
      pattern: z
        .string()
        .optional()
        .describe("Index pattern filter (e.g., 'logs-*', 'metrics-2024.*', '.ds-*'). Supports wildcards."),
      
      summary_mode: z
        .boolean()
        .optional()
        .default(false)
        .describe("Return only summary statistics instead of full list. Useful for large index sets."),
      
      summary_level: z
        .enum(["auto", "full", "compact", "minimal"])
        .optional()
        .default("auto")
        .describe("Summary detail level: auto (intelligent based on size), full (all patterns), compact (top patterns only), minimal (stats only)"),
      
      top_patterns: z
        .number()
        .optional()
        .default(20)
        .describe("In compact mode, show top N patterns (default: 20, range: 5-50)"),
      
      max_display: z
        .number()
        .optional()
        .default(100)
        .describe("Maximum number of indices to display in detail (default: 100). Set to 0 for summary only."),
      
      sort_by: z
        .enum(["name", "docs", "health"])
        .optional()
        .default("name")
        .describe("Sort indices by: name (default), docs (document count), or health"),
      
      health_filter: z
        .enum(["green", "yellow", "red"])
        .optional()
        .describe("Filter by health status: green, yellow, or red"),
      
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to bypass token limits in critical situations"),
    },
    async ({ pattern, summary_mode, summary_level, top_patterns, max_display, sort_by, health_filter, break_token_rule }) => {
      try {
        const AUTO_SUMMARY_THRESHOLD = 200;

        // Fetch indices with optional pattern (including hidden indices)
        const response = await esClient.cat.indices({ 
          format: "json",
          index: pattern || "*",
          expand_wildcards: "all", // Include open, closed, and hidden indices
          h: "index,health,status,docs.count,store.size,pri.store.size"
        });

        let indicesInfo = response.map((index: any) => ({
          index: index.index || index['index'],
          health: index.health || index['health'],
          status: index.status || index['status'],
          docsCount: index['docs.count'] || index.docsCount || '0',
          storeSize: index['store.size'] || index.storeSize,
          priStoreSize: index['pri.store.size'] || index.priStoreSize,
        }));

        // Apply health filter
        if (health_filter) {
          indicesInfo = indicesInfo.filter((idx: any) => idx.health === health_filter);
        }

        // Apply sorting
        if (sort_by === "docs") {
          indicesInfo.sort((a: any, b: any) => 
            parseInt(b.docsCount || '0') - parseInt(a.docsCount || '0')
          );
        } else if (sort_by === "health") {
          const healthOrder = { green: 0, yellow: 1, red: 2 };
          indicesInfo.sort((a: any, b: any) => 
            (healthOrder[a.health as keyof typeof healthOrder] || 3) - 
            (healthOrder[b.health as keyof typeof healthOrder] || 3)
          );
        } else {
          indicesInfo.sort((a: any, b: any) => a.index.localeCompare(b.index));
        }

        const totalCount = indicesInfo.length;
        const isLargeSet = totalCount > AUTO_SUMMARY_THRESHOLD;

        // Decide whether to use summary mode
        const useSummary = summary_mode || (isLargeSet && max_display === 100) || max_display === 0;

        let resultText = '';

        if (useSummary) {
          // Calculate original data tokens (if we returned full details)
          const originalFullData = JSON.stringify(indicesInfo, null, 2);
          const originalTokens = calculateTokens(originalFullData);
          
          // Generate summary view with intelligent level selection
          const summary = generateIndexSummary(indicesInfo);
          let actualLevel = summary_level || "auto";
          let autoSwitchMessage = '';
          
          // Auto mode: try levels until one fits
          if (actualLevel === "auto") {
            // Try full first
            const fullText = formatSummaryText(summary);
            const fullTokens = calculateTokens(fullText);
            
            if (fullTokens <= maxTokenCall || break_token_rule) {
              resultText = fullText;
              actualLevel = "full";
            } else {
              // Full exceeds, try compact
              const compactText = formatCompactSummary(summary, top_patterns || 20);
              const compactTokens = calculateTokens(compactText);
              
              if (compactTokens <= maxTokenCall || break_token_rule) {
                resultText = compactText;
                actualLevel = "compact";
                autoSwitchMessage = `⚠️  Full summary would exceed token limit (${fullTokens.toLocaleString()} tokens).\n` +
                                   `Auto-switched to compact mode.\n\n`;
              } else {
                // Compact also exceeds, use minimal
                resultText = formatMinimalSummary(summary);
                actualLevel = "minimal";
                autoSwitchMessage = `⚠️  Full (${fullTokens.toLocaleString()}) and Compact (${compactTokens.toLocaleString()}) summaries exceed token limit.\n` +
                                   `Auto-switched to minimal mode for extreme-scale cluster.\n\n`;
              }
            }
          } else {
            // Manual level selection
            switch (actualLevel) {
              case "full":
                resultText = formatSummaryText(summary);
                break;
              case "compact":
                resultText = formatCompactSummary(summary, top_patterns || 20);
                break;
              case "minimal":
                resultText = formatMinimalSummary(summary);
                break;
            }
          }
          
          // Calculate optimized tokens
          const optimizedTokens = calculateTokens(resultText);
          const tokenSavings = originalTokens - optimizedTokens;
          const savingsPercent = ((tokenSavings / originalTokens) * 100).toFixed(1);
          
          // Add token statistics
          resultText += `\n${'='.repeat(60)}\n`;
          resultText += `📊 Token Usage Statistics:\n`;
          resultText += `   Summary Level:           ${actualLevel}\n`;
          resultText += `   Original (full data):    ${originalTokens.toLocaleString()} tokens\n`;
          resultText += `   Optimized (summary):     ${optimizedTokens.toLocaleString()} tokens\n`;
          resultText += `   Saved:                   ${tokenSavings.toLocaleString()} tokens (${savingsPercent}% reduction)\n`;
          resultText += `   Max allowed per call:    ${maxTokenCall.toLocaleString()} tokens\n`;
          
          // Prepend auto-switch message if any
          if (autoSwitchMessage) {
            resultText = autoSwitchMessage + resultText;
          } else if (isLargeSet && !summary_mode && actualLevel !== "minimal") {
            resultText = `⚠️  Large index set detected (${totalCount} indices).\n` +
                        `Auto-switched to summary mode.\n\n` +
                        resultText;
          }

          // Add suggestions
          resultText += generateSuggestions(summary, !!pattern);

        } else {
          // Detailed view with limit
          const displayCount = Math.min(totalCount, max_display || 100);
          const displayIndices = indicesInfo.slice(0, displayCount);

          resultText = `Found ${totalCount} indices`;
          if (pattern) {
            resultText += ` matching pattern '${pattern}'`;
          }
          if (health_filter) {
            resultText += ` with health '${health_filter}'`;
          }
          if (totalCount > displayCount) {
            resultText += `\nShowing first ${displayCount} of ${totalCount} indices`;
            resultText += `\n\n💡 Use 'pattern' parameter to narrow down results, or set summary_mode: true for overview`;
          }

          const detailedList = displayIndices.map((idx: any) => {
            const healthIcon = idx.health === 'green' ? '🟢' : 
                             idx.health === 'yellow' ? '🟡' : '🔴';
            return {
              name: idx.index,
              health: `${healthIcon} ${idx.health}`,
              status: idx.status,
              docs: parseInt(idx.docsCount || '0').toLocaleString(),
              size: idx.storeSize || 'N/A'
            };
          });

          const result = {
            content: [
              {
                type: "text" as const,
                text: resultText,
              },
              {
                type: "text" as const,
                text: JSON.stringify(detailedList, null, 2),
              },
            ],
          };

          // Check token limit before returning detailed view
          const tokenCheck = checkTokenLimit(result, maxTokenCall, break_token_rule);
          if (!tokenCheck.allowed) {
            // Fall back to summary mode with intelligent level selection
            const originalFullData = JSON.stringify(indicesInfo, null, 2);
            const originalTokens = calculateTokens(originalFullData);
            
            const summary = generateIndexSummary(indicesInfo);
            let fallbackText = '';
            let actualLevel = 'full';
            
            // Try different summary levels
            const fullText = formatSummaryText(summary);
            const fullTokens = calculateTokens(fullText);
            
            if (fullTokens <= maxTokenCall) {
              fallbackText = fullText;
              actualLevel = 'full';
            } else {
              const compactText = formatCompactSummary(summary, top_patterns || 20);
              const compactTokens = calculateTokens(compactText);
              
              if (compactTokens <= maxTokenCall) {
                fallbackText = compactText;
                actualLevel = 'compact';
              } else {
                fallbackText = formatMinimalSummary(summary);
                actualLevel = 'minimal';
              }
            }
            
            const optimizedTokens = calculateTokens(fallbackText);
            const tokenSavings = originalTokens - optimizedTokens;
            const savingsPercent = ((tokenSavings / originalTokens) * 100).toFixed(1);
            
            let resultMessage = `⚠️  Token limit would be exceeded with detailed view (${tokenCheck.tokens.toLocaleString()} tokens).\n` +
                               `Auto-switched to ${actualLevel} summary mode.\n\n` +
                               fallbackText;
            
            // Add token statistics
            resultMessage += `\n${'='.repeat(60)}\n`;
            resultMessage += `📊 Token Usage Statistics:\n`;
            resultMessage += `   Summary Level:           ${actualLevel}\n`;
            resultMessage += `   Original (full data):    ${originalTokens.toLocaleString()} tokens\n`;
            resultMessage += `   Optimized (summary):     ${optimizedTokens.toLocaleString()} tokens\n`;
            resultMessage += `   Saved:                   ${tokenSavings.toLocaleString()} tokens (${savingsPercent}% reduction)\n`;
            resultMessage += `   Max allowed per call:    ${maxTokenCall.toLocaleString()} tokens\n`;
            
            resultMessage += generateSuggestions(summary, !!pattern);
            resultMessage += `\n\n💡 Use 'pattern' to filter, or set break_token_rule: true to force detailed view`;
            
            return {
              content: [
                {
                  type: "text" as const,
                  text: resultMessage,
                },
              ],
            };
          }

          return result;
        }

        // Return summary view
        return {
          content: [
            {
              type: "text" as const,
              text: resultText,
            },
          ],
        };

      } catch (error) {
        console.error(
          `Failed to list indices: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );

  // Tool 2: Get mappings for an index
  server.tool(
    "get_mappings",
    "Get field mappings for a specific Elasticsearch index",
    {
      index: z
        .string()
        .trim()
        .min(1, "Index name is required")
        .describe("Name of the Elasticsearch index to get mappings for"),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to bypass token limits in critical situations"),
    },
    async ({ index, break_token_rule }) => {
      try {
        const mappingResponse = await esClient.indices.getMapping({
          index,
        });

        const result = {
          content: [
            {
              type: "text" as const,
              text: `Mappings for index: ${index}`,
            },
            {
              type: "text" as const,
              text: `Mappings for index ${index}: ${JSON.stringify(
                mappingResponse[index]?.mappings || {},
                null,
                2
              )}`,
            },
          ],
        };

        // Check token limit
        const tokenCheck = checkTokenLimit(result, maxTokenCall, break_token_rule);
        if (!tokenCheck.allowed) {
          return {
            content: [
              {
                type: "text" as const,
                text: tokenCheck.error!,
              },
            ],
            isError: true,
          };
        }

        return result;
      } catch (error) {
        console.error(
          `Failed to get mappings: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );

  // Tool 3: Search an index with simplified parameters
  server.tool(
    "es_search",
    "Perform an Elasticsearch search with the provided query DSL. Highlights are always enabled.",
    {
      index: z
        .string()
        .trim()
        .min(1, "Index name is required")
        .describe("Name of the Elasticsearch index to search"),

      queryBody: z
        .record(z.any())
        .refine(
          (val) => {
            try {
              JSON.parse(JSON.stringify(val));
              return true;
            } catch (e) {
              return false;
            }
          },
          {
            message: "queryBody must be a valid Elasticsearch query DSL object",
          }
        )
        .describe(
          "Complete Elasticsearch query DSL object that can include query, size, from, sort, etc."
        ),
      
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to bypass token limits in critical situations. Use sparingly to avoid context overflow."),
    },
    async ({ index, queryBody, break_token_rule }) => {
      try {
        // Get mappings to identify text fields for highlighting
        const mappingResponse = await esClient.indices.getMapping({
          index,
        });

        const indexMappings = mappingResponse[index]?.mappings || {};

        const searchRequest: estypes.SearchRequest = {
          index,
          ...queryBody,
          timeout: '30s' // Set timeout for specific queries
        };

        // Always do highlighting
        if (indexMappings.properties) {
          const textFields: Record<string, estypes.SearchHighlightField> = {};

          for (const [fieldName, fieldData] of Object.entries(
            indexMappings.properties
          )) {
            if (fieldData.type === "text" || "dense_vector" in fieldData) {
              textFields[fieldName] = {};
            }
          }

          searchRequest.highlight = {
            fields: textFields,
            pre_tags: ["<em>"],
            post_tags: ["</em>"],
          };
        }

        const result = await esClient.search(searchRequest);

        // Extract the 'from' parameter from queryBody, defaulting to 0 if not provided
        const from = queryBody.from || 0;

        const contentFragments = result.hits.hits.map((hit) => {
          const highlightedFields = hit.highlight || {};
          const sourceData = hit._source || {};

          let content = "";

          for (const [field, highlights] of Object.entries(highlightedFields)) {
            if (highlights && highlights.length > 0) {
              content += `${field} (highlighted): ${highlights.join(
                " ... "
              )}\n`;
            }
          }

          for (const [field, value] of Object.entries(sourceData)) {
            if (!(field in highlightedFields)) {
              content += `${field}: ${JSON.stringify(value)}\n`;
            }
          }

          return {
            type: "text" as const,
            text: content.trim(),
          };
        });

        const metadataFragment = {
          type: "text" as const,
          text: `Total results: ${
            typeof result.hits.total === "number"
              ? result.hits.total
              : result.hits.total?.value || 0
          }, showing ${result.hits.hits.length} from position ${from}`,
        };

        let aggregationFragments = [];
        if (result.aggregations) {
          aggregationFragments.push({
            type: "text" as const,
            text: `Aggregation results:\n${JSON.stringify(result.aggregations, null, 2)}`,
          });
        }

        const resultContent = {
          content: [
            metadataFragment,
            ...aggregationFragments,
            ...contentFragments,
          ],
        };

        // Check token limit
        const tokenCheck = checkTokenLimit(resultContent, maxTokenCall, break_token_rule);
        if (!tokenCheck.allowed) {
          return {
            content: [
              {
                type: "text" as const,
                text: tokenCheck.error || "Token limit exceeded",
              },
            ],
            isError: true,
          };
        }

        return resultContent;
      } catch (error) {
        console.error(
          `Search failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );


  // Tool 4: Execute any Elasticsearch API
  server.tool(
    "execute_es_api",
    "Execute any Elasticsearch API endpoint directly",
    {
      method: z
        .enum(["GET", "POST", "PUT", "DELETE", "HEAD"])
        .describe("HTTP method to use for the request"),
      path: z
        .string()
        .trim()
        .min(1)
        .describe("The API endpoint path (e.g., '_search', 'my_index/_search', '_cluster/health')"),
      params: z
        .record(z.any())
        .optional()
        .describe("Optional URL parameters for the request"),
      body: z
        .record(z.any())
        .optional()
        .describe("Optional request body as a JavaScript object"),
      headers: z
        .record(z.string())
        .optional()
        .describe("Optional HTTP headers for the request"),
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to bypass token limits in critical situations. Use sparingly to avoid context overflow."),
    },
    async ({ method, path, params, body, headers, break_token_rule }) => {
      try {
        // Sanitize the path (remove leading slash if present)
        const sanitizedPath = path.startsWith('/') ? path.substring(1) : path;
        
        // Ensure Content-Type is set correctly
        let customHeaders = headers || {};
        if (body && !customHeaders['Content-Type']) {
          customHeaders['Content-Type'] = 'application/json';
        }
        
        // Prepare the request options
        const options: any = {
          method,
          path: sanitizedPath,
          querystring: params || {},
          body: body || undefined,
          headers: customHeaders
        };

        // Execute the request
        const response = await esClient.transport.request(options);

        const resultContent = {
          content: [
            {
              type: "text" as const,
              text: `Successfully executed ${method} request to ${path}`
            },
            {
              type: "text" as const,
              text: JSON.stringify(response, null, 2)
            }
          ]
        };

        // Check token limit
        const tokenCheck = checkTokenLimit(resultContent, maxTokenCall, break_token_rule);
        if (!tokenCheck.allowed) {
          return {
            content: [
              {
                type: "text" as const,
                text: tokenCheck.error || "Token limit exceeded",
              },
            ],
            isError: true,
          };
        }

        return resultContent;
      } catch (error) {
        console.error(
          `Elasticsearch API request failed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        
        // Extract and format error details if available
        let errorDetails = "";
        if (error instanceof Error && 'meta' in error && error.meta) {
          const meta = error.meta as any;
          if (meta.body) {
            errorDetails = `\nError details: ${JSON.stringify(meta.body, null, 2)}`;
          }
        }
        
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }${errorDetails}`
            }
          ]
        };
      }
    }
  );

  // Tool 5: Get shard information with health analysis
  server.tool(
    "get_shards",
    "Get detailed shard information with intelligent health analysis and optimization recommendations",
    {
      index: z
        .string()
        .optional()
        .describe("Optional index pattern to filter results (e.g., 'logs-*', 'metrics-2024.*')"),
      
      analysis_mode: z
        .enum(["summary", "problems", "full"])
        .optional()
        .default("summary")
        .describe("Analysis detail level: summary (health overview, default), problems (detailed issues), full (all shards, may exceed tokens)"),
      
      size_threshold: z
        .number()
        .optional()
        .default(50)
        .describe("Shard size warning threshold in GB (default: 50)"),
      
      docs_threshold: z
        .number()
        .optional()
        .default(200)
        .describe("Document count warning threshold in millions (default: 200)"),
      
      show_recommendations: z
        .boolean()
        .optional()
        .default(true)
        .describe("Show optimization recommendations (default: true)"),
      
      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Set to true to bypass token limits in critical situations"),
    },
    async ({ index, analysis_mode, size_threshold, docs_threshold, show_recommendations, break_token_rule }) => {
      try {
        // Fetch shard data
        const params: any = { 
          format: "json",
          h: "index,shard,prirep,state,docs,store,ip,node"
        };
        if (index) {
          params.index = index;
        }

        const response = await esClient.cat.shards(params);
        
        // Convert response to array format for analysis
        const shardData = Array.isArray(response) ? response : [response];
        
        // Analyze shard health
        const metrics = analyzeShardHealth(
          shardData as any, 
          size_threshold || 50, 
          docs_threshold || 200
        );

        let resultText = '';
        const originalDataTokens = calculateTokens(JSON.stringify(response, null, 2));

        // Generate output based on mode
        if (analysis_mode === "full") {
          // Full mode: return all shards (may be huge)
          resultText = `Shard information${index ? ` for pattern: ${index}` : ' (all indices)'}\n\n`;
          resultText += JSON.stringify(response, null, 2);
          
        } else if (analysis_mode === "problems") {
          // Problems mode: show detailed problems
          resultText = formatShardProblems(metrics);
          
          if (show_recommendations) {
            resultText += generateShardRecommendations(metrics);
          }
          
        } else {
          // Summary mode (default): health overview
          resultText = formatShardSummary(metrics);
          
          // Show top problem indices if any
          if (metrics.problem_shards.unassigned.length > 0 || 
              metrics.problem_shards.oversized.length > 0 ||
              metrics.problem_shards.over_documented.length > 0) {
            
            resultText += `\nTop Problem Indices:\n`;
            resultText += `${'─'.repeat(60)}\n`;
            
            // Group problems by index
            const problemIndices = new Map<string, string[]>();
            
            for (const shard of metrics.problem_shards.unassigned.slice(0, 5)) {
              if (shard.index) {
                if (!problemIndices.has(shard.index)) problemIndices.set(shard.index, []);
                problemIndices.get(shard.index)!.push('🔴 unassigned shards');
              }
            }
            
            for (const shard of metrics.problem_shards.oversized.slice(0, 5)) {
              if (shard.index) {
                if (!problemIndices.has(shard.index)) problemIndices.set(shard.index, []);
                problemIndices.get(shard.index)!.push('🔴 oversized (>100GB)');
              }
            }
            
            for (const shard of metrics.problem_shards.over_documented.slice(0, 5)) {
              if (shard.index) {
                if (!problemIndices.has(shard.index)) problemIndices.set(shard.index, []);
                problemIndices.get(shard.index)!.push('🔴 over-documented (>200M)');
              }
            }
            
            let count = 0;
            for (const [idx, problems] of problemIndices.entries()) {
              if (count >= 5) break;
              resultText += `  ${count + 1}. ${idx}\n`;
              resultText += `     → ${[...new Set(problems)].join(', ')}\n`;
              count++;
            }
            
            resultText += `\n💡 Use analysis_mode: "problems" for detailed analysis\n`;
          }
          
          if (show_recommendations) {
            resultText += generateShardRecommendations(metrics);
          }
        }

        // Calculate optimized tokens
        const optimizedTokens = calculateTokens(resultText);
        
        // Add token statistics
        resultText += `\n${'='.repeat(60)}\n`;
        resultText += `📊 Token Usage Statistics:\n`;
        resultText += `   Analysis Mode:           ${analysis_mode}\n`;
        resultText += `   Original (raw data):     ${originalDataTokens.toLocaleString()} tokens\n`;
        resultText += `   Optimized (analysis):    ${optimizedTokens.toLocaleString()} tokens\n`;
        
        if (originalDataTokens > optimizedTokens) {
          const savings = originalDataTokens - optimizedTokens;
          const savingsPct = ((savings / originalDataTokens) * 100).toFixed(1);
          resultText += `   Saved:                   ${savings.toLocaleString()} tokens (${savingsPct}% reduction)\n`;
        }
        
        resultText += `   Max allowed per call:    ${maxTokenCall.toLocaleString()} tokens\n`;

        // Check token limit
        if (optimizedTokens > maxTokenCall && !break_token_rule) {
          return {
            content: [
              {
                type: "text" as const,
                text: `⚠️  Analysis result exceeds token limit (${optimizedTokens.toLocaleString()} > ${maxTokenCall.toLocaleString()}).\n\n` +
                     `Suggestions:\n` +
                     `1. Use 'index' parameter to filter specific indices\n` +
                     `2. Use 'analysis_mode: summary' for minimal output\n` +
                     `3. Set 'break_token_rule: true' to force output (not recommended)\n\n` +
                     `Current mode: ${analysis_mode}\n` +
                     `Filtered: ${index ? `Yes (${index})` : 'No (all indices)'}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: resultText,
            },
          ],
        };

      } catch (error) {
        console.error(
          `Failed to get shard information: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );

  return server;
}

const config: ElasticsearchConfig = {
  url: process.env.ES_URL || "",
  apiKey: process.env.ES_API_KEY || "",
  username: process.env.ES_USERNAME || "",
  password: process.env.ES_PASSWORD || "",
  caCert: process.env.ES_CA_CERT || "",
};

async function main() {
  try {
    // Check if HTTP transport mode is enabled
    const useHttp = process.env.MCP_TRANSPORT === 'http';
    const httpPort = parseInt(process.env.MCP_HTTP_PORT || '3000');
    const httpHost = process.env.MCP_HTTP_HOST || 'localhost';

    if (useHttp) {
      // HTTP Streamable Mode - Use Streamable HTTP Transport
      process.stderr.write(`Starting Elasticsearch MCP Server in HTTP Streamable mode on ${httpHost}:${httpPort}\n`);
      
      const app = express();
      app.use(express.json());
      
      // Store active transports by session ID
      const transports = new Map<string, StreamableHTTPServerTransport>();

      // Health check endpoint
      app.get('/health', (req, res) => {
        res.json({ 
          status: 'ok', 
          transport: 'streamable-http',
          elasticsearch_url: config.url
        });
      });

      // MCP endpoint - POST for JSON-RPC requests
      app.post('/mcp', async (req, res) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        
        try {
          let transport: StreamableHTTPServerTransport;

          // Check if we have an existing session
          if (sessionId && transports.has(sessionId)) {
            transport = transports.get(sessionId)!;
          } else {
            // Create new transport for new session
            transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: () => randomUUID(),
              onsessioninitialized: async (newSessionId: string) => {
                transports.set(newSessionId, transport);
                process.stderr.write(`New MCP session initialized: ${newSessionId}\n`);
              },
              onsessionclosed: async (closedSessionId: string) => {
                transports.delete(closedSessionId);
                process.stderr.write(`MCP session closed: ${closedSessionId}\n`);
              }
            });

            // Create server for this transport
            const server = await createElasticsearchMcpServer(config);
            await server.connect(transport);
          }

          // Handle the request
          await transport.handleRequest(req, res, req.body);
        } catch (error) {
          process.stderr.write(`Error handling MCP request: ${error}\n`);
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: '2.0',
              error: {
                code: -32603,
                message: 'Internal server error',
              },
              id: null,
            });
          }
        }
      });

      // MCP endpoint - GET for SSE streams
      app.get('/mcp', async (req, res) => {
        const sessionId = req.headers['mcp-session-id'] as string | undefined;
        
        if (!sessionId || !transports.has(sessionId)) {
          res.status(400).json({
            jsonrpc: '2.0',
            error: {
              code: -32000,
              message: 'Invalid or missing session ID',
            },
            id: null,
          });
          return;
        }

        try {
          const transport = transports.get(sessionId)!;
          await transport.handleRequest(req, res);
        } catch (error) {
          process.stderr.write(`Error handling SSE stream: ${error}\n`);
          if (!res.headersSent) {
            res.status(500).json({
              jsonrpc: '2.0',
              error: {
                code: -32603,
                message: 'Failed to establish SSE stream',
              },
              id: null,
            });
          }
        }
      });

      // Start HTTP server
      app.listen(httpPort, httpHost, () => {
        console.log(`\n✓ Elasticsearch MCP Server (HTTP Streamable Mode) is running`);
        console.log(`  Endpoint: http://${httpHost}:${httpPort}/mcp`);
        console.log(`  Health: http://${httpHost}:${httpPort}/health`);
        console.log(`  Transport: Streamable HTTP`);
        console.log(`  Elasticsearch URL: ${config.url}\n`);
      });

      // Handle process termination
      process.on("SIGINT", async () => {
        console.log("\nShutting down server...");
        for (const [sessionId, transport] of transports.entries()) {
          await transport.close();
        }
        process.exit(0);
      });

    } else {
      // Stdio Mode (Default) - Use Stdio Transport
      process.stderr.write(`Starting Elasticsearch MCP Server in Stdio mode\n`);
      
      const transport = new StdioServerTransport();
      const server = await createElasticsearchMcpServer(config);

      await server.connect(transport);

      // Handle process termination
      process.on("SIGINT", async () => {
        await server.close();
        process.exit(0);
      });
    }
    
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(
    "Server error:",
    error instanceof Error ? error.message : String(error)
  );
  process.exit(1);
});
