import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client, estypes } from "@elastic/elasticsearch";
import { checkTokenLimit } from "../token-limiter.js";
import type { FieldCapsService, FieldMap } from "../lint/field-caps-service.js";
import { extractDslFields } from "../lint/field-extractor.js";
import {
  collectDslDefinedFields,
  enrichEsError,
  formatLintReport,
  lintFieldRefs,
  rewriteDslFields,
} from "../lint/query-lint.js";
import { adviseOnIndexName, enrichIndexError } from "../lint/index-conventions.js";

export function registerSearch(
  server: McpServer,
  esClient: Client,
  maxTokenCall: number,
  fieldCaps?: FieldCapsService,
  esMajor: number = 8
) {
  // Tool 3: Search an index with simplified parameters
  server.tool(
    "es_search",
    "Perform an Elasticsearch search with the provided query DSL. Highlights are always enabled. " +
    "Field names are validated against the index's real field_caps before execution: " +
    "unambiguous mistakes (e.g. a spurious .keyword suffix on ECS/built-in mappings) are auto-fixed, " +
    "unknown fields return suggestions instead of running a doomed query. " +
    "If unsure about field names, call lookup_fields or get_mappings first instead of guessing.",
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

      skip_lint: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Skip pre-execution field validation. Only set true when you are certain a flagged field exists (e.g. runtime fields defined outside the query)."
        ),
    },
    async ({ index, queryBody, break_token_rule, skip_lint }) => {
      // ── Field lint: validate/auto-fix field references against live field_caps
      let lintNotes: string[] = [];
      let liveFields: FieldMap | null = null;
      const indexAdvice = adviseOnIndexName(index, esMajor);
      if (indexAdvice) lintNotes.push(`提示：${indexAdvice}`);
      if (fieldCaps && !skip_lint) {
        try {
          liveFields = await fieldCaps.getFields(index);
          if (liveFields.size > 0) {
            const defined = collectDslDefinedFields(queryBody);
            const refs = extractDslFields(queryBody);
            const { fixes, notes, problems } = lintFieldRefs(refs, liveFields, defined);
            if (problems.length > 0) {
              return {
                content: [{ type: "text" as const, text: formatLintReport(problems) }],
                isError: true,
              };
            }
            if (fixes.size > 0) {
              queryBody = rewriteDslFields(queryBody, fixes);
              lintNotes.push(...notes);
            }
          }
        } catch {
          // lint must never break the tool; fall through to normal execution
        }
      }
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

        const lintFragments = lintNotes.length
          ? [{ type: "text" as const, text: lintNotes.join("\n") }]
          : [];

        const resultContent = {
          content: [
            ...lintFragments,
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
        const raw = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${enrichIndexError(enrichEsError(raw, liveFields), esMajor)}`,
            },
          ],
        };
      }
    }
  );
}
