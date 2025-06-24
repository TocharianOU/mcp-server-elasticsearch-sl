[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/tocharianou-mcp-server-elasticsearch-sl-badge.png)](https://mseep.ai/app/tocharianou-mcp-server-elasticsearch-sl)

# Elasticsearch MCP Server Solution
[![npm version](https://badge.fury.io/js/@tocharian%2Fmcp-server-elasticsearch-sl.svg)](https://www.npmjs.com/package/@tocharian/mcp-server-elasticsearch-sl)
[![Downloads](https://img.shields.io/npm/dm/@tocharian/mcp-server-elasticsearch-sl.svg)](https://www.npmjs.com/package/@tocharian/mcp-server-elasticsearch-sl)
[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/TocharianOU/mcp-server-elasticsearch-sl)

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

<a href="https://glama.ai/mcp/servers/@tocharian/mcp-server-elasticsearch-sl">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@tocharian/mcp-server-elasticsearch-sl/badge" alt="Elasticsearch Security MCP server" />
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

#### Option 1: NPM Installation (Recommended)

1. **Install globally via NPM**
   ```bash
   npm install -g @tocharian/mcp-server-elasticsearch-sl
   ```

2. **Run directly**
   ```bash
   npx @tocharian/mcp-server-elasticsearch-sl
   ```

#### Option 2: Source Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/TocharianOU/mcp-server-elasticsearch-sl.git
   cd mcp-server-elasticsearch-sl
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
           "@tocharian/mcp-server-elasticsearch-sl"
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
           "/path/to/your/mcp-server-elasticsearch-sl/dist/index.js"
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

## Security Analysis Examples

> [!TIP]
> Here are security-focused queries you can try with your MCP Client.

**Threat Detection:**
* "分析过去24小时内是否有暴力破解攻击尝试"
* "检测系统中的异常登录行为和可疑IP地址"
* "识别可能的SQL注入攻击模式和恶意请求"
* "发现网络流量中的DDoS攻击迹象和异常峰值"

**Root Cause Analysis:**
* "追踪特定安全事件的完整攻击链和影响范围"
* "分析系统故障的根本原因和传播路径"
* "识别数据泄露事件的源头和涉及的敏感信息"
* "调查用户权限滥用事件的时间线和操作记录"

**Threat Intelligence:**
* "创建机器学习模型检测零日攻击和未知威胁"
* "建立异常行为基线并识别偏离正常模式的活动"
* "分析恶意域名和IP地址的威胁等级和攻击历史"
* "检测高级持续性威胁(APT)的行为特征和攻击模式"

**Real-time Monitoring:**
* "监控当前系统中的活跃威胁和正在进行的攻击"
* "检测异常的数据访问模式和权限提升行为"
* "发现可疑的网络通信和数据外泄活动"
* "识别系统资源异常消耗和性能下降的安全原因"

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
