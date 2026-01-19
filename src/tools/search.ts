import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client, estypes } from "@elastic/elasticsearch";
import { checkTokenLimit } from "../token-limiter.js";

export function registerSearch(
  server: McpServer,
  esClient: Client,
  maxTokenCall: number
) {
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
}
