import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@elastic/elasticsearch";
import { checkTokenLimit, calculateTokens } from "../token-limiter.js";
import { 
  generateIndexSummary, 
  formatSummaryText,
  formatCompactSummary,
  formatMinimalSummary,
  generateSuggestions 
} from "../index-analyzer.js";

export function registerListIndices(
  server: McpServer,
  esClient: Client,
  maxTokenCall: number
) {
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
}
