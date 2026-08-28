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

**Note:** This solution is designed for security professionals, SOC teams, and threat analysts.

Connect to your Elasticsearch data directly from any MCP Client (such as Claude Desktop) using the Model Context Protocol (MCP). Interact with your Elasticsearch security data through natural language queries for advanced threat analysis and incident response.


## Prerequisites

* An Elasticsearch instance
* Elasticsearch authentication credentials (API key or username/password)
* MCP Client (e.g. Claude Desktop) or HTTP client for remote access

## Multi-Version Elasticsearch Support

**Automatically supports Elasticsearch 5.x - 9.x with intelligent version detection:**

| Version | Status | Client | Notes |
|---------|--------|--------|-------|
| ES 5.x | ✅ | 5.6.22 | EOL - Basic tools only |
| ES 6.x | ✅ | 6.8.8 | EOL - ILM available (6.6+) |
| ES 7.x | ✅ | 7.17.14 | LTS - Full features |
| ES 8.x | ✅ | 8.19.1 | **Recommended** - Latest features, ES\|QL (8.11+) |
| ES 9.x+ | ✅ | Auto-fallback | Future-ready |

**Key Features:**
- **Automatic version detection** - No manual configuration needed
- **Smart client selection** - Loads the right client for your ES version
- **Adaptive features** - Disables unsupported tools (e.g., Data Streams on ES < 7.9, ES|QL on ES < 8.11)
- **Version-specific optimizations** - Handles API differences transparently

**What happens:**
```
Connect → Detect ES version → Load matching client → Register compatible tools
```

## The Query Harness (v0.9.0)

Since v0.9.0 the server ships a **query harness**: a deterministic layer between
the AI model and your cluster. The design philosophy is simple:

> **The model steers; the harness knows.**
> Intent ("find failed logins by user") belongs to the model.
> Correctness (real field names, aggregatability, version quirks) belongs to the harness.

What this means in practice — at the level of principles, not internals:

- **Live truth beats bundled knowledge beats model memory.** Every query is
  checked against the cluster's actual field capabilities before it runs. A
  bundled ECS (Elastic Common Schema) vocabulary provides *meaning*; the live
  cluster provides *existence*. The model's own recollection is never trusted.
- **Unambiguous mistakes are fixed silently; ambiguous ones become guidance.**
  The classic example: a spurious `.keyword` suffix on modern ECS mappings is
  auto-corrected (and the correction is reported); an unknown field blocks the
  doomed query and returns the nearest real fields instead of a provider error.
- **Field knowledge stays out of the context window.** The full ECS dictionary
  (thousands of fields) lives in process memory. The model retrieves only the
  handful it needs, on demand, via `lookup_fields`.
- **Every failure must be actionable.** Raw Elasticsearch errors are rewritten
  with live suggestions and index-naming advice (data stream vs. legacy Beats
  naming, internal indices that should be accessed via Kibana APIs, and so on).
- **The model needs zero version knowledge.** Naming eras, API differences and
  mapping-style differences (legacy `text` + `.keyword` subfield vs. modern
  bare `keyword`) are absorbed entirely by the harness. The same model behaves
  identically against ES 5.6 and ES 9.x — verified by a version test matrix
  covering nine watershed releases (5.6 → 9.0).
- **An escape hatch always exists.** Validation can be bypassed per call
  (`skip_lint`) when the model knows better — e.g. runtime fields defined
  outside the query. The harness assists; it never imprisons.

## SSL/TLS Connection

To connect to Elasticsearch with a self-signed certificate or in a test environment, you can set the following environment variable:

```bash
NODE_TLS_REJECT_UNAUTHORIZED=0
```

> ⚠️ This disables Node.js SSL certificate validation. Use only in development or testing environments. For production, always use a trusted CA certificate.

## Installation & Setup

Install (or run) the server, point it at your cluster via environment
variables, register it in your MCP client, then just start a conversation —
the server connects and registers the tools your ES version supports.

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

#### Option 2: GitHub Release (Standalone Package)

