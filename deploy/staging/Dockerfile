# API do staging. Contexto de construção: a raiz do repositório (ver compose.yaml).
FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY backend/src ./src
COPY backend/database ./database
COPY backend/scripts ./scripts
# O código das oportunidades EU lê estes dois ficheiros da raiz do repositório.
COPY scripts/eu-legacy-receipts-check.cjs scripts/eu-legacy-ledger-reconcile.cjs /app/scripts/
USER node
CMD ["node", "src/server.js"]
