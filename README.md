# Elasticsearch MCP Server
[![npm version](https://badge.fury.io/js/@tocharianou%2Felasticsearch-mcp.svg)](https://www.npmjs.com/package/@tocharianou/elasticsearch-mcp)
[![Downloads](https://img.shields.io/npm/dm/@tocharianou/elasticsearch-mcp.svg)](https://www.npmjs.com/package/@tocharianou/elasticsearch-mcp)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/TocharianOU/elasticsearch-mcp)

> **Enhanced Elasticsearch MCP Server Solution - Security & Threat Analysis Focused**

This is a professional security-focused solution maintained by TocharianOU. It enables comprehensive interaction with all Elasticsearch APIs, specifically optimized for security analysis, threat detection, and incident investigation. Features include advanced security monitoring, anomaly detection, threat hunting, root cause analysis, and comprehensive audit capabilities.

**Key Security Features:**
- Real-time threat detection and security monitoring
- Advanced machine learning for anomaly detection  
- Root cause analysis and attack chain tracking
- Security incident investigation and forensics
- Compliance monitoring and audit reporting

---

**Note:** This solution requires a valid Elasticsearch license (trial, platinum, or enterprise) and is designed for security professionals, SOC teams, and threat analysts.

Connect to your Elasticsearch data directly from any MCP Client (such as Claude Desktop) using the Model Context Protocol (MCP). Interact with your Elasticsearch security data through natural language queries for advanced threat analysis and incident response.


## Prerequisites

* An Elasticsearch instance
* **A valid Elasticsearch license (trial, platinum, enterprise) is required.**
* Elasticsearch authentication credentials (API key or username/password)
* MCP Client (e.g. Claude Desktop) or HTTP client for remote access

> ⚠️ This project requires your Elasticsearch cluster to have a valid license. If you do not have a license, you can activate a trial license as shown below.

## Multi-Version Elasticsearch Support

**Automatically supports Elasticsearch 5.x - 9.x with intelligent version detection:**

| Version | Status | Client | Notes |
|---------|--------|--------|-------|
| ES 5.x | ✅ | 5.6.22 | EOL - Basic tools only |
| ES 6.x | ✅ | 6.8.8 | EOL - ILM available (6.6+) |
| ES 7.x | ✅ | 7.17.14 | LTS - Full features |
| ES 8.x | ✅ | 8.19.1 | **Recommended** - Latest features |
| ES 9.x+ | ✅ | Auto-fallback | Future-ready |

**Key Features:**
- 🔍 **Automatic version detection** - No manual configuration needed
- 🔄 **Smart client selection** - Loads the right client for your ES version
- ⚙️ **Adaptive features** - Disables unsupported tools (e.g., Data Streams on ES < 7.9)
- 📊 **Version-specific optimizations** - Handles API differences transparently

**What happens:**
```
Connect → Detect ES version → Load matching client → Register compatible tools
```

## SSL/TLS Connection

To connect to Elasticsearch with a self-signed certificate or in a test environment, you can set the following environment variable:

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0
```

> ⚠️ This disables Node.js SSL certificate validation. Use only in development or testing environments. For production, always use a trusted CA certificate.

## Installation & Setup


2. **Start a Conversation**
   - Open a new conversation in your MCP Client
   - The MCP server should connect automatically
   - You can now ask questions about your Elasticsearch data

### Configuration Options

The Elasticsearch MCP Server supports the following configuration options:

#### Elasticsearch Configuration

| Environment Variable           | Description                                              | Required |
|-------------------------------|----------------------------------------------------------|----------|
| `ES_URL`                      | Your Elasticsearch instance URL                          | Yes      |
| `ES_API_KEY`                  | Elasticsearch API key for authentication                 | No       |
| `ES_USERNAME`                 | Elasticsearch username for basic authentication          | No       |
| `ES_PASSWORD`                 | Elasticsearch password for basic authentication          | No       |
| `ES_CA_CERT`                  | Path to custom CA certificate for Elasticsearch SSL/TLS  | No       |
| `NODE_TLS_REJECT_UNAUTHORIZED`| Set to `0` to disable SSL certificate validation         | No       |

#### Transport Mode Configuration (NEW in v0.3.0)

| Environment Variable | Description                                      | Default   | Values          |
|---------------------|--------------------------------------------------|-----------|-----------------|
| `MCP_TRANSPORT`     | Transport mode selection                         | `stdio`   | `stdio`, `http` |
| `MCP_HTTP_PORT`     | HTTP server port (when using HTTP transport)     | `3000`    | 1-65535         |
| `MCP_HTTP_HOST`     | HTTP server host (when using HTTP transport)     | `localhost` | Any valid host  |

**Transport Mode Details:**
- **Stdio mode** (default): For Claude Desktop and local MCP clients
- **HTTP Streamable mode**: Runs as a standalone HTTP server for remote access, API integration, and web applications

### Quick Start

#### Option 1: NPM Installation (Recommended)

1. **Install globally via NPM**
   ```bash
   npm install -g @tocharianou/elasticsearch-mcp
   ```

2. **Run directly**
   ```bash
   npx @tocharianou/elasticsearch-mcp
   ```

#### Option 2: Source Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/TocharianOU/elasticsearch-mcp.git
   cd elasticsearch-mcp
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Build the Project**
   ```bash
   npm run build
   ```

4. **Configure Claude Desktop App**
   - Open **Claude Desktop App**
   - Go to **Settings > Developer > MCP Servers**
   - Click `Edit Config` and add a new MCP Server with the following configuration:

   **For NPM Installation:**
   ```json
   {
     "mcpServers": {
       "elasticsearch-mcp-server": {
         "command": "npx",
         "args": [
           "@tocharianou/elasticsearch-mcp"
         ],
         "env": {
           "ES_URL": "your-elasticsearch-url",
           "ES_USERNAME": "elastic",
           "ES_PASSWORD": "your_pass",
           "NODE_TLS_REJECT_UNAUTHORIZED": "0"
         }
       }
     }
   }
   ```

   **For Source Installation:**
   ```json
   {
     "mcpServers": {
       "elasticsearch-mcp-server-local": {
         "command": "node",
         "args": [
           "/path/to/your/elasticsearch-mcp/dist/index.js"
         ],
         "env": {
           "ES_URL": "your-elasticsearch-url",
           "ES_USERNAME": "elastic",
           "ES_PASSWORD": "your_pass",
           "NODE_TLS_REJECT_UNAUTHORIZED": "0"
         }
       }
     }
   }
   ```

6. **Debugging with MCP Inspector**
   ```bash
   ES_URL=your-elasticsearch-url ES_USERNAME=elastic ES_PASSWORD=your_pass npm run inspector
   ```

   This will start the MCP Inspector, allowing you to debug and analyze requests. You should see:

   ```bash
   Starting MCP inspector...
   Proxy server listening on port 3000

   🔍 MCP Inspector is up and running at http://localhost:5173 🚀
   ```

### Method 3: HTTP Streamable Mode (NEW in v0.3.0)

Run the server as a standalone HTTP service for remote access and API integration:

```bash
# Start HTTP server (default port 3000)
MCP_TRANSPORT=http \
ES_URL=your-elasticsearch-url \
ES_USERNAME=elastic \
ES_PASSWORD=your_pass \
npx @tocharianou/elasticsearch-mcp

# Or with custom port and host
MCP_TRANSPORT=http \
MCP_HTTP_PORT=9000 \
MCP_HTTP_HOST=0.0.0.0 \
ES_URL=your-elasticsearch-url \
ES_USERNAME=elastic \
ES_PASSWORD=your_pass \
npx @tocharianou/elasticsearch-mcp
```

**HTTP Streamable Mode Features:**
- Exposes MCP server at `http://host:port/mcp` endpoint
- Health check available at `http://host:port/health`
- Session-based connection management
- Supports both POST (JSON-RPC requests) and GET (SSE streams)
- Compatible with any HTTP client or MCP SDK

**Example HTTP client usage:**
```javascript
// Initialize connection
const response = await fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'my-client', version: '1.0.0' }
    },
    id: 1
  })
});

const sessionId = response.headers.get('mcp-session-id');

// Subsequent requests include session ID
const toolsResponse = await fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'mcp-session-id': sessionId
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/list',
    params: {},
    id: 2
  })
});

// Call a tool (e.g., list_indices)
const indicesResponse = await fetch('http://localhost:3000/mcp', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'mcp-session-id': sessionId
  },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'list_indices',
      arguments: {}
    },
    id: 3
  })
});
```

## Contributing

We welcome contributions from the community! For details on how to contribute, please see [Contributing Guidelines](/docs/CONTRIBUTING.md).

## How It Works

1. The MCP Client analyzes your request and determines which Elasticsearch operations are needed.
2. The MCP server comunicate with ES.
3. The MCP Client processes the results and presents them in a user-friendly format, including highlights, aggregation summaries, and anomaly insights.

## Security Analysis Examples

> [!TIP]
> Here are security-focused queries you can try with your MCP Client.

**Threat Detection:**
* "Analyze brute force attack attempts in the past 24 hours"
* "Detect abnormal login behavior and suspicious IP addresses in the system"
* "Identify potential SQL injection attack patterns and malicious requests"
* "Discover DDoS attack signatures and traffic anomalies in network flows"

**Root Cause Analysis:**
* "Trace the complete attack chain and impact scope for specific security incidents"
* "Analyze root causes and propagation paths of system failures"
* "Identify data breach sources and involved sensitive information"
* "Investigate user privilege abuse incidents with timeline and operation records"

**Threat Intelligence:**
* "Create machine learning models to detect zero-day attacks and unknown threats"
* "Establish behavioral baselines and identify activities deviating from normal patterns"
* "Analyze threat levels and attack history of malicious domains and IP addresses"
* "Detect behavioral characteristics and attack patterns of Advanced Persistent Threats (APT)"

**Real-time Monitoring:**
* "Monitor active threats and ongoing attacks in the current system"
* "Detect abnormal data access patterns and privilege escalation behaviors"
* "Discover suspicious network communications and data exfiltration activities"
* "Identify security causes of abnormal system resource consumption and performance degradation"

## Security Best Practices

> [!WARNING]
> Avoid using cluster-admin privileges. Create dedicated API keys with limited scope and apply fine-grained access control at the index level to prevent unauthorized data access.

You can create a dedicated Elasticsearch API key with minimal permissions to control access to your data:

```POST /_security/api_key
{
  "name": "es-mcp-server-access",
  "role_descriptors": {
    "mcp_server_role": {
      "cluster": [
        "monitor"
      ],
      "indices": [
        {
          "names": [
            "index-1",
            "index-2",
            "index-pattern-*"
          ],
          "privileges": [
            "read",
            "view_index_metadata"
          ]
        }
      ]
    }
  }
}
```

## License

This project is licensed under the Apache License 2.0.

## Troubleshooting

* Ensure your MCP configuration is correct.
* Verify that your Elasticsearch URL is accessible from your machine.
* Check that your authentication credentials (API key or username/password) have the necessary permissions.
* If using SSL/TLS with a custom CA, verify that the certificate path is correct and the file is readable.
* Look at the terminal output for error messages.

If you encounter issues, feel free to open an issue on the GitHub repository.

## Running with a Trial License

If your Elasticsearch cluster does not have a valid license, you can activate a 30-day trial license with the following command:

```bash
curl -X POST -u elastic:your_password \
  -k "https://your-es-host:9200/_license/start_trial?acknowledge=true"
```

- Replace `your_password` and `your-es-host` with your actual credentials and host.
- This will enable all features for 30 days.

> **Note:** This project will not start if your cluster does not have a valid license (trial, platinum, enterprice etc.).
