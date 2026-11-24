# syntax=docker/dockerfile:1
# Yeastar Audio Monitor — app image (Caddy runs as a separate container, see docker-compose.yml)

ARG NODE_IMAGE=node:24.22.1-bookworm-slim
ARG CLOUDFLARED_IMAGE=cloudflare/cloudflared:2026.10.7

FROM ${CLOUDFLARED_IMAGE} AS cloudflared

# ---- build the dashboard ----
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/app/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY tsconfig.json ./
COPY server ./server
COPY shared ./shared
COPY --from=build /app/web/dist ./web/dist
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
RUN mkdir -p /app/data && chown node:node /app/data

# uid 1000 — the bind-mounted ./data must be writable by it
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# node is PID 1 so SIGTERM reaches the app (it revokes Yeastar API tokens and stops cloudflared)
CMD ["node", "--import", "tsx", "server/index.ts"]
