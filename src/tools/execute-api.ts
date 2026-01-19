import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Client } from "@elastic/elasticsearch";
import { checkTokenLimit } from "../token-limiter.js";

export function registerExecuteApi(
  server: McpServer,
  esClient: Client,
  maxTokenCall: number
) {
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
}
