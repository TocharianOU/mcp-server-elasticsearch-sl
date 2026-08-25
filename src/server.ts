import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ClientOptions } from "@elastic/elasticsearch";
import fs from "fs";
import { detectESVersion, formatVersionInfo } from "./version-detector.js";
import { createVersionedClient, verifyConnection } from "./client-factory.js";
import { CapabilityManager } from "./capability-manager.js";
import { FieldCapsService } from "./lint/field-caps-service.js";
import { registerLookupFields } from "./tools/lookup-fields.js";
import { registerListIndices } from "./tools/list-indices.js";
import { registerGetMappings } from "./tools/get-mappings.js";
import { registerSearch } from "./tools/search.js";
import { registerExecuteApi } from "./tools/execute-api.js";
import { registerGetShards } from "./tools/get-shards.js";
import { registerListDataStreams } from "./tools/list-datastreams.js";
import { registerEsql } from "./tools/esql.js";

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

export type ElasticsearchConfig = z.infer<typeof ConfigSchema>;

export async function createElasticsearchMcpServer(
  config: ElasticsearchConfig
) {
  const validatedConfig = ConfigSchema.parse(config);
  const { url, apiKey, username, password, caCert } = validatedConfig;

  // Get token limit configuration
  const maxTokenCall = parseInt(process.env.MAX_TOKEN_CALL || "20000", 10);

  // Step 1: Detect ES version using native HTTP (no client dependency)
  const versionInfo = await detectESVersion(url, {
    username,
    password,
    apiKey,
    rejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
  });

  // Step 2: Create capability manager
  const capabilityManager = new CapabilityManager(versionInfo);

  // Step 3: Build client options
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
      throw new Error(
        `Failed to read certificate file: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  // Handle self-signed certificates
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
    clientOptions.tls = clientOptions.tls || {};
    (clientOptions.tls as any).rejectUnauthorized = false;
  }

  // Step 4: Create version-specific client
  const esClient = await createVersionedClient(versionInfo, clientOptions);

  // Step 5: Verify connection
  const connected = await verifyConnection(esClient);
  if (!connected) {
    throw new Error("Failed to verify connection to Elasticsearch");
  }

  // Step 6: Create MCP server
  const server = new McpServer({
    name: "elasticsearch-mcp",
    version: "0.9.0",
  });

  // Step 7: Conditional tool registration
  const registeredTools: string[] = [];
  const skippedTools: string[] = [];

  // Always register basic tools (supported in all versions)
  registerListIndices(server, esClient, maxTokenCall);
  registeredTools.push("list_indices");

  registerGetMappings(server, esClient, maxTokenCall);
  registeredTools.push("get_mappings");

  // Shared field-caps cache backing the query lint layer (field_caps is
  // available on every supported ES version >= 5.4; lint degrades to a
  // no-op automatically if the call fails).
  const fieldCapsService = new FieldCapsService(esClient);

  registerSearch(server, esClient, maxTokenCall, fieldCapsService, versionInfo.major);
  registeredTools.push("es_search");

  registerLookupFields(server, fieldCapsService, () => versionInfo.major);
  registeredTools.push("lookup_fields");

  registerExecuteApi(server, esClient, maxTokenCall);
  registeredTools.push("execute_es_api");

  registerGetShards(server, esClient, maxTokenCall);
  registeredTools.push("get_shards");

  // Conditional: Data Streams (ES 7.9+)
  if (capabilityManager.supportsDataStreams()) {
    registerListDataStreams(server, esClient, maxTokenCall);
    registeredTools.push("list_data_streams");
  } else {
    skippedTools.push("list_data_streams (requires ES 7.9+)");
  }

  // Conditional: ES|QL (ES 8.11+)
  if (capabilityManager.supportsESQL()) {
    registerEsql(server, esClient, maxTokenCall, fieldCapsService, versionInfo.major);
    registeredTools.push("esql_query");
  } else {
    skippedTools.push("esql_query (requires ES 8.11+)");
  }

  return server;
}
