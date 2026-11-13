# Decisão: documentos das candidaturas adiados no staging

Estado: aceite pelo utilizador em 13/11/2026. Por implementar.

## Decisão

No staging na VPS, os documentos das candidaturas ficam **desligados** (`DOCUMENTS_RUNTIME` não é gerado). As faturas PDF privadas e a importação PT2030 continuam a poder usar o R2 e o antivírus, como antes. A ativação dos documentos fica para uma fase própria, depois de existir o worker de documentos provisionado.

## Motivo

Na tentativa de 13/11/2026, a API de staging entrou em ciclo de reinícios ao ligar o armazenamento de documentos:

- `DOCUMENT_API_ORGANIZATIONS_JSON`, `DOCUMENT_API_STAGING_DIRECTORY` e `DOCUMENT_WORKER_HEALTH_URL` não estavam no ambiente gerado. A API termina com `C4G_API_START_FAILED`, sem indicar a causa.
- O worker de documentos (`backend/src/documentWorker.js`) exige mais do que uma variável: uma base de fila (`DOCUMENT_QUEUE_DATABASE_URL`), um login restrito de autoridade com o segredo de permissão (`AUTHORITY_DATABASE_URL`, `AUTHORITY_COMMIT_PERMIT_SECRET`), credenciais de worker por organização (`DOCUMENT_WORKER_CREDENTIALS_JSON`) e vínculo ao tenant. Esta parte de provisionamento de papéis e chaves não está validada no projeto.

Adiar evita pôr em produção de staging uma configuração de segurança incompleta e manter a API estável para a equipa.

## Consequências

- O pipeline da candidatura (estados de submissão e resultado, equipa e tarefas) não depende dos documentos e continua disponível.
- Continua por fazer: upload, verificação antivírus, revisão interna e descarga de documentos num ambiente real, com prova de isolamento entre entidades.
- O staging voltou ao estado de antes da tentativa, com `ready=200` na commit `f7134ac`. A alteração de código que ativava os documentos foi revertida no ramo `staging-vps`.

## Para retomar

1. Desenhar o provisionamento do worker de documentos: base de fila com esquema pg-boss, login restrito de autoridade, credenciais por organização e vínculo ao tenant. Esta parte é de segurança e precisa de validação própria.
2. Só depois, alterar o gerador de ambiente e o `compose.yaml` com o serviço do worker, na rede do `pod`.
3. Ativar no staging com `DOCUMENT_API_ORGANIZATIONS_JSON` limitado às entidades autorizadas, depois de o ensaio isolado passar.

Relacionados: [PostgreSQL do staging na VPS](2026-11-12-staging-postgresql-on-vps.md), [Staging na VPS](../features/staging-vps-deployment.md).
