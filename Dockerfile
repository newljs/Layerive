FROM library/node:24-alpine AS build

WORKDIR /app

# Electron is only needed for desktop packaging; skip its binary download.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY index.html tsconfig.json vite.config.ts ./
COPY src ./src
COPY public ./public
COPY scripts/make-icons.mjs ./scripts/make-icons.mjs
COPY server/plugins/catalog.json ./server/plugins/catalog.json
RUN npm run build
RUN npm prune --omit=dev --no-audit --no-fund

FROM library/node:24-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production \
    LAYERIVE_HOST=0.0.0.0 \
    PIXELFLOW_API_PORT=8788 \
    LAYERIVE_CONTAINER=1 \
    LAYERIVE_DATA_ROOT=/app/data \
    LAYERIVE_CONFIG_ROOT=/app/config

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server
COPY LICENSE ./LICENSE
RUN mkdir -p data config && chown node:node data config

USER node
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:8788/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/index.mjs"]
