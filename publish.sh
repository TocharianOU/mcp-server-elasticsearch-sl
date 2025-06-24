#!/bin/bash

# Elasticsearch MCP Server 发布脚本
# 作者: TocharianOU

set -e

echo "🚀 开始发布 mcp-server-elasticsearch-enhanced..."

# 检查当前用户
echo "📋 检查 NPM 用户..."
NPM_USER=$(npm whoami 2>/dev/null || echo "未登录")
if [ "$NPM_USER" != "tocharian" ]; then
    echo "❌ 错误: 请先登录 NPM 账户"
    echo "运行: npm login"
    exit 1
fi

echo "✅ 当前用户: $NPM_USER"

# 清理并构建
echo "🔧 清理旧构建文件..."
rm -rf dist/

echo "🏗️  构建项目..."
npm run build

# 运行测试
echo "🧪 运行许可证检查..."
npm run license-checker

# 显示将要发布的内容
echo "📦 检查包内容..."
npm pack --dry-run

# 确认发布
echo ""
echo "⚠️  准备发布到 NPM..."
echo "包名: mcp-server-elasticsearch-enhanced"
echo "版本: $(node -p "require('./package.json').version")"
echo ""
read -p "确认发布? (y/N): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🚀 发布中..."
    npm publish
    
    echo "✅ 发布成功!"
    echo ""
    echo "📋 下一步:"
    echo "1. 推送代码到 GitHub:"
    echo "   git push origin main --tags"
    echo ""
    echo "2. 用户可以通过以下方式安装:"
    echo "   npm install -g mcp-server-elasticsearch-enhanced"
    echo ""
    echo "3. 查看包信息:"
    echo "   https://www.npmjs.com/package/mcp-server-elasticsearch-enhanced"
else
    echo "❌ 取消发布"
    exit 1
fi 