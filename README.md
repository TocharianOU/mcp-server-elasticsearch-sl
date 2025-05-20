# Elasticsearch MCP Server (Solution Fork by TocharianOU)

> This is a solution-focused fork maintained by TocharianOU. It enables full interaction with all Elasticsearch APIs, including but not limited to: index management, document CRUD, full-text search, aggregations, machine learning (anomaly detection, job management), case management, ILM (Index Lifecycle Management), snapshots and restore, rollup, data streams, monitoring, cluster and node management, security and user management, and more. Suitable for AI agents, RPA, automation, and data analytics scenarios.

---

This repository contains experimental features intended for research and evaluation and is not production-ready.

Connect to your Elasticsearch data directly from any MCP Client (such as Claude Desktop) using the Model Context Protocol (MCP).

This server connects agents to your Elasticsearch data using the Model Context Protocol. It allows you to interact with your Elasticsearch indices and all Elasticsearch APIs through natural language conversations or programmatic requests.

<a href="https://glama.ai/mcp/servers/@elastic/mcp-server-elasticsearch">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@elastic/mcp-server-elasticsearch/badge" alt="Elasticsearch Server MCP server" />
</a>

## Prerequisites

* An Elasticsearch instance
* **A valid Elasticsearch license (trial, platinum, enterprice.) is required.**
* Elasticsearch authentication credentials (API key or username/password)
* MCP Client (e.g. Claude Desktop)

> ⚠️ This project requires your Elasticsearch cluster to have a valid license. If you do not have a license, you can activate a trial license as shown below.

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

| Environment Variable           | Description                                              | Required |
|-------------------------------|----------------------------------------------------------|----------|
| `ES_URL`                      | Your Elasticsearch instance URL                          | Yes      |
| `ES_API_KEY`                  | Elasticsearch API key for authentication                 | No       |
| `ES_USERNAME`                 | Elasticsearch username for basic authentication          | No       |
| `ES_PASSWORD`                 | Elasticsearch password for basic authentication          | No       |
| `ES_CA_CERT`                  | Path to custom CA certificate for Elasticsearch SSL/TLS  | No       |
| `NODE_TLS_REJECT_UNAUTHORIZED`| Set to `0` to disable SSL certificate validation         | No       |

### Quick Start

1. **Clone the repository**
   ```bash
   git clone https://github.com/TocharianOU/mcp-server-elasticsearch.git
   cd mcp-server-elasticsearch
   ```

2. **Use the correct Node.js version**
   ```bash
   nvm use
   ```

3. **Install Dependencies**
   ```bash
   npm install
   ```

4. **Build the Project**
   ```bash
   npm run build
   ```

5. **Run locally in Claude Desktop App**
   - Open **Claude Desktop App**
   - Go to **Settings > Developer > MCP Servers**
   - Click `Edit Config` and add a new MCP Server with the following configuration:

   ```json
   {
     "mcpServers": {
       "elasticsearch-mcp-server-local": {
         "command": "node",
         "args": [
           "/path/to/your/mcp-server-elasticsearch/dist/index.js"
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

## Contributing

We welcome contributions from the community! For details on how to contribute, please see [Contributing Guidelines](/docs/CONTRIBUTING.md).

## How It Works

1. The MCP Client analyzes your request and determines which Elasticsearch operations are needed.
2. The MCP server comunicate with ES.
3. The MCP Client processes the results and presents them in a user-friendly format, including highlights, aggregation summaries, and anomaly insights.

## Example Questions

> [!TIP]
> Here are some natural language queries you can try with your MCP Client.

* "Create an ILM policy to automatically delete indices older than 30 days."
* "Create a snapshot of the 'orders' index and store it in the 'backup-repo'."
* "Show the total sales by region for the last quarter using aggregation."
* "Move all primary shards of the 'logs' index to node 'es-data-2'."
* "Force merge segments in the 'products' index to optimize storage."
* "Find all orders over $500 from last month."
* "Detect anomalies in error rates for the 'logs' index."
* "Get the cluster health status."

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