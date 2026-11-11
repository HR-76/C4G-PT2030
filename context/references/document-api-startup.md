# API documental — arranque e diagnóstico AV-01

Atualização 25/10/2026: a resolução documental do diretório usa a operação
restrita Central 031, com organizações da configuração e workload API/WORKER
fixo. Ver [contrato](../features/restricted-tenant-directory.md). O bloqueio
direto de SELECT no diretório foi resolvido. O perfil pg-boss é provisionado
separadamente, conforme [contrato da fila](../features/document-queue-runtime.md).
Prova local concluída em `20261025-195342`: `npm start`, readiness, OIDC real,
intenção documental HTTP 201 e replay 201 após reiniciar o processo, com a mesma
versão e uma única linha persistida. SIGTERM terminou API e worker com código 0.
Storage explicitamente controlado; nenhum gate R2 foi repetido. A tentativa final
desativou notifier npm e FreshClam; uma tentativa anterior teve consulta incidental
do notifier npm, registada como exceção no relatório externo, sem instalação.

No worker, `DOCUMENT_QUEUE_DATABASE_URL` identifica exclusivamente a fila, e
`AUTHORITY_DATABASE_URL`/`AUTHORITY_COMMIT_PERMIT_SECRET` são agora obrigatórios
para o diretório restrito. Não usar a credencial de instalação na fila, nem
atribuir os seus privilégios à autoridade. Provisionamento e migrations são
operações anteriores ao arranque; este não concede permissões.

Estado anterior a esta alteração: factory ligada ao entrypoint; perfil Tenant
validado; bloqueio de leitura do diretório documentado em
`../decisions/2026-10-25-av01-api-runtime-boundary.md`.
Não é um runbook de implantação validado.

## Comando e separação

API: `npm start` em `backend/` (`node src/server.js`).
Worker independente: `npm run worker:documents` em `backend/`.
Nenhum consumidor documental adicional deve ser criado na API.

O entrypoint normal monta a infraestrutura F11/F9 quando explicitamente ativada.
Arranque autónomo local comprovado; não é prova de rollout ou supervisão na VPS.
Credenciais são fornecidas pelo ambiente externo, nunca por payloads HTTP.

## Configuração existente a fornecer na composição final

- Autenticação: `AUTH_MODE=oidc`, `PUBLIC_APP_URL`, `CORS_ORIGIN`, `OIDC_ISSUER`,
  `OIDC_CLIENT_ID`, `OIDC_REDIRECT_URI`, redirect de logout registado,
  `SESSION_SECRET` e política/tempos de assurance definidos no loader de auth.
- Central: `CENTRAL_DATABASE_URL`, `AUTHORITY_DATABASE_URL` e
  `AUTHORITY_COMMIT_PERMIT_SECRET`; logins funcionais separados, sem admin.
- Runtime: `OPPORTUNITIES_RUNTIME=f12`, `OPPORTUNITY_API_CREDENTIALS_JSON`,
  `OPPORTUNITY_ALLOWED_RESIDENCY_JSON`, configuração do leitor do catálogo já
  existente quando `FUNDING_TENDERS_RUNTIME=central`.
- Documentos: `DOCUMENTS_RUNTIME=f11-r2`, `C4G_R2_ENDPOINT`,
  `C4G_R2_DOCUMENTS_BUCKET`, `C4G_R2_QUARANTINE_BUCKET`, `C4G_R2_ACCESS_KEY_ID`,
  `C4G_R2_SECRET_ACCESS_KEY`, `C4G_R2_LAYER_C_VALIDATED`,
  `C4G_R2_MULTIPART_CONDITIONAL_VALIDATED`, `C4G_CLAMAV_HOST`, `C4G_CLAMAV_PORT`.
  Flags de validação não substituem saúde observada. Construir o adapter não
  verifica R2. O endpoint não pode conter userinfo, query ou fragmento.
