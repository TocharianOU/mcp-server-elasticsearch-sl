import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@elastic/elasticsearch";
import { checkTokenLimit, calculateTokens } from "../token-limiter.js";
import {
  generateDataStreamSummary,
  formatMinimal,
  formatCompact,
  compareDataStreams,
  formatComparison,
  type DataStreamInfo,
  type DataStreamSummary,
  type BackingIndex,
} from "../datastream-analyzer.js";

export function registerListDataStreams(
  server: McpServer,
  esClient: Client,
  maxTokenCall: number
) {
  server.tool(
    "list_data_streams",
    "List and analyze Elasticsearch data streams with health monitoring and rollover tracking",
    {
      pattern: z
        .string()
        .optional()
        .describe("Filter data streams by pattern (e.g., 'logs-*', 'metrics-app-*')"),

      summary_level: z
        .enum(["auto", "minimal", "compact", "full"])
        .optional()
        .default("auto")
        .describe(
          "Output detail level: auto (intelligent based on token usage), minimal (list with key stats), compact (detailed analysis), full (raw data)"
        ),

      show_backing_indices: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include backing indices details in output (increases token usage)"),

      health_filter: z
        .enum(["healthy", "warning", "critical"])
        .optional()
        .describe("Filter by health status: healthy, warning, or critical"),

      ilm_policy: z
        .string()
        .optional()
        .describe("Filter by ILM policy name"),

      max_display: z
        .number()
        .optional()
        .default(50)
        .describe("Maximum number of data streams to display (default: 50)"),

      compare_mode: z
        .boolean()
        .optional()
        .default(false)
        .describe("Show aggregate comparison across all matched data streams"),

      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe("Bypass token limits in critical situations"),
    },
    async ({
      pattern,
      summary_level,
      show_backing_indices,
      health_filter,
      ilm_policy,
      max_display,
      compare_mode,
      break_token_rule,
    }) => {
      try {
        // Fetch data streams
        const dsResponse = await esClient.indices.getDataStream({
          name: pattern || "*",
        });

        const dataStreams = dsResponse.data_streams || [];

        if (dataStreams.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No data streams found${pattern ? ` matching pattern: ${pattern}` : ""}`,
              },
            ],
          };
        }

        // Fetch backing indices details
        const allBackingIndices = new Set<string>();
        for (const ds of dataStreams) {
          for (const idx of ds.indices || []) {
            allBackingIndices.add(idx.index_name);
          }
        }

        // Build index info map
        const indexInfoMap = new Map<string, BackingIndex>();
        
        // Split into batches to avoid HTTP line too long error
        const allIndicesArray = Array.from(allBackingIndices);
        const BATCH_SIZE = 50; // Limit to 50 indices per request
        
        for (let i = 0; i < allIndicesArray.length; i += BATCH_SIZE) {
          const batch = allIndicesArray.slice(i, i + BATCH_SIZE);
          
          try {
            // Get health and stats for this batch
            const indicesStats = await esClient.cat.indices({
              index: batch.join(","),
              format: "json",
              h: "index,health,status,docs.count,store.size,creation.date.string",
            });

            for (const idx of indicesStats as any[]) {
              indexInfoMap.set(idx.index, {
                index: idx.index,
                health: idx.health,
                status: idx.status,
                docs_count: parseInt(idx["docs.count"] || "0", 10),
                store_size: idx["store.size"],
                creation_date: idx["creation.date.string"],
              });
            }
          } catch (batchError) {
            // If batch still fails, skip this batch and continue
            console.error(`Failed to fetch stats for batch: ${batchError}`);
          }
        }

        // Process data streams
        const dsInfoList: DataStreamInfo[] = dataStreams.map((ds: any) => {
          const backingIndices: BackingIndex[] = (ds.indices || []).map(
            (idx: any) => {
              return (
                indexInfoMap.get(idx.index_name) || {
                  index: idx.index_name,
                }
              );
            }
          );

          return {
            name: ds.name,
            timestamp_field: ds.timestamp_field?.name || "@timestamp",
            indices_count: backingIndices.length,
            backing_indices: backingIndices,
            generation: ds.generation || 1,
            status: ds.status,
            template: ds.template,
            ilm_policy: ds.ilm_policy,
            hidden: ds.hidden,
          };
        });

        // Generate summaries
        let summaries: DataStreamSummary[] = dsInfoList.map((dsInfo) =>
          generateDataStreamSummary(dsInfo)
        );

        // Apply filters
        if (health_filter) {
          summaries = summaries.filter(
            (s) => s.health.status === health_filter
          );
        }

        if (ilm_policy) {
          summaries = summaries.filter(
            (s) => s.config.ilm_policy === ilm_policy
          );
        }

        if (summaries.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No data streams found matching the specified filters`,
              },
            ],
          };
        }

        // Sort by size (descending)
        summaries.sort((a, b) => b.stats.total_size_gb - a.stats.total_size_gb);

        // Limit display
        const displayCount = Math.min(summaries.length, max_display || 50);
        const displaySummaries = summaries.slice(0, displayCount);

        let resultText = "";
        let originalTokens = 0;
        let actualLevel: string = summary_level || "auto";
        let autoSwitchMessage = "";

        // Calculate original data size
        if (summary_level !== "full") {
          const originalData = JSON.stringify(dsResponse, null, 2);
          originalTokens = calculateTokens(originalData);
        }

        // Auto threshold for switching to summary mode
        const AUTO_SUMMARY_THRESHOLD = 50;
        const isLargeSet = summaries.length > AUTO_SUMMARY_THRESHOLD;
        const shouldUseSummary = compare_mode || (isLargeSet && summary_level === "auto");

        // Generate output based on mode
        if (summary_level === "full") {
          // Full mode: Return raw JSON
          resultText = `Raw data streams information:\n\n`;
          resultText += JSON.stringify(
            {
              data_streams: dsResponse.data_streams,
              indices_stats: Array.from(indexInfoMap.values()),
            },
            null,
            2
          );
          actualLevel = "full";
        } else if (summary_level === "auto") {
          // Auto mode: Try levels until one fits within token limit
          
          if (shouldUseSummary) {
            // Large set: start with comparison mode
            const comparisonText = formatComparison(compareDataStreams(summaries));
            const comparisonTokens = calculateTokens(comparisonText);
            
            if (comparisonTokens <= maxTokenCall || break_token_rule) {
              resultText = comparisonText;
              actualLevel = "comparison";
              if (summaries.length > displayCount) {
                resultText += `\nShowing top ${displayCount} of ${summaries.length} data streams\n`;
              }
            } else {
              // Even comparison is too large, use ultra-minimal
              actualLevel = "minimal";
              autoSwitchMessage = `⚠️  Large dataset detected (${summaries.length} streams).\n` +
                                 `Comparison mode would use ${comparisonTokens.toLocaleString()} tokens.\n` +
                                 `Auto-switched to minimal mode.\n\n`;
              
              // Generate minimal list with fewer items
              const minimalDisplayCount = Math.min(20, displayCount);
              resultText = `Data Streams Overview (${summaries.length} total)\n`;
              resultText += `${"=".repeat(70)}\n\n`;
              
              for (const summary of summaries.slice(0, minimalDisplayCount)) {
                resultText += formatMinimal(summary);
              }
              
              if (summaries.length > minimalDisplayCount) {
                resultText += `\n... and ${summaries.length - minimalDisplayCount} more data streams\n`;
                resultText += `\n💡 Use pattern filter to narrow down results\n`;
              }
            }
          } else {
            // Smaller set: try minimal list first
            let minimalText = `Data Streams (${summaries.length} total)\n`;
            minimalText += `${"=".repeat(70)}\n\n`;
            
            for (const summary of displaySummaries) {
              minimalText += formatMinimal(summary);
            }
            
            if (summaries.length > displayCount) {
              minimalText += `\nShowing ${displayCount} of ${summaries.length} data streams\n`;
            }
            
            const minimalTokens = calculateTokens(minimalText);
            
            if (minimalTokens <= maxTokenCall || break_token_rule) {
              resultText = minimalText;
              actualLevel = "minimal";
            } else {
              // Minimal list still too large, use comparison
              const comparisonText = formatComparison(compareDataStreams(summaries));
              const comparisonTokens = calculateTokens(comparisonText);
              
              if (comparisonTokens <= maxTokenCall || break_token_rule) {
                resultText = comparisonText;
                actualLevel = "comparison";
                autoSwitchMessage = `⚠️  Detailed list would use ${minimalTokens.toLocaleString()} tokens.\n` +
                                   `Auto-switched to comparison mode.\n\n`;
              } else {
                // Last resort: ultra-minimal
                resultText = comparisonText;
                actualLevel = "comparison";
                autoSwitchMessage = `⚠️  Large result set. Auto-switched to comparison mode.\n\n`;
              }
            }
          }
        } else if (compare_mode) {
          // Explicit comparison mode
          const comparison = compareDataStreams(summaries);
          resultText = formatComparison(comparison);
          actualLevel = "comparison";

          if (summaries.length > displayCount) {
            resultText += `\nShowing top ${displayCount} of ${summaries.length} data streams\n`;
          }
        } else if (summary_level === "compact") {
          // Compact mode: Detailed analysis
          resultText = `Data Streams (${summaries.length} total)\n`;
          resultText += `${"=".repeat(70)}\n\n`;

          for (const summary of displaySummaries) {
            resultText += formatCompact(summary) + "\n";
          }

          if (summaries.length > displayCount) {
            resultText += `\nShowing ${displayCount} of ${summaries.length} data streams\n`;
          }
          actualLevel = "compact";
        } else {
          // Minimal mode (explicit)
          resultText = `Data Streams (${summaries.length} total)\n`;
          resultText += `${"=".repeat(70)}\n\n`;

          for (const summary of displaySummaries) {
            resultText += formatMinimal(summary);
          }

          if (summaries.length > displayCount) {
            resultText += `\nShowing ${displayCount} of ${summaries.length} data streams\n`;
          }
          actualLevel = "minimal";
        }

        // Prepend auto-switch message if any
        if (autoSwitchMessage) {
          resultText = autoSwitchMessage + resultText;
        }

        // Add token statistics
        if (actualLevel !== "full" && originalTokens > 0) {
          const optimizedTokens = calculateTokens(resultText);
          const savings = originalTokens - optimizedTokens;
          const savingsPercent = ((savings / originalTokens) * 100).toFixed(1);

          resultText += `\n${"=".repeat(70)}\n`;
          resultText += `Token Statistics:\n`;
          resultText += `  Summary Level:    ${actualLevel}${summary_level === "auto" ? " (auto-selected)" : ""}\n`;
          resultText += `  Original Data:    ${originalTokens.toLocaleString()} tokens\n`;
          resultText += `  Optimized:        ${optimizedTokens.toLocaleString()} tokens\n`;
          resultText += `  Saved:            ${savings.toLocaleString()} tokens (${savingsPercent}% reduction)\n`;
          resultText += `  Limit:            ${maxTokenCall.toLocaleString()} tokens\n`;
        }

        // Add filter info
        if (health_filter || ilm_policy) {
          resultText += `\nActive Filters:\n`;
          if (health_filter) {
            resultText += `  Health: ${health_filter}\n`;
          }
          if (ilm_policy) {
            resultText += `  ILM Policy: ${ilm_policy}\n`;
          }
        }

        const result = {
          content: [
            {
              type: "text" as const,
              text: resultText,
            },
          ],
        };

        // Check token limit
        const tokenCheck = checkTokenLimit(
          result,
          maxTokenCall,
          break_token_rule
        );
        if (!tokenCheck.allowed) {
          let suggestion = tokenCheck.error!;
          suggestion += `\n\nCurrent configuration:\n`;
          suggestion += `  - summary_level: ${summary_level}\n`;
          suggestion += `  - data_streams: ${summaries.length}\n`;
          suggestion += `  - max_display: ${max_display}\n`;

          suggestion += `\nSuggestions:\n`;
          suggestion += `  1. Use pattern filter (e.g., pattern="logs-*")\n`;
          suggestion += `  2. Reduce max_display (e.g., max_display=10)\n`;
          suggestion += `  3. Use health_filter to focus on problematic streams\n`;
          suggestion += `  4. Enable compare_mode for aggregate view\n`;

          return {
            content: [
              {
                type: "text" as const,
                text: suggestion,
              },
            ],
            isError: true,
          };
        }

        return result;
      } catch (error) {
        console.error(
          `Failed to list data streams: ${
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
}