1. **Download release package**
   - Go to [GitHub Releases](https://github.com/TocharianOU/elasticsearch-mcp/releases)
   - Download the latest `.tar.gz` file and its checksum files (`.sha256` and `.sha512`)

2. **Verify package integrity**
   ```bash
   shasum -a 256 -c elasticsearch-mcp-v*.tar.gz.sha256
   # Should output: elasticsearch-mcp-v*.tar.gz: OK
   ```

3. **Extract and use**
   ```bash
   mkdir elasticsearch-mcp && cd elasticsearch-mcp
   tar -xzf ../elasticsearch-mcp-v*.tar.gz
   
   # Run with your Elasticsearch credentials
   ES_URL=https://localhost:9200 ES_API_KEY=your-key node dist/index.js
   ```

#### Option 3: Source Installation

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

5. **Debugging with MCP Inspector** (optional)
   ```bash
   ES_URL=your-elasticsearch-url ES_USERNAME=elastic ES_PASSWORD=your_pass npm run inspector
   ```

### Installation & Integration Notes

**If `npm install -g` misbehaves:**

- *Permission errors (`EACCES`) on global install* — don't `sudo`. Either skip
  the global install entirely and let your MCP client run `npx @tocharianou/elasticsearch-mcp`
  (npx fetches on demand), or set a user-level prefix:
  `npm config set prefix ~/.npm-global` and add it to your `PATH`.
- *Slow or blocked registry* — use a mirror for the install only:
  `npm install -g @tocharianou/elasticsearch-mcp --registry=https://registry.npmmirror.com`.
- *Node version* — requires Node **18+** (`node --version`). Older Node fails
  at startup with ESM/fetch errors, not at install time.
- *`npx` cold start* — the first `npx` run downloads the package; if your MCP
  client times out on first connect, run `npx @tocharianou/elasticsearch-mcp`
  once in a terminal to warm the cache, then reconnect.
- *Fully offline hosts* — use the GitHub Release tarball (Option 2) and point
  your client at `node /path/to/dist/index.js`; nothing is fetched at runtime.

**Claude Desktop** — Settings → Developer → MCP Servers → Edit Config, then add
the JSON block shown above. Restart the app after editing; the server appears
in the tools list of a new conversation.

**Claude Code (CLI)** — register the server per-project or globally:

```bash
claude mcp add elasticsearch \
  -e ES_URL=https://your-es:9200 -e ES_API_KEY=your-key \
  -- npx @tocharianou/elasticsearch-mcp
```

**Any other MCP client / platform integration** — run in HTTP mode
(`MCP_TRANSPORT=http`, see below) and point the client at `http://host:port/mcp`;
this is the recommended shape for containerized platforms, one server instance
per cluster connection.

**Credentials hygiene** — the env vars end up in your client's config file in
plain text. Prefer a scoped, read-only API key (see *Elasticsearch Access
Control* below) over superuser credentials.

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

Any MCP-capable client (or plain JSON-RPC over HTTP) can talk to the `/mcp`
endpoint: initialize once, keep the returned `mcp-session-id` header on
subsequent `tools/list` / `tools/call` requests. Use `/health` for liveness
checks.

## Available Tools

| Tool | Description | Min Version |
|------|-------------|-------------|
| `list_indices` | List indices with pattern filter, health filter, sorting and token-aware summary | ES 5.x+ |
| `get_mappings` | Get field mappings with flat/tree/raw modes, field filtering and multi-index compare | ES 5.x+ |
| `es_search` | Full Query DSL search with auto-highlight, plus harness field validation / auto-fix | ES 5.x+ |
| `lookup_fields` | Find the right field names: ECS vocabulary intersected with the index's real fields | ES 5.x+ |
| `execute_es_api` | Execute any ES REST endpoint directly (GET/POST/PUT/DELETE/HEAD) | ES 5.x+ |
| `get_shards` | Shard info with health analysis, problem detection and recommendations | ES 5.x+ |
| `list_data_streams` | List and analyze Data Streams with ILM info and backing index details | ES 7.9+ |
| `esql_query` | Execute ES\|QL pipe-based queries with harness field validation and tabular output | **ES 8.11+** |

> Tools not supported by your cluster version are automatically skipped at startup.
> `es_search` and `esql_query` accept `skip_lint: true` to bypass the harness
> validation for edge cases (e.g. runtime fields defined outside the query).

### ES|QL Query Tool (`esql_query`)

ES|QL is Elasticsearch's modern pipe-based query language, ideal for analytics and data exploration without complex JSON DSL.

**Example queries:**
```
FROM logs-* | WHERE level == "error" | STATS count = COUNT(*) BY service | SORT count DESC | LIMIT 20
FROM metrics-* | WHERE @timestamp > NOW() - 1 hour | STATS avg_cpu = AVG(cpu.usage) BY host.name
FROM auditbeat-* | WHERE event.action == "user_login" AND event.outcome == "failure" | LIMIT 50
```

**Parameters:**
- `query` — the ES|QL string (required)
- `params` — positional parameters replacing `?` placeholders (optional)
- `include_types` — include column type info in output (optional, default `false`)
- `break_token_rule` — bypass token limit for large results (optional, default `false`)
- `skip_lint` — bypass harness field validation (optional, default `false`)

> Automatically registered only on ES 8.11+ clusters.

## Contributing

We welcome contributions from the community! For details on how to contribute, please see [Contributing Guidelines](/docs/CONTRIBUTING.md).

## How It Works

1. The MCP client (the AI model) decides *what* to look for and calls a tool.
2. The harness validates the request against the live cluster — fixing what is
   unambiguous, blocking what would fail, and translating errors into guidance.
3. Results come back token-bounded and pre-digested (highlights, tables,
   aggregation summaries), so long investigations stay within context limits.

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

### Package Integrity Verification

When downloading release packages, always verify checksums to ensure integrity:

```bash
# Verify SHA256 checksum
shasum -a 256 -c elasticsearch-mcp-vX.Y.Z.tar.gz.sha256

# Verify SHA512 checksum
shasum -a 512 -c elasticsearch-mcp-vX.Y.Z.tar.gz.sha512
```

This protects against:
- Corrupted downloads
- Tampered packages
- Man-in-the-middle attacks

### Elasticsearch Access Control

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
