import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@elastic/elasticsearch";
import { calculateTokens } from "../token-limiter.js";
import {
  analyzeShardHealth,
  formatShardSummary,
  formatShardProblems,
  generateShardRecommendations
} from "../shard-analyzer.js";

export function registerGetShards(
  server: McpServer,
  esClient: Client,
  maxTokenCall: number
) {
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
}
