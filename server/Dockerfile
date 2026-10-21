# bedrock-sync. Build from the repo root:  docker build -f server/Dockerfile .
FROM node:24-slim AS build
WORKDIR /src
COPY server/package.json ./
RUN npm install --no-audit --no-fund --ignore-scripts
COPY server/tsconfig.json server/tsconfig.build.json ./
COPY server/src ./src
RUN npx tsc -p tsconfig.build.json && npm prune --omit=dev

FROM node:24-slim
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
WORKDIR /app
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY server/package.json ./
# Railway mounts volumes owned by root, so the process runs as root to be able to write /data.
RUN mkdir -p /data
EXPOSE 8080
VOLUME ["/data"]
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/main.js"]
