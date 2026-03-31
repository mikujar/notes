# 构建前端 + 导出 collections.json，最终由 Node 提供 /api 与静态页面
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json tsconfig.node.json vite.config.ts index.html ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build && npm run export:collections

FROM node:22-alpine AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY server/package.json ./server/
RUN cd server && npm install --omit=dev
COPY server/src ./server/src
COPY --from=build /app/server/data/collections.json ./server/data/collections.json
COPY --from=build /app/dist ./server/public
ENV PORT=3001
ENV DATA_FILE=/data/collections.json
EXPOSE 3001
VOLUME ["/data"]
CMD ["node", "server/src/index.js"]