- Desativar schedulers/bootstrap legacy que não pertencem ao runtime F12:
  `DISABLE_NOTIFICATION_SCHEDULER=true`, `DISABLE_EU_FUNDING_CRON=true`,
  `DISABLE_LEGACY_DATA_BOOTSTRAP=true`. O bootstrap obrigatório de notificações
  também é omitido em F12, sem alteração do comportamento legacy.

A dependência existente de `legacyPool` e do seu preflight não foi removida.
A prova usou uma base vazia separada com login funcional limitado, sem executar
rotas legacy. Não apontar esse pool a Central ou usar administração para contornar
a verificação; a operação do piloto legacy não foi certificada por esta prova.

## Staging e readiness

Reutilizar `createDownloadStaging`: diretório privado exclusivo do processo,
sem serviço estático, ACL efetiva, espaço e quotas verificados, limpeza após
entrega/erro e recuperação restrita. Defaults existentes: 100 MiB/ficheiro,
4 operações, 400 MiB reservados. O diretório absoluto é configurado por
`DOCUMENT_API_STAGING_DIRECTORY`, exclusivo desta instância. A readiness inicializa
e verifica o staging; close liberta o lock somente depois das operações drenadas.

`/health/live` não prova dependências. `/health/ready` mantém os checks existentes;
o check documental observa binding/schema, storage, scanner, worker e staging.
Os checks concorrentes são coalescidos; o registry existente usa cache de 5 s
e timeout de 2 s. Falha ou timeout mantém readiness fechada. Storage/scanner comuns
são consultados uma vez por ciclo, não por organização. Ordem prevista: instalação e
provisionamento fora do arranque, Central/Tenant e fila, scanner e worker,
depois API. A prova isolada da factory não valida serviços externos.

## Encerramento

`SIGTERM`/`SIGINT` chamam o mesmo shutdown idempotente. Em Windows, IPC STOP do
teste é distinto de sinais do sistema: não prova comportamento de supervisor.
`API_SHUTDOWN_GRACE_MS` e `API_SHUTDOWN_SETTLE_MS` são inteiros de 1 a 300000 ms;
defaults 10000 ms. São prazos por fase, não um único prazo global.

Parar schedulers e admissão, drenar HTTP, destruir apenas sockets próprios após
o grace, aguardar handlers e jobs iniciados, fechar consumidores e pools próprios,
fechar telemetria. Queries/leases ativos impedem o fecho prematuro. Exceder um
prazo devolve falha e conserva dependências ainda ocupadas; não declara CLOSED.
O supervisor futuro terá de tratar esse resultado, sem `process.exit()` oculto.

Erros de configuração/arranque/encerramento escrevem códigos sanitizados, não
strings de ligação. Diagnosticar variáveis exigidas, perfil de roles, fingerprints
e fase de lifecycle; nunca copiar segredos para logs. Configuração inválida não
deve ser corrigida concedendo privilégios mais amplos.

## Provisionamento explícito do perfil documental

Após a instalação oficial Tenant até 032, usar separadamente:
`node scripts/provisionDocumentApiProfile.js`, em `backend/`.
Variáveis externas: `DOCUMENT_API_INSTALL_CONFIRM=PROVISION_DOCUMENT_API_PROFILE`,
`DOCUMENT_API_INSTALL_URL`, `DOCUMENT_API_LOGIN` e `DOCUMENT_API_PASSWORD` (novo login).
Somente a instalação usa a primeira ligação; nunca a fornecer à API funcional.
O comando não concede CONNECT, não publica bindings, não altera diretório ou schema
e não substitui o provisionamento físico F4 existente. CONNECT restrito ao destino,
binding, geração e credencial publicados continuam a ser pré-requisitos separados.

Estados: PROVISIONED, UPGRADED_APPROVED_BASELINE ou ALREADY_CONFORMING. Perfil parcial
ou drift é recusado, sem remoção/concessão reparadora. Não combinar com o perfil
editorial nesta versão do provisionador: a cadeia admitida aqui é exatamente
opportunity + metadata + document. Nunca executar em Dev por rotina.

## Configuração documental adicional

