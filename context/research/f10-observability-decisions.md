# F10 — Decisões de observabilidade operacional, health e alertas

Estado: pesquisa consolidada; recomendações ainda não aprovadas.
Data de verificação: 2026-10-08.
Contrato de origem: `context/current-work.md` (`Draft`).

## 1. Resultado executivo

Recomenda-se uma arquitetura híbrida e vendor-neutral:

- contratos C4G fechados para logs, métricas, spans/contexto, health, dependency probes e alertas;
- `pino@10.4.0` apenas como encoder/logger JSON por adapter C4G, escrevendo NDJSON sanitizado para `stdout`, sem transport externo ou ficheiro;
- OpenTelemetry JavaScript para tracing e metrics, com `@opentelemetry/api@1.9.1`, `@opentelemetry/sdk-node@0.223.0`, `@opentelemetry/sdk-trace-node@2.12.0`, `@opentelemetry/sdk-metrics@2.12.0`, `@opentelemetry/instrumentation-http@0.223.0` e `@opentelemetry/instrumentation-express@0.71.0`, todos fixados exatamente e isolados por adapters;
- não usar o OpenTelemetry Logs SDK na F10 v1: a implementação JavaScript de logs continua em estado *Development*, embora o modelo de dados de logs seja estável; Pino é mapeado para esse modelo por contrato próprio ([estado oficial das linguagens](https://opentelemetry.io/docs/languages/), [modelo de logs](https://opentelemetry.io/docs/specs/otel/logs/data-model/));
- nenhum exporter de rede na implementação local; exporters/doubles in-memory determinísticos são obrigatórios e OTLP/backends reais ficam como gate produtivo;
- W3C Trace Context validado para propagação, baggage proibido, correlation/causation C4G separados de trace IDs e sempre não autoritativos ([W3C Trace Context](https://www.w3.org/TR/trace-context/));
- catálogo versionado de sinais, labels e valores; limite local de 128 séries por instrumento e 4096 no processo, com overflow observável e teste determinístico. O limite é deliberadamente inferior ao default OTel de 2000 por stream e complementa, não substitui, allowlists ([Metrics SDK](https://opentelemetry.io/docs/specs/otel/metrics/sdk/));
- `/health/live` estritamente local e `/health/ready` baseado numa matriz de capabilities/dependências; diagnóstico detalhado somente por port interno, sem endpoint público nesta fase;
- flush/shutdown com deadline total de 30 s e orçamento máximo de 5 s para telemetria; falha de export nunca altera autorização, auditoria ou efeito funcional;
- alert contracts vendor-neutral com severidades `INFO`, `WARNING`, `CRITICAL`, runbooks Markdown locais e thresholds produtivos explicitamente não definidos.

Esta pesquisa fecha comportamento suficiente para implementação local dos 28 critérios. Não escolhe backend, Collector, SIEM, retenção, SLO/SLA, paging, thresholds produtivos ou rollout.

## 2. Factos do repositório e lacunas

### 2.1 Vinculativo

- A arquitetura separa API e worker e proíbe mistura de dados entre organizações.
- F3/F4 fixam contexto organizacional e resolução de dependências no servidor; health não autoriza nem causa fallback.
- F5 exige deny-by-default e separa telemetria das quatro classes de auditoria.
- F7 é o ledger de segurança/negócio; telemetria não o substitui e não recebe o seu payload integral.
- F9 fornece worker/lifecycle, queue/outbox/inbox/dead-letter/reconciliação, clocks e métricas de labels fechadas.
- F11 fornece métricas de storage/scanning, estados fail-closed e nenhuma integração R2/scanner real.
- `SEC-AC-20` e `SEC-AC-21` continuam parciais; esta feature melhora a fundação local, não prova fornecedores ou produção.

### 2.2 Implementado hoje

- `backend/src/authorization/metrics.js`, `backend/src/audit/metrics.js`, `backend/src/async/metrics.js` e `backend/src/documents/metrics.js` aplicam allowlists locais, mas não partilham catálogo, unidades, instrumentos ou exporter.
- `backend/src/audit/health.js` e `backend/src/documents/productionDocuments.js` têm estados específicos; `backend/src/security/databaseReadiness.js` verifica topologia/migrations; `/health/db` expõe apenas bases.
- `backend/src/security/tenantPoolManager.js` mantém circuit breaker e snapshot agregado interno.
- `backend/src/async/workerLifecycle.js` limita shutdown a 30 s, mas o entrypoint worker não compõe telemetria/health.
- `backend/src/server.js`, `productionComposition.js` e um controller Legacy usam `console.*`/logger livre; erros e resultados podem chegar ao logger sem schema transversal.
- Não há dependências OpenTelemetry, Pino ou exporter no manifest atual.

### 2.3 Lacunas reais

- inexistem `TelemetryPort`, schemas de log/spans, propagator comum, catálogo métrico transversal, budgets, health matrix e alert catalog;
- não há lifecycle comum API/worker, flush bounded, buffer/drop policy ou fault injection de exporter;
- não há runbooks operacionais para fila parada, audit mismatch, storage/scanner degradado, exporter overflow ou readiness;
- não há dados operacionais que sustentem SLOs, thresholds, sampling, retenção ou sizing produtivos.

## 3. Fontes externas e versões verificadas

### 3.1 Estado tecnológico

- OpenTelemetry JavaScript declara traces e metrics estáveis e logs em desenvolvimento. A instrumentação pode ser manual ou por bibliotecas registadas no SDK; a documentação alerta para a estabilidade separada das semantic conventions ([status](https://opentelemetry.io/docs/languages/), [instrumentation libraries](https://opentelemetry.io/docs/languages/js/libraries/)).
- A release estável corrente observada é a família `2.12.0`; a família experimental/SDK Node correspondente é `0.223.0`. O registry oficial confirma Node `^18.19.0 || >=20.6.0`, compatível com Node `24.13.1`. O repositório oficial explica a compatibilidade entre pacotes stable e experimental ([releases OTel JS](https://github.com/open-telemetry/opentelemetry-js/releases), [compatibilidade](https://github.com/open-telemetry/opentelemetry-js#package-version-compatibility)).
- Pino `10.4.0` é a release corrente verificada; v10 deixou Node 18, sendo compatível com Node 24. A documentação recomenda processamento/transmissão separado e suporta redaction apenas com paths de configuração, nunca derivados do utilizador ([releases](https://github.com/pinojs/pino/releases), [redaction](https://github.com/pinojs/pino/blob/main/docs/redaction.md), [transports](https://github.com/pinojs/pino/blob/main/docs/transports.md)).
- OTel define limites para atributos e cardinalidade; métricas precisam de proteção própria e overflow explícito. Nomes devem ser lower-case, namespaced, unidades UCUM e durations em segundos ([common attributes](https://opentelemetry.io/docs/specs/otel/common/), [metrics](https://opentelemetry.io/docs/specs/otel/metrics/sdk/), [naming](https://opentelemetry.io/docs/specs/semconv/general/naming/), [units](https://opentelemetry.io/docs/specs/semconv/general/metrics/)).
- Kubernetes distingue liveness (capacidade de progredir/restart) de readiness (aceitar tráfego) e alerta que liveness mal desenhada pode causar falhas em cascata ([probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/)). A F10 usa essa semântica sem introduzir Kubernetes.
- Em Node, listeners de `SIGINT`/`SIGTERM` removem o comportamento de saída por omissão, pelo que o lifecycle tem de terminar explicitamente e não pode confiar em `beforeExit` para terminação explícita ([Node.js 24.13.1 `process`](https://nodejs.org/download/release/v24.13.1/docs/api/process.html)).

### 3.2 Dependências propostas, ainda não autorizadas

| Pacote | Versão exata | Licença | Papel | Integridade observada no registry |
| --- | --- | --- | --- | --- |
| `pino` | `10.4.0` | MIT | encoder/logger NDJSON atrás de adapter C4G | `sha512-bk1ZMTwG/Vymx+zPoa28MhNzucFvXJWp3csrSuxuHPSMeUettaCoQ5Jvg07mtC4JGNpcfTwz41oVCnNgBK9+vA==` |
| `@opentelemetry/api` | `1.9.1` | Apache-2.0 | API estável de trace/metrics/context | `sha512-gLyJlPHPZYdAk1JENA9LeHejZe1Ti77/pTeFm/nMXmQH/HFZlcS/O2XJB+L8fkbrNSqhdtlvjBVjxwUYanNH5Q==` |
| `@opentelemetry/sdk-node` | `0.223.0` | Apache-2.0 | composição Node controlada | `sha512-PPfkgVBB9XVdANmSYeGfp1tG6RdsRFo9m9R6/ZnjvE9+TYTEXO2KYarsdtXQTdHhLSw7yzhSHqsNyUQ6c6W3eg==` |
| `@opentelemetry/sdk-trace-node` | `2.12.0` | Apache-2.0 | provider/processors de trace explícitos | `sha512-9DufH1IlmQMoKAfot5y/FhTP1RnmhLb5K6eKmJO/bvzPjYwPAazoiAUbTZFdPbqxOXN0FEbhZx/e6SB1Og4jmg==` |
| `@opentelemetry/sdk-metrics` | `2.12.0` | Apache-2.0 | meter/views/readers e limites | `sha512-mVMaEHwCUJuY3S4Esn+nT0yQA3qCEGh+SOPJsXygU0Gl453WcsDNjtEa8EfdewMwoLyr1tlofB4fXytVpiXuow==` |
| `@opentelemetry/instrumentation-http` | `0.223.0` | Apache-2.0 | spans HTTP com hooks sanitizados | `sha512-lQkvLeRjEHwDjc2NEEAPUlk4x/0qfjhbZh0U5d2/5rPPRQ7TNvMmOtd/ForpVVPGUBfhtEDrWhqumr7vLMjBtA==` |
| `@opentelemetry/instrumentation-express` | `0.71.0` | Apache-2.0 | spans Express, routes normalizadas | `sha512-U/qhsPrcAHr5PxeoAsHng9fZWK/v+Fx+wvqOTj5kOTASarlv+/098UdE1dD4livq+dE/l50YXMKeORE1lsAHfA==` |

As versões foram verificadas em 2026-10-08 por metadata do registry npm oficial e releases/repositórios oficiais. A aprovação do contrato autoriza fixá-las apenas numa futura implementação F10; não autoriza instalação nesta pesquisa. Exporters OTLP não entram na dependência local: serão selecionados e fixados no gate de integração do backend real.

## 4. Contrato recomendado consolidado

### 4.1 Fronteira e sinais

O domínio recebe um `TelemetryPort` C4G imutável com operações semânticas: `log(eventCode, fields)`, `counter(metricCode, value, labels)`, `histogram(metricCode, value, labels)`, `gauge(metricCode, observe)`, `startSpan(spanCode, context)`, `healthSnapshot(capability)` e lifecycle `forceFlush/shutdown`. Callers nunca passam severity, nome wire, unidade, bucket, exporter, endpoint ou atributos arbitrários; os catálogos resolvem isso.

O adapter Pino recebe somente records já validados e redacted. O adapter OTel recebe somente nomes/atributos produzidos pelos catálogos. Objetos Pino/OTel não atravessam ports e módulos F5/F7/F9/F11 continuam a emitir conceitos próprios por adapters de compatibilidade.

Logs usam Pino; tracing e metrics usam OTel. Logs seguem o modelo estável OTel como formato lógico, mas não usam o Logs SDK JS experimental. Traces v1 cobrem fronteiras HTTP, F9 claim/handler, dependências e reconciliação; não criam span por cada linha/objeto nem capturam payload.

### 4.2 Identidade e contexto

- resource fixo por processo: `service.name=c4g-api|c4g-worker`, `service.version` vindo do manifest/commit aprovado e `deployment.environment.name=local|test|staging|production`; nenhuma organização/tenant/host/instance ID é necessária localmente;
- schema C4G v1 com event/metric/span codes lower-case `c4g.*`, únicos e imutáveis por versão;
- `correlationId`: UUIDv7 interno. Header HTTP externo nunca é reutilizado como ID autoritativo; pode ser guardado apenas como `external_correlation_present=true`. Contexto interno confiável F9/F7 pode preservar o ID após validação;
- `causationId`: UUID opaco interno do predecessor imediato; ausente na raiz;
- `traceparent`/`tracestate`: parsing W3C pelo propagator oficial. Contexto inválido é descartado e nasce root novo. O sampled flag remoto é propagado, mas não decide a gravação local nem privilégios;
- baggage: allowlist vazia e não propagado na v1.

### 4.3 Logs e redaction

Record v1 fechado: `schemaVersion`, `timestamp`, `observedTimestamp`, `service`, `eventCode`, `severity`, `outcome`, `reasonCode?`, `correlationId?`, `causationId?`, `traceId?`, `spanId?`, `attributes`. Severidades internas: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, `FATAL`, mapeadas para OTel 1/5/9/13/17/21 e Pino 10/20/30/40/50/60.

O catálogo fixa severity e fields por event code. O caller fornece somente valores dos fields declarados. Attributes: máximo 24, nesting máximo 4, arrays máximo 16, strings máximo 256 bytes e record serializado máximo 8 KiB. Input circular, accessor, function, symbol, bigint não normalizado, class instance ou prototype não simples é recusado. Redaction ocorre antes de Pino; a redaction Pino é segunda defesa com paths constantes e `remove: true`, nunca paths externos.

PII allowlist bootstrap vazia. IDs operacionais só podem aparecer em logs quando o schema os admitir como opacos para diagnóstico e nunca como labels; porém user/session/document/object/tenant IDs ficam proibidos na v1. Error records aceitam `errorClass`, `reasonCode`, `retryable` fechado e boundary; nunca `error.message`, stack, cause externo ou objeto `Error` cru.

### 4.4 Tracing e sampling

Spans têm nomes do catálogo, route templates em vez de URL/path com IDs e atributos fechados. Não são registados query strings, headers arbitrários, bodies, SQL statements, DB names, peer endpoints, exception messages/stacks, queue payloads ou document metadata.

Default local/test: gravação determinística 100% com máximo de 32 atributos por span, 64 events e 128 links por trace root; tests também exercitam `DROP_ALL`. Isto é um default de validação, não sampling produtivo. Produção exige taxa/budget aprovado; remote sampled flag não aumenta o budget local. Errors não furam sampling automaticamente, evitando que input hostil controle volume; outcomes agregados permanecem em metrics.

### 4.5 Métricas e cardinalidade

O catálogo v1 define para cada instrumento: nome `c4g.*`, tipo, descrição, unidade UCUM, monotonicidade, buckets, labels/valores, owner e budget. Unidades não aparecem no nome. Durações são segundos, bytes `By`, contagens `{operation}`/`{error}` ou `1` quando apropriado.

Labels transversais permitidas: `service`, `operation`, `result`, `reason_bucket`, `error_class`, `dependency_class`, `queue_class`, `worker_role`, `audit_class`, `storage_operation`, `scan_result`, `circuit_state`, `health_state`; cada valor vem de enum por instrumento. Route usa template allowlisted; status HTTP vira `status_class` (`2xx`…`5xx`), nunca status/path livre.

IDs de organização, tenant, utilizador, membership, sessão, recurso, job, execution, event, stream, documento, object key, correlation/trace/span são proibidos em labels. Resource também não recebe tenant; `service.instance.id` fica omitido localmente e só poderá ser ativado por gate operacional sem entrar nos budgets de tenant.

Defaults locais: máximo 128 séries por instrumento/ciclo e 4096 por processo; overflow agrega em `otel.metric.overflow=true` e incrementa `c4g.telemetry.cardinality_overflow`. Views removem atributos não catalogados antes da agregação. O teste calcula o produto cartesiano dos enums e recusa catálogo acima do budget.

Buckets locais, versionados e não SLO:

- HTTP/dependency duration: `0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10` s;
- jobs/reconciliation/scan: `0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60, 120, 300` s;
- queue/backlog age: `1, 5, 10, 30, 60, 300, 900, 3600` s;
- payload/stream bytes: `1024, 16384, 262144, 1048576, 16777216, 52428800, 104857600` By;
- utilization/saturation: histogram `0.1, 0.25, 0.5, 0.75, 0.9, 1`.

### 4.6 Health e dependências

Endpoints:

- `GET /health/live`: sem auth, apenas `{status:"LIVE",schemaVersion:1}`; não chama dependências, 200 se event loop/lifecycle não está terminal, 503 apenas para estado interno fatal;
- `GET /health/ready`: sem auth para orquestração, corpo `{status:"READY|DEGRADED|UNAVAILABLE",schemaVersion:1,reasons:[codes]}`; 200 para `READY`/`DEGRADED`, 503 para `UNAVAILABLE`; nenhum detalhe de infraestrutura;
- diagnóstico detalhado: `HealthQueryPort` interno, sem route produtiva na F10. Qualquer route futura exige F5 permission/grant próprios e audita a consulta.

Catálogo de capabilities por processo:

| Processo/capability | Dependências obrigatórias | Opcionais/degradáveis |
| --- | --- | --- |
| API bootstrap | config/catálogos F5/F7/F9/F11/F10; logger sink; runtime | exporter remoto ausente quando não obrigatório |
| API Legacy pilot | Legacy DB/readiness existente | schedulers Legacy desligados |
| API OIDC/contexto | Central DB/schema/sessão | integrações não usadas pela request |
| API audit/document | preflight F7/F11 e ports exigidos pela capability | R2/scanner continuam indisponíveis, logo capability documental produtiva não-ready |
| Worker bootstrap | F9 registry/queue contract/lifecycle; F10 | registry produtivo vazio é `READY`, não falha |
| Worker consumer específico | queue/schema/handler/dependências registadas | consumer inexistente não é anunciado |

Probes de readiness: timeout local 2 s, cache 5 s, stale máximo 10 s, single-flight, concorrência máxima 4. Timeout/stale de dependência obrigatória dá `UNAVAILABLE`; opcional dá `DEGRADED`. Estes valores são defaults locais, não thresholds produtivos.

### 4.7 Exporters, buffers e falhas

Local/test usa `InMemoryLogExporter`, `InMemorySpanExporter` e `InMemoryMetricReader` atrás de ports, com reset/dispose apenas em testes e sem socket/filesystem. Pino recebe destination stream in-memory nos testes e `stdout` NDJSON na composição local; nenhum `pino.transport()` ou worker thread externo na v1.

Buffers locais de spans/log delivery: 2048 items/sinal, batch 256, schedule 1000 ms, export timeout 2000 ms, política drop-oldest preservando sinais recentes. Cada drop incrementa contador interno prealocado sem recursão. Métricas usam collection manual em tests e intervalo local 10 s quando composição local explícita. Exporter remoto não existe.

Falha de exporter após startup nunca falha uma operação funcional, nunca repete efeito e nunca altera F5/F7. Se `TELEMETRY_EXPORT_REQUIRED=true` for futuramente configurado, ausência/config inválida falha startup; perda durante runtime torna health `DEGRADED` e, após policy produtiva futura, pode tornar capability operacional `UNAVAILABLE`, mas não reverte efeitos.

### 4.8 Shutdown e clocks

API e worker recebem lifecycle comum: uma execução idempotente para `SIGTERM`/`SIGINT`, stop de listen/claims, drain, flush e shutdown. Deadline total local 30 s; telemetria recebe no máximo os últimos 5 s. Timers usam `unref` quando seguro e são sempre cancelados; promises ficam tracked. Expirado o deadline, define-se `process.exitCode`, regista-se um record sanitizado se possível e termina-se sem `process.exit()` prematuro.

Wall clock UTC gera timestamps; `performance.now()`/monotonic clock mede durations; ambos são injetáveis. Wall clock regressivo não cria duration negativa. Skew não é corrigido por telemetria nem usado como autorização.

### 4.9 Alert contracts e runbooks

Schema fechado: `alertCode`, `version`, `signalCode`, `conditionKind`, `windowKind`, `severity`, `dependencyClass`, `dedupeCode`, `runbookPath`, `evidenceFields`, `enabledByDefault`. Dedupe nunca inclui IDs. Severidades: `INFO` (observação), `WARNING` (degradação/ação planeada), `CRITICAL` (serviço/capability segura indisponível ou integridade ameaçada).

Catálogo local inicial:

- state/event driven e ativo localmente: `startup_config_invalid`, `readiness_unavailable`, `audit_chain_mismatch`, `telemetry_cardinality_overflow`, `telemetry_buffer_overflow`;
- condições estruturais exercitáveis, sem paging: `queue_dead_letter_present`, `reconciliation_late`, `document_scan_unavailable`, `document_checksum_mismatch`, `dependency_circuit_open`, `authorization_cross_org_denied`, `exporter_unavailable`;
- rate/latency/capacity alerts ficam `enabledByDefault:false` até thresholds e janelas produtivos aprovados.

Cada código tem runbook Markdown sob `context/runbooks/observability/`, com objetivo, impacto, sinais permitidos, verificação segura, mitigação reversível, escalation placeholder e limitações. Links são relativos e validados no startup/teste. Nenhum runbook contém endpoint, credential, tenant ou comando destrutivo. Prometheus recomenda que alertas levem a uma consola/runbook e mantenham labels úteis; a F10 usa apenas o princípio estrutural, não adota Prometheus nem regras produtivas ([práticas oficiais](https://prometheus.io/docs/practices/alerting/)).

## 5. Matriz F10-D1–F10-D32

| ID | Pergunta exata extraída | Opções viáveis | Recomendação normativa proposta | Fundamento/impacto/risco/dependências |
| --- | --- | --- | --- | --- |
| F10-D1 | Modelo de instrumentação | OTel direto; próprio; híbrido | `TelemetryPort` C4G fechado + adapters Pino/OTel | Evita lock-in/tipos externos; mais mapping próprio; base de todas as decisões |
| F10-D2 | Sinais da v1 | logs; metrics; traces; combinação | Logs JSON, metrics e traces mínimos; health/alerts como contratos C4G | Cobre AC sem backend; custo bounded |
| F10-D3 | Biblioteca de logging | `console`; Pino; Winston; próprio | `pino@10.4.0`, exact, adapter-only, stdout NDJSON | Mantido/rápido/redaction; transporte externo proibido |
| F10-D4 | SDK OpenTelemetry | oficial; propagação própria; nenhum | API `1.9.1`, SDK Node `0.223.0`, trace/metrics `2.12.0`, HTTP `0.223.0`, Express `0.71.0` | Traces/metrics estáveis; logs SDK excluído; exact pins/lockfile |
| F10-D5 | Exporters locais | in-memory; stdout; OTLP fake | In-memory para todos; Pino stdout local; nenhum OTLP fake | Zero rede e determinismo; não prova wire/export |
| F10-D6 | Backend futuro | OTLP; vendor direto; nenhum | OTLP por adapter futuro; backend por ADR/gate | Vendor-neutral; integração/credentials fora |
| F10-D7 | Nomes de service/resource | livres; deployment; catálogo | `c4g-api`/`c4g-worker`, env fechado, version aprovada | Sem tenant/host; resource estável |
| F10-D8 | Schema/versionamento | ad hoc; SemVer; inteiro | Catálogos v1 inteiros, imutáveis, startup atomic validation | Evolução explícita; incompatível falha fechado |
| F10-D9 | Sampling de traces | always-on; ratio; parent | 100% local bounded; policy interna futura; remote flag não aumenta budget | Determinismo local; sizing produtivo gate |
| F10-D10 | Propagação | W3C; B3; própria | W3C `traceparent`/`tracestate` pelo propagator oficial | Interoperável; input inválido cria root novo |
| F10-D11 | Baggage permitido | livre; allowlist; proibido | Proibido/allowlist vazia v1 | Evita PII/authority smuggling |
| F10-D12 | Correlation IDs | trace ID; UUID; caller | UUIDv7 C4G separado; HTTP caller substituído; contexto interno validado preserva | Liga F7/F9 sem fazer trace autoritativo |
| F10-D13 | Redaction | denylist; allowlist; híbrido | Schema allowlist primeiro + redaction defensiva Pino constante | Fail-closed; canários/testes obrigatórios |
| F10-D14 | PII | nenhuma; subset; hashing | Allowlist PII vazia v1; hashing não é anonimização | Exceções exigem decisão privacy/retention |
| F10-D15 | Catálogo de logs | livre; central; módulo | Registry central v1 com ownership por módulo e fields fechados | Impede level/name injection; startup valida |
| F10-D16 | Métricas | livres; common; por feature | Registry comum v1 + adapters F5/F7/F9/F11 | Preserva semântica e padroniza units/buckets |
| F10-D17 | Labels/budgets | guideline; reject; overflow | Enums fechados, 128/instrumento e 4096/processo, overflow métrico | Muito abaixo do default OTel; produção mede antes de alterar |
| F10-D18 | Histograms/buckets | SDK default; por instrumento; raw | Buckets versionados da secção 4.5, UCUM | Defaults locais não SLO; mudança exige versão |
| F10-D19 | Health endpoints | único; live/ready; diagnóstico | `/health/live`, `/health/ready`; diagnóstico apenas port interno | Evita leak e falsa equivalência |
| F10-D20 | Estados | binário; ternário; capability | `READY/DEGRADED/UNAVAILABLE` + reason codes | `DEGRADED` 200 só se capability admitida continua segura |
| F10-D21 | Dependency criticality | global; processo; operação | Matriz versionada por processo/capability | Evita tornar opcional uma dependência funcional |
| F10-D22 | Execução de probes | request; cache; background | timeout 2 s, cache 5 s, stale 10 s, single-flight, max 4 local | Bounded; valores produtivos gate |
| F10-D23 | Exporter failure | crash; block; buffer/drop | Não altera efeito; degrade + drop accounting; required inválido falha startup | Telemetria não vira transação funcional |
| F10-D24 | Buffer/backpressure | ilimitado; block; drop | 2048, batch 256, drop-oldest, contador não recursivo | Memória bounded; possível perda explícita |
| F10-D25 | Flush/shutdown | ilimitado; best-effort; deadline | total 30 s, flush final 5 s, idempotente/tracked | Alinha F9 e Node signals; produção pode reduzir após sizing |
| F10-D26 | Clock/timestamps | wall; monotonic; provider | UTC wall para instantes, monotonic para durations, ambos injetáveis | Evita duration negativa e testes flaky |
| F10-D27 | Error sampling | todos; probabilístico; agregado | Metrics para todos os outcomes; logs/traces segundo catálogo/sampler; error não força sample | Input hostil não controla volume |
| F10-D28 | Alert catalog/severity | livre; catálogo; backend-specific | `INFO/WARNING/CRITICAL`, catalogado, sem paging automático | Portável e suficiente localmente |
| F10-D29 | Alert conditions | thresholds já; forma; defaults | Estados determinísticos ativos; rates/latency desativados até dados produtivos | Fecha contrato sem inventar thresholds |
| F10-D30 | Runbooks | texto livre; Markdown; URLs | Markdown local versionado, links relativos validados | Audível/testável; operação real futura |
| F10-D31 | SLI/SLO/retention | agora; interface; adiar | Instrumentos agora; SLI/SLO, retention/error budgets como gates | Sem dados não há metas defensáveis |
| F10-D32 | Rollout/testes | backend; collector; doubles | In-memory/dados sintéticos; zero network; backend/collector posterior | Implementação local independente de F4.4 |

Cobertura: **32/32**. As recomendações são mutuamente compatíveis: o contrato C4G limita dados antes dos adapters; Pino não disputa o OTel Logs SDK; OTel trata apenas trace/metrics; budgets precedem export; health não autoriza; exporter failure não altera F7; alertas consomem agregados, não payloads.

## 6. Defaults locais e gates produtivos

| Tema | Default local aprovado proposto | Gate produtivo |
| --- | --- | --- |
| trace sampling | 100%, bounded | taxa/policy após volume, custo e privacy |
| cardinalidade | 128/instrumento; 4096/processo | sizing e backend query model |
| atributos/record | 24 attrs; depth 4; string 256 B; log 8 KiB | revisão de schemas/classificação |
| buffers | 2048/sinal; batch 256; drop-oldest | memória/carga e semantics do exporter |
| export/collection | 1 s batch; 2 s timeout; metrics 10 s | backend/OTLP/rede e custos |
| readiness probes | timeout 2 s; cache 5 s; stale 10 s; concurrency 4 | latência/traffic e orquestração reais |
| shutdown | 30 s total; 5 s flush | platform termination grace real |
| alert severity | três níveis | ownership/on-call/escalation |
| alert thresholds | apenas estados determinísticos | taxas, janelas, `for`, recovery, paging |
| retention | apenas memória do processo/teste | política jurídica/operacional/backend |
| SLI/SLO | instrumentos, sem objetivos | dados de staging/produção e aprovação humana |

## 7. Impacto nos 28 critérios

| Critério | Estado após aprovação | Decisões/evidência implementável | Gate restante |
| --- | --- | --- | --- |
| F10-AC-01 | Completamente determinado | D3, D8, D15; Pino + schema v1 | nenhum local |
| F10-AC-02 | Completamente determinado | D1, D15; lookup por event code | nenhum local |
| F10-AC-03 | Completamente determinado | D13–D15; canários/limits | fornecedores reais futuros |
| F10-AC-04 | Completamente determinado | D14; allowlist vazia | exceção PII futura |
| F10-AC-05 | Completamente determinado | D13, D15, D27 | nenhum local |
| F10-AC-06 | Completamente determinado | D10–D12 | canais reais futuros |
| F10-AC-07 | Completamente determinado | D4, D9–D11 | interop real futura |
| F10-AC-08 | Completamente determinado | D7, D16–D17 | nenhum local |
| F10-AC-09 | Completamente determinado | D17; 128/4096 + overflow | sizing futuro |
| F10-AC-10 | Completamente determinado | D8, D16–D18 | nenhum local |
| F10-AC-11 | Completamente determinado | D1–D8, D32 | nenhum local |
| F10-AC-12 | Completamente determinado | D19–D22 | orquestrador real futuro |
| F10-AC-13 | Completamente determinado | D19–D22; matrix | dependências reais futuras |
| F10-AC-14 | Completamente determinado | D19–D20 | nenhum local |
| F10-AC-15 | Completamente determinado | D20–D21 | thresholds operacionais futuros |
| F10-AC-16 | Completamente determinado | D6–D8, D21, D23 | backend real futuro |
| F10-AC-17 | Completamente determinado | D24–D26 | grace da plataforma futura |
| F10-AC-18 | Completamente determinado | D23–D25 | loss budget produtivo futuro |
| F10-AC-19 | Completamente determinado | D1–D2, D13, D23 | integração de emissores reais |
| F10-AC-20 | Completamente determinado | D16–D18; adapter F9 | consumers reais futuros |
| F10-AC-21 | Completamente determinado | D16–D18; adapter F11 | R2/scanner reais futuros |
| F10-AC-22 | Completamente determinado | D16–D18, D21 | fleet real futura |
| F10-AC-23 | Completamente determinado | D28–D30 | paging/backend/owners reais |
| F10-AC-24 | Completamente determinado | D29, D31 | dados produtivos necessários |
| F10-AC-25 | Completamente determinado | D5, D9–D27, D32 | nenhum local |
| F10-AC-26 | Completamente determinado | D5–D6, D23 | handshake OTLP futuro |
| F10-AC-27 | Completamente determinado | D5, D32 | nenhum local |
| F10-AC-28 | Completamente determinado | D3, D15, D32 | módulos Legacy fora do cohort |

Resultado: **28 completamente determinados, 0 parcialmente determinados, 0 bloqueados para implementação local**. Integrações e claims produtivos continuam gates explícitos e não reduzem a testabilidade local dos critérios.

## 8. Plano de testes recomendado

- Unitários: catálogos, schemas, Pino mapping, OTel adapters, redaction, limits, error taxonomy, UUIDv7/correlation, W3C parsing, baggage vazio, sampler, clocks, views/buckets e health state machine.
- Contratos: mesmos ports em API/worker; in-memory exporters; exact schemas; unknown signal/attribute/label/value recusado; shutdown idempotente.
- Adversariais: caller controla level/event/trace flags; baggage/headers enormes; query/path/ID; circular/prototype/accessor/class instance; error canaries; label Cartesian overflow; exporter reject/hang; clock regressivo.
- API: route template, outcome/status class, correlation response, live sem I/O, ready com matrix, response sanitizada, stop admission e connections drenadas.
- Worker: F9 envelope/context, spans de claim/handler, retries/dead-letter/lease/reconcile metrics, queue unavailable, zero job payload e shutdown 30/5.
- F5/F7: deny permanece deny; evento crítico continua dependente do AuditPort e não do TelemetryPort; audit payload não aparece em records/spans.
- F11: intents/scan/checksum/orphan/provider categories sem key/URL/filename/document ID.
- Cardinalidade: enumerate todos os enums, assegurar <=128 por instrumento e <=4096 processo; valor desconhecido vai a bucket fechado/overflow sem nova série.
- Alertas/runbooks: catálogo válido, links locais existentes, dedupe sem IDs, conditions de estado determinísticas e rate alerts desligados.
- Benchmark local: overhead p50/p95 do logger/schema/redaction, start/end span, counter/histogram e flush; mede mas não cria SLO.
- Structural scan: `console.*`, Pino/OTel imports fora de adapters/composition, log arbitrary objects, IDs em labels, network exporters, endpoints, secrets e testes ignorados.

## 9. Riscos residuais e experiências

- Auto-instrumentation pode capturar atributos indesejados; começar apenas com HTTP/Express explicitamente configurados e hooks que removem URL/query/headers, validando snapshots antes de ampliar.
- Pino redaction é segunda defesa, não substitui schemas: wildcard paths têm custo e paths externos são inseguros segundo a própria documentação.
- OTel JavaScript combina famílias stable/experimental; exact pins e contract tests evitam upgrade silencioso. Qualquer upgrade exige pesquisa de compatibilidade e regeneração do lockfile.
- O limite 128 pode overflow sob catálogo mal desenhado; o teste cartesiano e a métrica de overflow tornam isso visível. Produção não aumenta o limite sem sizing.
- Stdout pode bloquear/falhar conforme o host. A F10 local testa stream fault/slow consumer; política de runtime/agent é gate operacional.
- Readiness por capability reduz falso negativo global, mas exige que cada route/job declare capability fixa; ausência de declaração falha fechado.
- Alertas sem thresholds produtivos não oferecem on-call. Esta limitação é deliberada e deve permanecer visível.

## 10. Texto único para aprovação humana

> Aprovo conjuntamente F10-D1–F10-D32 conforme `context/research/f10-observability-decisions.md`: contrato C4G fechado com adapters substituíveis; `pino@10.4.0` para logs NDJSON stdout, sem transport/file/backend; OpenTelemetry oficial apenas para traces e metrics com `@opentelemetry/api@1.9.1`, `@opentelemetry/sdk-node@0.223.0`, `@opentelemetry/sdk-trace-node@2.12.0`, `@opentelemetry/sdk-metrics@2.12.0`, `@opentelemetry/instrumentation-http@0.223.0` e `@opentelemetry/instrumentation-express@0.71.0`, todos exactos, sem Logs SDK JS; exporters obrigatórios in-memory e sem rede localmente, OTLP/backend reais futuros; services `c4g-api`/`c4g-worker`, schemas/catálogos v1 e signal codes `c4g.*`; W3C Trace Context validado, baggage proibido, correlation UUIDv7 interno separado, caller incapaz de escolher sampling/authority; sampling local 100% bounded, produção pendente; allowlist antes de redaction defensiva, PII allowlist vazia, logs até 8 KiB/24 atributos/depth 4/string 256 B e erro externo sempre sanitizado; métricas UCUM com labels/enums fechados, sem IDs, budgets 128 séries por instrumento e 4096 por processo, overflow observável e buckets locais versionados; `/health/live` sem dependências, `/health/ready` com `READY/DEGRADED/UNAVAILABLE`, diagnóstico só por port interno, matriz de criticalidade por processo/capability e probes locais timeout 2 s/cache 5 s/stale 10 s/concurrency 4; exporter failure nunca altera efeito, F5 ou F7, buffers 2048/batch 256/drop-oldest/export timeout 2 s, shutdown 30 s com flush final máximo 5 s, wall UTC e monotonic clocks injetáveis; severidades de alerta `INFO/WARNING/CRITICAL`, state alerts locais, rate/latency alerts desativados até dados, runbooks Markdown versionados; SLI/SLO, thresholds, sampling produtivo, retention, backend/Collector/SIEM, credentials, paging/on-call, staging, produção e rollout continuam gates. Esta aprovação permite promover F10 para `Ready` e elaborar o plano técnico local, mas não autoriza implementação, instalação, rede/exporters reais, configuração produtiva, dados reais, F4.4/F4.5, rollout ou deploy.

## 11. Texto sugerido para `context/current-work.md` após aprovação

```markdown
## Feature e estado

- Tipo: `Feature`
- Estado: `Ready`
- Nome: **F10 — Observabilidade operacional, health e alertas**
- Reserva histórica: concretiza a parcela de observabilidade da antiga `F10 — Segredos e operação`; segredos, backup/restore, RPO/RTO e operação produtiva continuam fora.
- Contrato aprovado: `context/research/f10-observability-decisions.md`.

## Decisões confirmadas

F10-D1–F10-D32 foram aprovadas conjuntamente: `TelemetryPort` C4G fechado; Pino 10.4.0 para logs; OpenTelemetry API 1.9.1/SDK Node 0.223.0/trace e metrics 2.12.0/instrumentations HTTP 0.223.0 e Express 0.71.0; sem OTel Logs SDK; exporters in-memory e zero rede local; W3C Trace Context, baggage vazio e correlation UUIDv7 interno; schemas/catálogos v1; allowlist/redaction, PII bootstrap vazia e limits fechados; métricas UCUM com labels fechadas, budgets 128/4096 e overflow; sampling local 100% bounded; `/health/live` local, `/health/ready` por capability e diagnóstico apenas por port; probes 2 s/5 s/10 s/concurrency 4; exporter failure não altera efeitos/F5/F7; buffers 2048, batch 256, drop-oldest, timeout 2 s; shutdown 30 s/flush 5 s; clocks wall+monotonic; alert severities INFO/WARNING/CRITICAL e runbooks locais. Defaults locais não são SLOs.

## Gates futuros

OTLP/backend/Collector/SIEM, credentials, retenção, sampling/sizing/thresholds produtivos, SLI/SLO/SLA/error budgets, paging/on-call, integrações reais, F4.4/F4.5, staging, produção, rollout e deploy continuam fora e não reabrem o contrato local.

## Plano técnico

1. Catálogos/schemas comuns de logs, metrics, spans, errors, health e alerts.
2. Ports C4G e adapters Pino/OTel exactos, com exporters in-memory.
3. Contexto/correlation/W3C em API e worker.
4. Redaction/sanitização e migração dos `console.*` abrangidos.
5. Registry de métricas, views, budgets e adapters F5/F7/F9/F11.
6. Liveness/readiness, dependency matrix, probes e startup validation.
7. Buffers, exporter failure, lifecycle API/worker e shutdown bounded.
8. Alert catalog, runbooks e health/metric contracts.
9. Testes 28/28, scans adversariais, benchmark local e revisão formal.

## Gate de prontidão

A aprovação conjunta fecha todas as decisões comportamentais necessárias à implementação local. F10 está `Ready`, ainda não iniciada; implementação deve permanecer offline, sintética e sem backend/exporter real.
```

## 12. Fontes

### Internas

- `AGENTS.md`; `context/project-overview.md`; `context/architecture.md`; `context/coding-standards.md`
- `context/features/security-privacy-and-audit-foundation.md`
- históricos F2–F5, F7, F9 e F11; pesquisas F5/F7/F9/F11
- `backend/src/app.js`, `server.js`, `worker.js`, `productionComposition.js`
- módulos de metrics/health/lifecycle F5/F7/F9/F11 e `security/databaseReadiness.js`, `tenantPoolManager.js`
- `backend/package.json` e `backend/package-lock.json`

### Externas primárias

- [OpenTelemetry — language status](https://opentelemetry.io/docs/languages/)
- [OpenTelemetry JS repository, compatibility and feature status](https://github.com/open-telemetry/opentelemetry-js)
- [OpenTelemetry JS releases](https://github.com/open-telemetry/opentelemetry-js/releases)
- [OpenTelemetry instrumentation libraries](https://opentelemetry.io/docs/languages/js/libraries/)
- [OpenTelemetry exporters](https://opentelemetry.io/docs/languages/js/exporters/)
- [OpenTelemetry common specification and limits](https://opentelemetry.io/docs/specs/otel/common/)
- [OpenTelemetry Metrics SDK/cardinality](https://opentelemetry.io/docs/specs/otel/metrics/sdk/)
- [OpenTelemetry log data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/)
- [OpenTelemetry semantic conventions 1.44.0](https://opentelemetry.io/docs/specs/semconv/)
- [OpenTelemetry naming](https://opentelemetry.io/docs/specs/semconv/general/naming/)
- [OpenTelemetry metric units/guidelines](https://opentelemetry.io/docs/specs/semconv/general/metrics/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [Pino releases](https://github.com/pinojs/pino/releases)
- [npm registry — `pino@10.4.0`](https://registry.npmjs.org/pino/10.4.0)
- [npm registry — `@opentelemetry/api@1.9.1`](https://registry.npmjs.org/@opentelemetry%2fapi/1.9.1)
- [npm registry — `@opentelemetry/sdk-node@0.223.0`](https://registry.npmjs.org/@opentelemetry%2fsdk-node/0.223.0)
- [npm registry — `@opentelemetry/sdk-trace-node@2.12.0`](https://registry.npmjs.org/@opentelemetry%2fsdk-trace-node/2.12.0)
- [npm registry — `@opentelemetry/sdk-metrics@2.12.0`](https://registry.npmjs.org/@opentelemetry%2fsdk-metrics/2.12.0)
- [npm registry — `@opentelemetry/instrumentation-http@0.223.0`](https://registry.npmjs.org/@opentelemetry%2finstrumentation-http/0.223.0)
- [npm registry — `@opentelemetry/instrumentation-express@0.71.0`](https://registry.npmjs.org/@opentelemetry%2finstrumentation-express/0.71.0)
- [Pino redaction](https://github.com/pinojs/pino/blob/main/docs/redaction.md)
- [Pino transports](https://github.com/pinojs/pino/blob/main/docs/transports.md)
- [Kubernetes liveness/readiness/startup probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-probes/)
- [Node.js 24.13.1 process/signals](https://nodejs.org/download/release/v24.13.1/docs/api/process.html)
- [Prometheus alerting practices](https://prometheus.io/docs/practices/alerting/)

Next step: aprovar, rejeitar ou alterar conjuntamente o contrato F10 antes de promover a feature para `Ready`.
