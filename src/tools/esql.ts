// SPDX-License-Identifier: Apache-2.0
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@elastic/elasticsearch";
import { checkTokenLimit } from "../token-limiter.js";

/**
 * Convert ES|QL columnar response (columns + values) into an array of row objects
 * for more readable AI consumption.
 */
function esqlRowsToObjects(
  columns: Array<{ name: string; type: string }>,
  values: unknown[][]
): Record<string, unknown>[] {
  return values.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((col, i) => {
      obj[col.name] = row[i] ?? null;
    });
    return obj;
  });
}

/**
 * Build a simple ASCII table for compact display when the result set is small.
 */
function esqlToTable(
  columns: Array<{ name: string; type: string }>,
  values: unknown[][]
): string {
  if (values.length === 0) return "(no rows)";

  const headers = columns.map((c) => c.name);
  const rows = values.map((row) =>
    row.map((v) => (v === null || v === undefined ? "null" : String(v)))
  );

  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length))
  );

  const sep = "+-" + colWidths.map((w) => "-".repeat(w)).join("-+-") + "-+";
  const headerRow =
    "| " +
    headers.map((h, i) => h.padEnd(colWidths[i])).join(" | ") +
    " |";

  const dataRows = rows.map(
    (r) =>
      "| " +
      r.map((v, i) => (v ?? "").padEnd(colWidths[i])).join(" | ") +
      " |"
  );

  return [sep, headerRow, sep, ...dataRows, sep].join("\n");
}

export function registerEsql(
  server: McpServer,
  esClient: Client,
  maxTokenCall: number
) {
  server.tool(
    "esql_query",
    `Execute an Elasticsearch ES|QL query (requires ES 8.11+).

ES|QL is Elasticsearch's pipe-based query language. Queries look like:
  FROM index_name
  | WHERE field == "value"
  | STATS count = COUNT(*) BY category
  | SORT count DESC
  | LIMIT 10

Useful for analytics, aggregations and data exploration without complex DSL.
Parameterised values can be passed via the 'params' argument (use ? as placeholder).`,
    {
      query: z
        .string()
        .trim()
        .min(1, "ES|QL query cannot be empty")
        .describe(
          "The ES|QL query string, e.g. 'FROM logs-* | WHERE level == \"error\" | STATS count = COUNT(*) BY service | SORT count DESC | LIMIT 20'"
        ),

      params: z
        .array(z.union([z.string(), z.number(), z.boolean(), z.null()]))
        .optional()
        .describe(
          "Optional positional parameters for the query (replace ? placeholders). Example: ['error', 100]"
        ),

      include_types: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Include column type information in the output. Useful when you need to know the data type of each field."
        ),

      break_token_rule: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Set to true to bypass token limits in critical situations. Use sparingly to avoid context overflow."
        ),
    },
    async ({ query, params, include_types, break_token_rule }) => {
      try {
        const requestBody: Record<string, unknown> = { query };
        if (params && params.length > 0) {
          requestBody.params = params;
        }

        const response = await esClient.transport.request({
          method: "POST",
          path: "_query",
          body: requestBody,
        }) as {
          columns: Array<{ name: string; type: string }>;
          values: unknown[][];
        };

        const { columns, values } = response;

        if (!Array.isArray(columns) || !Array.isArray(values)) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Unexpected response format from ES|QL:\n${JSON.stringify(response, null, 2)}`,
              },
            ],
            isError: true,
          };
        }

        const rowCount = values.length;
        const colCount = columns.length;

        // Build column summary
        const colSummary = include_types
          ? columns.map((c) => `${c.name} (${c.type})`).join(", ")
          : columns.map((c) => c.name).join(", ");

        // For small result sets render a table; for larger sets use JSON objects
        const TABLE_ROW_LIMIT = 50;
        let dataSection: string;
        if (rowCount === 0) {
          dataSection = "(query returned no rows)";
        } else if (rowCount <= TABLE_ROW_LIMIT && colCount <= 12) {
          dataSection = esqlToTable(columns, values);
        } else {
          const objects = esqlRowsToObjects(columns, values);
          dataSection = JSON.stringify(objects, null, 2);
        }

        const resultContent = {
          content: [
            {
              type: "text" as const,
              text: [
                `ES|QL query executed successfully.`,
                `Rows returned: ${rowCount} | Columns: ${colCount}`,
                `Columns: ${colSummary}`,
              ].join("\n"),
            },
            {
              type: "text" as const,
              text: dataSection,
            },
          ],
        };

        const tokenCheck = checkTokenLimit(resultContent, maxTokenCall, break_token_rule);
        if (!tokenCheck.allowed) {
          // Fallback: return only the first 20 rows to stay within limits
          const truncatedObjects = esqlRowsToObjects(columns, values.slice(0, 20));
          return {
            content: [
              {
                type: "text" as const,
                text: [
                  `ES|QL query executed successfully (output truncated — full result had ${rowCount} rows / ~${tokenCheck.tokens} tokens, limit is ${maxTokenCall}).`,
                  `Showing first 20 rows. Add '| LIMIT 20' to your query to avoid truncation, or retry with break_token_rule: true.`,
                  `Columns: ${colSummary}`,
                ].join("\n"),
              },
              {
                type: "text" as const,
                text: JSON.stringify(truncatedObjects, null, 2),
              },
            ],
          };
        }

        return resultContent;
      } catch (error) {
        let errorText = error instanceof Error ? error.message : String(error);

        // Surface ES error details (e.g. syntax errors come back in meta.body)
        if (error instanceof Error && "meta" in error) {
          const meta = (error as any).meta;
          if (meta?.body?.error) {
            const esErr = meta.body.error;
            errorText = `${esErr.type}: ${esErr.reason ?? errorText}`;
            if (esErr.caused_by) {
              errorText += `\nCaused by: ${esErr.caused_by.type}: ${esErr.caused_by.reason}`;
            }
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `ES|QL error: ${errorText}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}