- `DOCUMENT_API_ORGANIZATIONS_JSON`: lista explícita de UUIDs de organizações já
  provisionadas (1–100); os destinos vêm do diretório e credenciais F4 existentes.
- `DOCUMENT_API_STORAGE_MODE=r2` em produção; configuração R2 indicada acima.
- `DOCUMENT_WORKER_HEALTH_URL`: `http://127.0.0.1:<porta>/health/ready` (ou ::1),
  sem userinfo, query ou redirects. Configurar `DOCUMENT_WORKER_HEALTH_PORT` no
  processo independente. Endpoint responde 503 até um ciclo terminar, em erro,
  quando o último ciclo fica obsoleto ou após início do shutdown. Não é supervisor.
- Só em `NODE_ENV=test`: modo `test-provider`, `DOCUMENT_API_TEST_ADAPTERS=enabled`,
  path absoluto `DOCUMENT_API_TEST_PROVIDER` e `DOCUMENT_API_TEST_STORAGE_ROOT`.
  Produção recusa esse modo. Nenhum módulo de teste é importado pelo caminho R2.

A factory usa o pool manager API existente; audit/outbox selecionam opportunity,
repository seleciona document e metadata verifica binding/schema. Não há consumidor
documental na API, migrations ou GRANT no startup. A resolução Central real limitada
usa a operação restrita Central 031; não usa credenciais administrativas.

## Provisionamento explícito da fila

Versão instalada: pg-boss 12.37.0, schema 45. A credencial de instalação prepara
o schema e as três filas do catálogo documental antes de iniciar os processos.
Depois executar `node scripts/provisionDocumentQueueProfile.js` em `backend/`,
com `DOCUMENT_QUEUE_INSTALL_CONFIRM=PROVISION_DOCUMENT_QUEUE_PROFILE`,
`DOCUMENT_QUEUE_INSTALL_URL`, `DOCUMENT_QUEUE_LOGIN` e `DOCUMENT_QUEUE_PASSWORD`
externos. A password só é necessária para criar o perfil; não há rotação implícita.
Não fornecer a ligação de instalação à API ou ao worker.

Estados: PROVISIONED ou ALREADY_CONFORMING. Perfil parcial, privilégios inesperados,
ownership ou catálogo de filas divergente são recusados sem reparação automática.
O perfil pressupõe que `pgboss` contém apenas as três filas documentais standard,
não particionadas e sem dead letter. Outros workloads exigem uma decisão explícita;
este provisionador não lhes concede acesso por conveniência.

Nos ensaios sem rede externa, fornecer também `NPM_CONFIG_UPDATE_NOTIFIER=false`,
`NPM_CONFIG_OFFLINE=true`, `NPM_CONFIG_AUDIT=false`, `NPM_CONFIG_FUND=false` e
`CI=true` aos processos npm. Configurar `CLAMAV_NO_FRESHCLAMD=true` no contentor de
ensaio e verificar os processos; isso não define a política futura de atualização
de assinaturas em operação.

O login NOINHERIT pode selecionar apenas `c4g_document_queue_runtime`, sem ADMIN
ou herança. O cliente seleciona esse role na conexão. São concedidos USAGE em
pgboss, SELECT em version/queue, INSERT em job (CTE de falha), SELECT/INSERT/DELETE
em job_common e UPDATE apenas de blocked, completed_on, heartbeat_on, output,
pending_dependencies, retry_count, started_on e state. O registrar da biblioteca
exige SELECT/INSERT/UPDATE/DELETE em instance. Não há CREATE, TRUNCATE, alterações
de filas, acesso a identidade/diretório ou elevação. CONNECT fica limitado à base
instalada. O startup valida atributos, memberships, ACL e schema; não concede nada.

A API mantém a outbox Tenant pelo role já previsto. Não precisa desta credencial
de fila nem inicia um consumidor. Apenas o worker/relay usa
`DOCUMENT_QUEUE_DATABASE_URL`; não há fallback para CENTRAL_DATABASE_URL ou autoridade.
