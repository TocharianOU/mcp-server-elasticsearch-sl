#!/usr/bin/env node

/*
 * Copyright Elasticsearch B.V. and contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { randomUUID } from "crypto";
import { createElasticsearchMcpServer, ElasticsearchConfig } from "./src/server.js";

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
        console.error(`\n✓ Elasticsearch MCP Server (HTTP Streamable Mode) is running`);
        console.error(`  Endpoint: http://${httpHost}:${httpPort}/mcp`);
        console.error(`  Health: http://${httpHost}:${httpPort}/health`);
        console.error(`  Transport: Streamable HTTP`);
        console.error(`  Elasticsearch URL: ${config.url}\n`);
      });

      // Handle process termination
      process.on("SIGINT", async () => {
        console.error("\nShutting down server...");
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
