# npm 严格按 package-lock 的 resolved 地址下载；lock 若被国内镜像污染，
# 该镜像不可达时构建必然失败。强制官方源兜底。
FROM node:22-alpine AS build
WORKDIR /app
RUN npm config set registry https://registry.npmjs.org/ && npm config set fetch-retries 8 && npm config set fetch-retry-maxtimeout 120000 && npm config set fetch-timeout 300000
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
RUN npm config set fetch-retries 8 && npm config set fetch-retry-maxtimeout 120000 && npm config set fetch-timeout 300000 \
    && npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
EXPOSE 3001
CMD ["node", "dist/index.js"]
