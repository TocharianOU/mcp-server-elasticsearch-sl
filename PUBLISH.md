# NPM 包发布指南

## 📋 发布前准备

### 1. 环境设置
确保你已经安装了 Node.js 18+ 和 npm：
```bash
node --version  # 应该 >= 18
npm --version
```

### 2. 登录 NPM
```bash
npm login
# 输入你的 npm 用户名: tocharian
# 输入你的密码
# 输入你的邮箱: tocharian139@protonmail.com
```

### 3. 验证登录状态
```bash
npm whoami
# 应该显示: tocharian
```

## 🚀 发布流程

### 1. 构建项目
```bash
npm run build
```

### 2. 版本管理
```bash
# 补丁版本 (0.1.2 -> 0.1.3)
npm version patch

# 小版本 (0.1.2 -> 0.2.0)
npm version minor

# 大版本 (0.1.2 -> 1.0.0)
npm version major
```

### 3. 发布到 NPM
```bash
npm publish
```

### 4. 推送到 GitHub
```bash
git push origin main --tags
```

## 📦 包信息

- **包名**: `mcp-server-elasticsearch-enhanced`
- **作者**: TocharianOU <tocharian139@protonmail.com>
- **仓库**: https://github.com/TocharianOU/mcp-server-elasticsearch

## 🔧 用户安装方式

发布后，用户可以通过以下方式安装：

### 全局安装
```bash
npm install -g mcp-server-elasticsearch-enhanced
```

### 本地安装
```bash
npm install mcp-server-elasticsearch-enhanced
```

### 使用 npx 运行
```bash
npx mcp-server-elasticsearch-enhanced
```

## 📝 发布检查清单

- [ ] 更新版本号
- [ ] 运行构建测试: `npm run build`
- [ ] 运行许可证检查: `npm run license-checker`
- [ ] 检查包内容: `npm pack --dry-run`
- [ ] 登录 NPM 账户
- [ ] 发布包: `npm publish`
- [ ] 推送代码和标签到 GitHub
- [ ] 更新 README.md 中的安装说明

## 🔍 发布后验证

1. 检查包是否在 NPM 上可见：
   https://www.npmjs.com/package/mcp-server-elasticsearch-enhanced

2. 测试安装：
   ```bash
   npm install -g mcp-server-elasticsearch-enhanced
   mcp-server-elasticsearch --help
   ```

## ⚠️ 注意事项

1. 确保 GitHub 仓库是公开的
2. 确保所有依赖都是生产就绪的
3. 发布前测试包的完整性
4. 遵循语义化版本控制 