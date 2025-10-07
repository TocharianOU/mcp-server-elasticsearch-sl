#!/bin/bash

# Elasticsearch MCP Server - HTTP Streamable Mode Startup Script
# This script starts the Elasticsearch MCP Server in HTTP mode

echo "🚀 Starting Elasticsearch MCP Server (HTTP Streamable Mode)"
echo "============================================================"

# Elasticsearch Configuration
export ES_URL="https://localhost:9201"
export ES_USERNAME="elastic"
export ES_PASSWORD="1234!"
export NODE_TLS_REJECT_UNAUTHORIZED="0"

# MCP Transport Configuration
export MCP_TRANSPORT="http"
export MCP_HTTP_PORT="3001"
export MCP_HTTP_HOST="0.0.0.0"

echo ""
echo "📋 Configuration:"
echo "   Elasticsearch URL: ${ES_URL}"
echo "   Username: ${ES_USERNAME}"
echo "   HTTP Host: ${MCP_HTTP_HOST}"
echo "   HTTP Port: ${MCP_HTTP_PORT}"
echo "   TLS Validation: Disabled"
echo ""
echo "🌐 Server will be available at:"
echo "   • MCP Endpoint: http://${MCP_HTTP_HOST}:${MCP_HTTP_PORT}/mcp"
echo "   • Health Check: http://${MCP_HTTP_HOST}:${MCP_HTTP_PORT}/health"
echo ""
echo "⏳ Starting server..."
echo ""

# Start the server (using local build for faster startup)
node dist/index.js

