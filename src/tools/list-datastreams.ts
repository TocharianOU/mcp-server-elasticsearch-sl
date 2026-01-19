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
        .enum(["minimal", "compact", "full"])
        .optional()
        .default("minimal")
        .describe(
          "Output detail level: minimal (list with key stats), compact (detailed analysis), full (raw data)"
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

        // Get health and stats for backing indices
        const indicesStats = await esClient.cat.indices({
          index: Array.from(allBackingIndices).join(","),
          format: "json",
          h: "index,health,status,docs.count,store.size,creation.date.string",
        });

        // Build index info map
        const indexInfoMap = new Map<string, BackingIndex>();
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

        // Calculate original data size
        if (summary_level !== "full") {
          const originalData = JSON.stringify(dsResponse, null, 2);
          originalTokens = calculateTokens(originalData);
        }

        // Generate output
        if (compare_mode || (summaries.length > 10 && summary_level === "minimal")) {
          // Comparison mode
          const comparison = compareDataStreams(summaries);
          resultText = formatComparison(comparison);

          if (summaries.length > displayCount) {
            resultText += `\nShowing top ${displayCount} of ${summaries.length} data streams\n`;
          }

          // Add detailed list if requested
          if (summary_level === "compact") {
            resultText += `\n${"=".repeat(70)}\n`;
            resultText += `\nDetailed Data Streams:\n\n`;
            for (const summary of displaySummaries.slice(0, 10)) {
              resultText += formatCompact(summary) + "\n";
            }
            if (displaySummaries.length > 10) {
              resultText += `\n... and ${displaySummaries.length - 10} more data streams\n`;
            }
          }
        } else {
          // Individual listing mode
          if (summary_level === "full") {
            // Return raw JSON
            resultText = `Raw data streams information:\n\n`;
            resultText += JSON.stringify(
              {
                data_streams: dsResponse.data_streams,
                indices_stats: Array.from(indexInfoMap.values()),
              },
              null,
              2
            );
          } else if (summary_level === "compact") {
            resultText = `Data Streams (${summaries.length} total)\n`;
            resultText += `${"=".repeat(70)}\n\n`;

            for (const summary of displaySummaries) {
              resultText += formatCompact(summary) + "\n";
            }

            if (summaries.length > displayCount) {
              resultText += `\nShowing ${displayCount} of ${summaries.length} data streams\n`;
            }
          } else {
            // minimal (default)
            resultText = `Data Streams (${summaries.length} total)\n`;
            resultText += `${"=".repeat(70)}\n\n`;

            for (const summary of displaySummaries) {
              resultText += formatMinimal(summary);
            }

            if (summaries.length > displayCount) {
              resultText += `\nShowing ${displayCount} of ${summaries.length} data streams\n`;
            }
          }
        }

        // Add token statistics
        if (summary_level !== "full" && originalTokens > 0) {
          const optimizedTokens = calculateTokens(resultText);
          const savings = originalTokens - optimizedTokens;
          const savingsPercent = ((savings / originalTokens) * 100).toFixed(1);

          resultText += `\n${"=".repeat(70)}\n`;
          resultText += `Token Statistics:\n`;
          resultText += `  Summary Level:    ${summary_level}\n`;
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
