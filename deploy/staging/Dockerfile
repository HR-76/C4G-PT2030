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
# A listagem do Catálogo lê a evidência arquivada (EU 11145 e plano PT2030) de context/references/opportunity-v2/evidence,
# relativa à raiz da aplicação. Sem esta pasta a listagem falha com ENOENT e a API responde 503. O RUN falha a construção
# se a cópia não chegar à imagem (por exemplo por causa do .dockerignore).
COPY context/references/opportunity-v2/evidence /app/context/references/opportunity-v2/evidence
RUN test -f /app/context/references/opportunity-v2/evidence/eu-11145.json
USER node
CMD ["node", "src/server.js"]
