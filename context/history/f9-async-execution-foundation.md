# Trabalho Atual

## Identificação

- Nome: F9 — Fundação de execução assíncrona — worker, outbox/inbox e reconciliação
- Tipo: Feature
- Estado: Complete
- Feature-mãe: Fundação de Segurança, Privacidade e Auditoria

## Objetivo

Definir uma fundação assíncrona multi-instituição, localmente implementável e independente da F4.4, que retire handlers de jobs do processo API e ofereça worker separado, fila por port, outbox transacional, inbox idempotente, entrega pelo menos uma vez, retries limitados, dead-letter e reconciliação. Cada execução deve conservar organização, actor, operação, autorização, correlação e causa a partir de contexto confiável, sem permitir que caller, payload ou infraestrutura escolham tenant, handler ou service actor.

## Problema e riscos

A arquitetura futura separa API e worker, mas a implementação atual ainda executa timers e cron dentro de `backend/src/server.js`, compõe jobs Legacy em `backend/src/productionComposition.js` e possui uma `email_outbox` UBI que pode enviar SMTP no mesmo fluxo em `backend/src/services/emailService.js`. Estes comportamentos são evidência de migração, não o contrato universal.

Sem uma fundação comum, um crash entre commit e publicação pode perder trabalho; redelivery pode duplicar efeitos; jobs podem atravessar organizações, executar após suspensão, usar autorização obsoleta ou aceitar payloads/handlers hostis; leases vencidas podem concluir efeitos; retries ilimitados podem amplificar incidentes; poison messages podem bloquear a fila; e auditoria, métricas ou dead-letter podem expor PII, credenciais ou infraestrutura.

Não se promete `exactly once`. O contrato é entrega pelo menos uma vez, handlers idempotentes, efeitos protegidos por inbox/idempotency key e reconciliação do estado persistido.

## Evidência e estado atual

### Decisões já vinculativas

- A API e o worker são processos/serviços separados; a API não executa handlers de jobs.
- A fila do MVP é PostgreSQL por abstração própria; Redis ou broker dedicado não fazem parte do MVP aprovado.
- A arquitetura admite inicialmente `pg-boss` ou adapter equivalente aprovado, mantendo-o substituível por um port.
- A outbox nasce na mesma transação do dado de origem, na base onde a alteração ocorre; o consumidor usa inbox idempotente.
- Não existem transações distribuídas entre Central e tenants. Entrega é pelo menos uma vez, com retries limitados, locks recuperáveis, dead-letter e reconciliação.
- Falha ao sinalizar a fila após commit não perde o evento: polling adaptativo encontra outboxes pendentes sem manter ligações permanentes a todos os tenants.
- O worker descobre e resolve tenants exclusivamente por contexto confiável e contratos F3/F4; caller e payload não fornecem tenant, ligação, SQL, operação técnica ou infraestrutura.
- F5 vincula jobs humanos à revalidação da membership e jobs sistémicos a service actor interno allowlisted, com organização/operação fixas; retry/replay não amplia autoridade.
- Suspensão/offboarding bloqueiam jobs funcionais associados; exceções futuras pertencem a catálogo operacional separado e allowlisted.
- Auditoria usa as quatro classes F5: crítico pré-efeito, deny preservado, observacional reconciliável e capacidades fora de F5. O port não prova ledger append-only.
- Payloads, logs, eventos e métricas não contêm secrets, tokens, DSNs, documentos integrais ou PII não autorizada; labels não usam tenant, utilizador, recurso ou job IDs de cardinalidade ilimitada.
- Eventos/envelopes são versionados, imutáveis e validados; versões desconhecidas são recusadas/controladas, nunca descartadas silenciosamente. Evolução segue `expand → migrate → contract` e compatibilidade `N`/`N-1` quando aprovada.
- `SEC-AC-11`, `SEC-AC-14` e `SEC-AC-15` estão atribuídos a F9 na matriz existente.

### Padrões realmente implementados

- F2–F5 fornecem sessão/assurance, membership/contexto, tenant resolver/leases/pools, schema compatibility, service actors, adapters de canal e audit port, todos com limites documentados.
- F4.1 tem transações Central, idempotency keys, digests, locks/CAS e evidência local atómica; não é outbox/inbox genérica.
- F4.2 fornece padrões locais de leases, fencing, deadlines, backoff/jitter, limites, shutdown e reconciliação de cleanup; não é worker/fila persistente.
- F5 fornece `JOB` channel adapter, service actor e eventos `SERVICE_JOB_DISPATCHED`/`SERVICE_JOB_COMPLETED`; usa doubles e não integra fila real.
- A API Legacy agenda notificações e sincronização EU Funding no próprio processo por `setInterval`/`node-cron`.
- `email_outbox` e envio SMTP atuais são específicos da UBI, não usam o contrato multi-instituição futuro e não podem ser promovidos a política geral.
- `pg-boss` não consta das dependências instaladas; a escolha do adapter permanece aberta.

### Propostas antigas ou não vinculativas

- Usar diretamente `pg-boss`, reutilizar `email_outbox`, fixar tempos/retentões atuais ou transportar jobs Legacy sem adaptação são apenas possibilidades/evidência histórica.
- Valores de concorrência, leases, heartbeat, polling, retries, payload, retenção e alertas não foram aprovados para produção.

## Dependências satisfeitas

- F1 — harness de testes e doubles sintéticos.
- F2 — identidade, sessão, assurance e necessidade de limpeza/reconciliação por worker.
- F3 — membership central e contexto organizacional revalidável.
- F4.0–F4.3 — contrato de tenant, diretório Central, resolver/leases/pools e compatibilidade de schema.
- F5 — actors, autorização funcional, adapters de canais e taxonomia do audit port.
- Arquitetura e modelo lógico futuros para worker, fila PostgreSQL, outbox/inbox e eventos versionados.

## Gates de implementação e integração preservados

- F9-D1–F9-D21 foram aprovadas conjuntamente em 2026-10-08 segundo `context/research/f9-async-execution-decisions.md`; não resta decisão comportamental necessária para iniciar a implementação local.
- Migrações e persistência fazem parte da implementação futura, mas só podem ser executadas em PostgreSQL 17 descartável. `c4g_central_dev`, `c4g_tenant_dev` e qualquer base persistente permanecem proibidas.
- PostgreSQL 17.11 local sustenta o gate descartável; as bases dev não são fixtures nem ambientes de teste F9.
- Integrações reais de Resend, R2, imports, conectores, reporting, exports e provisioning recebem gates próprios e não são necessárias para a vertical slice sintética.
- Benchmark/sizing, thresholds, SLOs, retenção jurídica, encryption/keys reais, backups/restore, F4.4, staging, produção, rollout, secret manager e auditoria append-only permanecem gates de integração/operacionais posteriores.

## Âmbito

- Entrypoint e lifecycle de worker Node.js separado do processo API.
- Port de fila e adapter PostgreSQL substituível, sem acoplamento do domínio a `pg-boss`.
- Outbox transacional na fonte e relay concorrente/idempotente para a fila central.
- Inbox por consumidor/handler e idempotency key para proteger efeitos sob redelivery.
- Envelope fechado, imutável e versionado com tipo, versão, organização, actor/originator, operação, correlation/causation IDs, idempotency key, deadlines e payload allowlisted.
- Registry versionado de handlers; nenhum handler, service actor, organização, tenant ou infraestrutura escolhido pelo caller.
- Integração com service actors e channel adapters F5; revalidação de membership para jobs humanos.
- Classificação fechada de erros transitórios/permanentes, retries com backoff/jitter, tentativas e deadline limitados.
- Dead-letter, replay explicitamente autorizado e reconciliação de outbox, inbox, fila e efeitos.
- Leases, fencing tokens, heartbeat, recovery após crash, redelivery, cancelamento e graceful shutdown.
- Limites de concorrência global e por organização, fairness e reserva operacional.
- Observabilidade sanitizada e auditoria pelo port F5, preservando as quatro classes.
- Isolamento A/B e falha fechada perante organização, actor, autorização, schema, handler ou envelope inválidos.
- Vertical slice exclusivamente sintética e testes locais descartáveis com PostgreSQL 17.

## Critérios de aceitação

1. **F9-AC-01 — separação de processos:** teste de composição prova que o entrypoint API não importa, regista nem executa handlers/consumers e que apenas o entrypoint worker os pode ativar.
2. **F9-AC-02 — outbox atómica:** teste PostgreSQL confirma que alteração de origem e linha outbox fazem commit/rollback juntas; não existe publicação funcional direta fora desta fronteira.
3. **F9-AC-03 — relay concorrente:** dois relays concorrentes, crash antes/depois do publish e redelivery não perdem a intenção nem criam mais de uma publicação lógica para a mesma idempotency key.
4. **F9-AC-04 — inbox:** redelivery do mesmo envelope para o mesmo consumidor devolve o resultado persistido ou no-op e executa o efeito protegido uma única vez.
5. **F9-AC-05 — handlers idempotentes:** cada handler sintético declara chave/estratégia de idempotência e testes repetidos, concorrentes e pós-crash provam efeito único.
6. **F9-AC-06 — envelope fechado:** validação aceita apenas schema/version, tipo, organização, actor, operação, event/execution/idempotency/correlation/causation IDs, timestamps/deadline e payload allowlisted; faltas, extras, protótipos ou mutação são recusados.
7. **F9-AC-07 — input não confiável:** caller/payload não escolhe handler, service actor, permission, tenant, pool, connection, schema, queue, retry policy ou infraestrutura; adulteração falha antes do efeito.
8. **F9-AC-08 — payload seguro:** testes recusam credentials, DSNs, tokens, secrets, SQL, objetos arbitrários, payload integral de documentos e campos não allowlisted; limites de tamanho e classificação são aplicados antes da persistência/publicação.
9. **F9-AC-09 — autorização F5:** job humano revalida membership/contexto e job sistémico usa service actor interno fixo; suspensão, versão obsoleta, operação divergente ou autoridade ausente recusam antes do handler.
10. **F9-AC-10 — isolamento:** matriz A/B prova que envelope, inbox, outbox, lease, retry, replay e handler da organização A nunca resolvem nem alteram dados/recursos da B, mesmo com IDs válidos ou coincidentes.
11. **F9-AC-11 — classificação de falhas:** tabela exaustiva prova que só códigos transitórios allowlisted recebem retry; falhas permanentes, inválidas, de autorização ou poison messages não entram em loop.
12. **F9-AC-12 — retries limitados:** relógio/RNG injetados provam limites de tentativas, backoff exponencial limitado, jitter dentro da banda, deadline absoluto e ausência de timer/retry após expiração.
13. **F9-AC-13 — dead-letter:** falha permanente ou esgotamento transita atomicamente para dead-letter uma única vez, sem executar novamente o efeito nem bloquear jobs independentes.
14. **F9-AC-14 — evidência de falha:** dead-letter conserva reason code sanitizado, versões, organização, actor mínimo, correlação/causa, tentativas e referência de reconciliação; não conserva stack, secret, DSN ou payload proibido.
15. **F9-AC-15 — lease/fencing:** worker com lease expirada, perdida ou fence antigo não inicia nem conclui efeito; apenas owner/fence corrente pode heartbeat, finalizar ou reagendar.
16. **F9-AC-16 — crash e heartbeat:** testes matam o worker antes, durante e após o efeito, deixam expirar heartbeat/lease e provam recuperação/redelivery sem perda nem efeito duplicado.
17. **F9-AC-17 — shutdown:** `SIGTERM`/shutdown simulado para de reclamar trabalho, limita a drenagem, liberta/expira leases com segurança e deixa cada job concluído ou recuperável, sem sucesso falso.
18. **F9-AC-18 — reconciliação:** scan idempotente deteta e classifica outbox não publicada, publicação sem confirmação, inbox incompleta, job órfão/stuck, lease expirada e divergência terminal; não repara por adoção automática ou ação destrutiva.
19. **F9-AC-19 — observabilidade:** testes/scan provam logs/eventos sanitizados e métricas com labels allowlisted de baixa cardinalidade; tenant/user/resource/job IDs não são labels.
20. **F9-AC-20 — auditoria F5:** doubles exercitam as quatro classes; evento crítico não aceite aborta antes do efeito, falha ao auditar deny nunca permite execução, observacional é reconciliável e ledger append-only não é alegado.
21. **F9-AC-21 — compatibilidade:** versão de envelope/handler desconhecida ou incompatível é recusada/dead-lettered de forma controlada; matriz `N`/`N-1` aprovada é explícita e nenhuma transformação ocorre silenciosamente.
22. **F9-AC-22 — adversarial:** suite determinística cobre redelivery, concorrência, crash, timeout, cancelamento, poison message, starvation/fairness, replay, shutdown, versão desconhecida e falhas do audit/queue ports.
23. **F9-AC-23 — independência:** toda a vertical slice usa organizações, actors, jobs e payloads sintéticos e PostgreSQL 17 descartável; passa sem F4.4, tenant real, Legacy/UBI, Resend, R2, connector, secret manager ou serviço externo.

## Restrições

- Não prometer `exactly once`; documentar e testar entrega pelo menos uma vez, idempotência e efeitos protegidos.
- Não executar handlers no processo API nem usar timers/cron Legacy como fundação F9.
- Não reutilizar `email_outbox`, jobs, roles ou payloads UBI como contrato universal.
- Não aceitar do caller organização confiável, tenant, actor sistémico, handler, operação, permission, queue, SQL ou políticas de retry.
- Não manter ligações permanentes a todos os tenants nem depender de transação distribuída.
- Não emitir dados de alta cardinalidade como labels nem dados sensíveis em logs, auditoria ou dead-letter.
- Não declarar ledger append-only, serviço externo ou canal real integrado por existir um port/double.
- Preservar fail-closed de F3/F4/F5, versions/fences autoritativos e ausência de fallback Central/Legacy/outro tenant.
- O estado `Ready` autoriza apenas planeamento concluído; implementação, branch, migrations, stage, commit e acesso a bases continuam dependentes de ordem posterior explícita.

## Fora do âmbito

- Provisioning/onboarding/offboarding real F4.4 e migração/adaptação UBI F4.5.
- Envio real por Resend, armazenamento real R2, webhooks, conectores externos e imports funcionais.
- Jobs finais de produto, matching, reporting, exports, documentos, retenção ou notificações.
- UI de administração, replay ou operação.
- Staging, produção, deploy, rollout, sizing e políticas operacionais finais.
- Legal hold, prazos de retenção jurídicos e eliminação física.
- Secret manager real e credenciais de fornecedores.
- Dados, organizações, actors, payloads ou tenants reais.
- Ledger append-only definitivo; F9 integra apenas o port/taxonomia F5.

## Ambiente local disponível, não autorizado nesta ação

- PostgreSQL 17.11 local.
- Central dev: `localhost:5433/c4g_central_dev`.
- Tenant dev: `localhost:5433/c4g_tenant_dev`.
- Migrations atuais previamente validadas; nenhuma ligação Central→tenant criada.
- Esta ação `load` não consulta nem altera estas bases. Uma implementação futura deve preferir bases descartáveis e nunca executar migrations nas bases dev sem autorização separada.

## Plano de testes

- Unitários de envelope/registry, schemas fechados, imutabilidade, error taxonomy, retry/backoff/jitter, deadlines, cancelamento, métricas e sanitização.
- Contratos dos ports de fila, relógio, scheduler, audit, autorização, tenant runtime, outbox, inbox e reconciliation.
- Integração descartável PostgreSQL 17 para atomicidade outbox, claim concorrente, inbox/idempotência, leases/fences/heartbeat, dead-letter e recovery.
- Processos separados para provar API sem handlers, worker lifecycle, crash real, redelivery e graceful shutdown.
- Matriz A/B com duas organizações, actor humano e service actor, IDs coincidentes, suspensão/offboarding, autorização obsoleta e tentativas cross-tenant.
- Fault injection antes/depois de commit, publish, claim, heartbeat, efeito, inbox e ack; poison messages e falhas tardias de cleanup.
- Scans de secrets/DSNs/tokens/PII, imports proibidos, timers/handlers na API, fallback Legacy e labels de alta cardinalidade.
- Nenhum contacto com Resend, R2, Keycloak real, conectores ou bases dev; adapters/doubles e dados sintéticos apenas.

## Decisões confirmadas

F9-D1–F9-D21 foram aprovadas conjuntamente em 2026-10-08. A fundamentação, alternativas, contrato consolidado, fontes e bloco de aprovação permanecem em `context/research/f9-async-execution-decisions.md`.

| ID | Decisão aprovada | Limite/gate preservado |
| --- | --- | --- |
| F9-D1 | `QueuePort` C4G fechado com adapter `pg-boss` 12.x substituível e double in-memory. | Domínio não importa objetos/opções da biblioteca; package/schema são versionados. |
| F9-D2 | Fila e coordenação na Central; outbox na base/transação de origem; inbox na base do efeito. | Não existe transação distribuída. |
| F9-D3 | Jobs globais permanecem Central; intenção/efeito tenant-local permanecem no tenant e a fila recebe referências opacas mínimas. | Nenhum DSN, secret ou dado operacional integral na Central. |
| F9-D4 | Schema `pgboss` library-owned na Central e `async_exec` C4G na Central/tenants sintéticos; migrations/manifests explícitos. | Runtime sem DDL; F4.4 aplicará futuramente a tenants reais. |
| F9-D5 | Polling é garantia de progresso; `LISTEN/NOTIFY` é apenas otimização futura. | Perda de notification nunca perde trabalho. |
| F9-D6 | Entrega pelo menos uma vez com inbox, idempotência, fencing e reconciliação; sem `exactly once`. | Duplicação de entrega é esperada; duplicação de efeito é protegida. |
| F9-D7 | Defaults locais: heartbeat 30 s, refresh 10 s, margem de fencing 5 s. | Valores produtivos dependem de sizing dentro dos limites aprovados. |
| F9-D8 | Cinco tentativas totais; só `RETRYABLE`; full jitter base 2 s e cap 60 s. | Mensagem/status externo nunca decide retry. |
| F9-D9 | Handler 120 s e deadline absoluto 300 s; retry não prolonga deadline. | Jobs produtivos longos exigem configuração registada e sizing. |
| F9-D10 | Retenção técnica local: completed 24 h; outbox/failed/cancelled 7 dias; dead-letter/inbox 30 dias. | Retenção jurídica/produtiva permanece gate. |
| F9-D11 | Envelope JSON canónico v1 até 32 KiB; registry pode impor teto menor. | Payload grande usa referência opaca futura. |
| F9-D12 | PII proibida por omissão; exceção exige schema, finalidade, minimização e retenção aprovados. | Integrações reais permanecem bloqueadas até classificação. |
| F9-D13 | Interface/classificação agora; encryption field-level apenas após keys/rotação aprovadas. | Encryption e keys reais são gate futuro. |
| F9-D14 | Concorrência local 8 global, 4/tipo, 2/organização; caps configuráveis 64/16/8. | Valores produtivos exigem benchmark/sizing. |
| F9-D15 | Deficit round-robin por organização e reserva operacional 2; ordenação apenas quando registada. | Prioridade não pode causar starvation cross-org. |
| F9-D16 | Replay nunca automático; F5/MFA/SoD quando aplicável; novo `executionId` e mesma idempotency key. | Replay não contorna inbox, suspensão ou offboarding. |
| F9-D17 | Cancelamento persistido, cooperativo e fenced; efeito incerto transita para reconciliação. | Não promete interromper efeito já iniciado. |
| F9-D18 | Envelope, job/handler e payload versionados; compatibilidade explícita N/N-1, sem upcast implícito. | Versão desconhecida é recusada/dead-lettered, nunca descartada. |
| F9-D19 | Suspensão/offboarding bloqueiam jobs funcionais; catálogo operacional separado apenas para drain/reconcile. | Retry reautoriza e nunca reativa acesso. |
| F9-D20 | Métricas por labels fechadas de baixa cardinalidade, sem IDs; thresholds produtivos são gate. | Organização/job/user/resource nunca são labels. |
| F9-D21 | PostgreSQL 17 descartável, migrations forward/rollback/drift, crash/multi-worker e vertical slice sintética. | Bases dev, F4.4 e integrações/jobs reais permanecem fora. |

## Gate de prontidão

Gate satisfeito pela aprovação conjunta de F9-D1–F9-D21 em 2026-10-08. A F9 está `Ready` para implementação local segundo o plano abaixo. Isto não declara trabalho iniciado nem autoriza migrations em bases persistentes, acesso a `c4g_central_dev`/`c4g_tenant_dev`, integrações reais, deploy ou rollout.

## Plano técnico ordenado

As etapas seguem a ordem de dependência indicada. Nomes novos são previstos e podem ser ajustados mecanicamente durante implementação sem alterar o contrato.

| Etapa | Componentes existentes afetados | Novos módulos, interfaces e migrations previstos | Critérios e testes focados | Riscos e invariantes |
| --- | --- | --- | --- | --- |
| 1. Contratos do envelope | Padrões de canonicalização em `backend/src/security/tenantRepositorySupport.js` e catálogos F4/F5 | `backend/src/async/envelope.js`, `jobRegistry.js`, `asyncErrors.js`; envelope v1, registry N/N-1, JSON canónico e limite 32 KiB | AC-06–08, 21; tabelas de forma, extras, prototypes, profundidade, oversize, PII/secrets e versões | Caller nunca fornece handler, policy, service actor ou infraestrutura; nenhuma permission produtiva. |
| 2. `QueuePort` | Padrões de ports em `backend/src/authorization/` e doubles dos testes | `backend/src/async/queuePort.js`, `backend/test/support/asyncQueueDouble.js`; operações publish/claim/heartbeat/complete/fail/cancel/deadLetter/redrive/snapshot | AC-03, 07, 11–17, 21; suite de contrato comum ao double e adapter | O domínio não vê tipos, estados, SQL, queue names ou objetos `pg-boss`. Depende da etapa 1. |
| 3. Adapter `pg-boss` | `backend/package.json`, lockfile, `pg` e padrões de configuração | dependência `pg-boss` 12.x fixada; `backend/src/async/adapters/pgBossQueueAdapter.js`, `pgBossVersionGuard.js` | AC-03, 11–17, 21; publish duplicado, digest conflict, claim, retry, heartbeat, shutdown e incompatibilidade | ESM/CommonJS é isolado no adapter; versão/schema inesperados falham readiness. Depende de 1–2 e etapa 5. |
| 4. Schema C4G `async_exec` | `centralMigrationManifest.js`, `tenantMigrationManifest.js`, runners/preflights e fingerprints | Central `004_f9_async_execution.{up,down}.sql`; tenant `001_f9_async_execution.{up,down}.sql`; manifest/fingerprint/checksum atualizados | AC-02, 04, 13–18; forward/rollback enquanto vazio, re-forward, ledger, drift, FKs/checks/uniques | Só PostgreSQL 17 descartável; runtime sem DDL; tenant migration é validada sinteticamente e aplicada a tenants reais apenas por F4.4. |
| 5. Gestão explícita `pgboss` | `runCentralMigrations.js`, manifest/preflight Central e readiness | artefactos SQL oficiais do schema 45 versionados/checksummed em diretório dedicado; manifest próprio; `createSchema:false`, `migrate:false` | AC-01, 03, 21, 23; schema ausente, drift, versão anterior/posterior e migration pendente bloqueiam startup | Nunca criar/migrar no startup; migration owner separado do role runtime. Depende da versão fixada da etapa 3. |
| 6. Outbox e relay | Transações/repositories F4.1 e `postgresTransaction.js` | `outboxRepository.js`, `outboxRelay.js`, `OutboxPort`; tabelas `async_exec.outbox` Central/tenant | AC-02–03, 10, 18; commit/rollback conjunto, claims concorrentes, publish/mark incertos e recovery | Outbox fica na base da origem; `SKIP LOCKED`, batch 10 e identidade/digest estáveis; sem transação distribuída. Depende de 1–5. |
| 7. Inbox e idempotência | Padrões transacionais e tenant lease executor | `inboxRepository.js`, `idempotentEffect.js`, `InboxPort`; unique key `(consumer, type, version, org, idempotency)` | AC-04–05, 10, 16, 18; redelivery, concorrência, crash antes/depois do commit e completed no-op | Inbox e efeito PostgreSQL na mesma transação; efeito externo futuro exige contrato próprio. Depende de 1, 4 e 6. |
| 8. Claims, leases, fencing e heartbeat | `tenantLeaseExecutor.js`, `tenantPoolManager.js`, scheduler/clock doubles | `executionLease.js`, `fenceRepository.js`, `heartbeatController.js`; fence monotónico em `async_exec` | AC-15–17; lease expirada, owner/fence antigo, heartbeat perdido e worker morto | DB UTC autoritativo; 30/10/5 s; retry count da biblioteca não é o único fence. Depende de 2–5. |
| 9. Worker separado | `server.js`, `productionComposition.js`, `app.js` | `backend/src/worker.js`, `workerComposition.js`, `workerLifecycle.js`; script `worker` no package | AC-01, 16–17, 23; scan/import graph prova API sem handlers; subprocessos provam start/stop/crash | API deixa de ser host F9; timers Legacy não são migrados nesta feature. Depende de 1–8. |
| 10. Resultados fechados | Erros confiáveis de `tenantRuntimeErrors.js` e reason codes F5 | `jobResult.js`, `failureClassifier.js` com nove classes aprovadas | AC-11, 13–14, 20–22; matriz exaustiva e rejeição de mensagem/status externo como policy | Só códigos internos podem ser `RETRYABLE`; cleanup incerto não repete efeito. Depende de 1. |
| 11. Retry/backoff/jitter | Backoff/scheduler injetável F4.2 | `retryPolicy.js`; clock/RNG injetados; base 2 s, cap 60 s, cinco attempts | AC-11–12, 16, 22; sequências determinísticas, caps, deadline e zero timer residual | Retry nunca amplia deadline; apenas `RETRYABLE`. Depende de 10. |
| 12. Concorrência e fairness | Limites/reserva F4.2 e métricas F5 | `fairScheduler.js`, `concurrencyPolicy.js`; deficit round-robin 8/4/2 com reserva 2 e caps 64/16/8 | AC-10, 19, 22; noisy org, starvation, capacidade ociosa, reserva e múltiplos workers | Rate limit não substitui concurrency; IDs podem ser chaves internas, nunca labels. Depende de 1–3. |
| 13. Cancelamento, deadlines e shutdown | Node scheduler, tenant deadlines e `server.js` lifecycle | `cancellationService.js`, `deadlinePolicy.js`; AbortSignal e estado/fence persistidos | AC-12, 15–17, 22; 120/300/30 s, skew 2 s, cancel antes/durante/depois e shutdown forçado | Cancelamento é cooperativo; efeito iniciado pode exigir reconciliação; sem sucesso falso. Depende de 8–12. |
| 14. Dead-letter e replay | Audit/support policies F5 e QueuePort | `deadLetterService.js`, `replayService.js`, `ReplayAuthorizationPort`; retenções 7/30 dias | AC-13–14, 18, 20, 22; permanent/poison/expired, replay autorizado/recusado e completed no-op | Replay nunca automático; novo executionId, mesma idempotency key, F5/MFA/SoD conforme ação. Depende de 7, 10–13, 16–17. |
| 15. Reconciliação | Padrões F2 logout, F4 repository/runtime/migration reconciliation | `reconciliationScanner.js`, `reconciliationService.js`, `ReconciliationPort` | AC-03–05, 16–18, 22; outbox presa, publicação/conclusão incerta, inbox órfã, lease e queue divergentes | Só reparações allowlisted/idempotentes são automáticas; payload/actor/tenant e ações destrutivas exigem humano. Depende de 4–14. |
| 16. F5 e service actors | `channelAdapters.js`, `authorizationService.js`, membership/contexto F3 | `asyncAuthorizationAdapter.js`, `serviceActorRegistry.js`; fixtures `synthetic_resource.*` apenas em testes | AC-07, 09–10, 20, 23; actor falsificado, membership revogada, suspensão/offboarding e operation mismatch | Reautorizar em cada attempt e antes de novo efeito sensível; não criar permissions/grants produtivos. Depende de 1 e F3/F5. |
| 17. Auditoria | `authorization/audit.js` e taxonomia F5 | `asyncAuditEvents.js`, adapter do `AuditPort`; schemas allowlisted para dispatch/deny/completion/replay/reconcile | AC-14, 19–20; crítico não aceite, deny com audit failure e observacional reconciliável | Queue não é ledger; quatro classes F5 preservadas e payload integral proibido. Depende de 10, 14–16. |
| 18. Métricas sanitizadas | `authorization/metrics.js` e snapshots F4.2 | `asyncMetrics.js`; labels por jobType/result/errorClass/queueClass/workerRole | AC-19, 22; scan de labels e canários sensíveis/high-cardinality | Sem organization/user/resource/job/execution IDs, payload ou idempotency key em labels. Depende de 10–15. |
| 19. Composição sem jobs reais | `productionComposition.js`, `server.js`, `package.json` | startup worker valida catálogos/schemas mas registry produtivo de handlers permanece vazio; composição sintética injetável nos testes | AC-01, 07, 09, 21, 23; startup vazio válido, synthetic rejeitado em produção e API parity | Não ligar Resend, R2, imports, connectors, reporting, exports ou timers Legacy. Depende de 1–18. |
| 20. Fixtures/vertical slice sintética | Doubles F1/F5 e `backend/test/support/` | `f9AsyncFixtures.js`, handlers `synthetic_resource.read/update`, duas organizações/actors/recursos | AC-04–10, 20–23; matriz positiva/negativa A/B e service/human actor | Fixtures não entram em composição produtiva nem em catálogos F5 produtivos. Depende de 1–19. |
| 21. Gate PostgreSQL 17 descartável | Gates PowerShell/Node F2–F4.3 e Docker local | `test/integration/f9/` com up/gate/down/purge, processos worker e PostgreSQL 17 efémero | AC-02–05, 10, 13–18, 21–23; concorrência, crash, restart DB, multi-worker, migrations/drift e cleanup | Nunca usar portas/bases dev; cleanup fail-closed e zero containers/volumes temporários no fim. Depende de todas as etapas anteriores. |
| 22. Benchmark e gates finais | `benchmarkF5Authorization.js` como padrão de relatório | `backend/scripts/benchmarkF9Async.js`; workload sintético, backlog/fairness/latência/conexões/recovery | AC-03, 12, 16, 19, 22–23; baseline local e limites/caps | Resultado não altera silenciosamente defaults/caps. Sizing, thresholds, backup/restore e operação real continuam gates futuros. Depende de 21. |

## Fronteira de migrations

- Criar no repositório migrations versionadas C4G para `async_exec`: próxima migration Central depois de `003_f4_tenant_directory` e próxima migration tenant depois de `000_tenant_control_baseline`, com up/down seguro apenas enquanto vazias, checksums, fingerprints, ledger e preflight.
- Versionar separadamente os planos SQL oficiais do schema `pgboss` compatíveis com a versão 12.x/schema 45 escolhida, com checksum e version guard. A aplicação arranca com `createSchema:false` e `migrate:false`.
- Executar migrations e testes de drift exclusivamente em PostgreSQL 17 descartável criado pelo gate F9.
- É proibido aplicar ou ensaiar migrations em `localhost:5433/c4g_central_dev`, `localhost:5433/c4g_tenant_dev` ou qualquer base persistente, staging ou produção.
- F9 prova manifests, runners, rollback vazio, re-forward e compatibilidade em bases sintéticas. F4.4/Operação será responsável pela aplicação futura a tenants reais, backups, restore, sequenciamento e rollout.
- Nenhum binding Central→tenant, tenant real, secret ou DSN entra nas migrations ou fixtures F9.

## Estratégia de validação dos 23 critérios

| Critério | Evidência prevista |
| --- | --- |
| F9-AC-01 | Teste de import/composição e subprocessos API/worker; scan de handlers/timers na API. |
| F9-AC-02 | Gate PostgreSQL 17 com mutação+outbox, commit/rollback e fault injection. |
| F9-AC-03 | Dois relays/múltiplos workers, publish duplicado, crash em ambos os lados do publish e digest estável. |
| F9-AC-04 | Inbox unique/transacional sob redelivery sequencial e concorrente. |
| F9-AC-05 | Handler sintético repetido, concorrente e pós-crash com contador de efeito único. |
| F9-AC-06 | Unitários de envelope v1, canonical JSON, versões, campos obrigatórios/extras e imutabilidade. |
| F9-AC-07 | Probes de actor/handler/policy/tenant/queue/DSN/SQL falsificados com zero efeito. |
| F9-AC-08 | Unitários/scan de 32 KiB, profundidade, tipos, secrets, tokens, PII, documento e payload bruto. |
| F9-AC-09 | Contratos F5 para actor humano/service, membership revogada e operação/version mismatch. |
| F9-AC-10 | Matriz A/B PostgreSQL com IDs coincidentes, relay/inbox/replay cross-org e zero acesso B. |
| F9-AC-11 | Tabela unitária das nove classes; mensagens externas nunca produzem retry. |
| F9-AC-12 | Clock/RNG controlados para cinco attempts, full jitter, cap 60 s e deadline 300 s. |
| F9-AC-13 | Permanent/poison/retries/deadline para uma única dead-letter sem bloquear outro job. |
| F9-AC-14 | Schema/scan da evidência DLQ com canários de stack, DSN, payload e secret. |
| F9-AC-15 | Workers concorrentes com lease expirada e fence antigo impedidos antes de efeito/completion. |
| F9-AC-16 | Kill de subprocesso, heartbeat perdido, redelivery e restart PostgreSQL em fases controladas. |
| F9-AC-17 | SIGTERM/shutdown simulado: stop claims, AbortSignal, grace 30 s e estado recuperável. |
| F9-AC-18 | Scanner sobre outbox/inbox/job/lease órfãos e publicação/conclusão incertas; reparações allowlisted. |
| F9-AC-19 | Unitários/scan de logs, audit e métricas; rejeição de labels com IDs/cardinalidade livre. |
| F9-AC-20 | Doubles das quatro classes F5: crítico aborta, deny preserva, observacional reconcilia, ledger fora. |
| F9-AC-21 | Matriz N/N-1, versões desconhecidas, schema drift e ausência de upcast implícito. |
| F9-AC-22 | Suite adversarial agregada: redelivery, concorrência, crash, timeout, poison, replay, cancel e shutdown. |
| F9-AC-23 | Gate offline com PostgreSQL 17 descartável, dados sintéticos e spies que recusam bases dev/serviços externos. |

## Gates finais separados

1. **Implementação local:** 23/23 critérios, node checks, testes unitários/contrato, gate PostgreSQL 17 descartável, crash/restart, multi-worker, benchmark, scans e cleanup completo.
2. **Revisão formal:** segurança, arquitetura, concorrência/transações, migrations/drift, F5/auditoria, rastreabilidade 23/23 e ausência de integrações/permissions/jobs produtivos.
3. **Integração futura:** sizing/thresholds, retenção jurídica, encryption/keys, backups/restore, F4.4, cada consumer real, staging, produção e rollout. Estes gates não reabrem o contrato local sem nova evidência/decisão formal.

## Referências

- `AGENTS.md`
- `context/project-overview.md`
- `context/architecture.md`
- `context/coding-standards.md`
- `context/features/security-privacy-and-audit-foundation.md`
- `context/decisions/future-data-model.md`
- `context/decisions/multi-tenant-identity-and-data.md`
- `context/decisions/tenant-directory-and-lifecycle.md`
- `context/history/f2-identidade-e-sessao-segura.md`
- `context/history/f3-membership-session-context.md`
- `context/history/f4-tenant-contract-lifecycle.md`
- `context/history/f4-tenant-central-directory.md`
- `context/history/f4-tenant-runtime-access.md`
- `context/history/f43-tenant-schema-compatibility.md`
- `context/history/f5-functional-authorization.md`
- `context/research/f5-authorization-policy-decisions.md`
- `context/references/logical-data-dictionary.md`
- `backend/test/security/secCoverageMatrix.js`
- `backend/src/server.js`
- `backend/src/productionComposition.js`
- `backend/src/services/emailService.js`
- `backend/src/authorization/channelAdapters.js`
- `backend/src/authorization/audit.js`
- `backend/package.json`

## Resultado de implementação e fecho

- Fecho: 2026-10-08; veredicto formal `ready to close`, sem findings acionáveis após a segunda revisão.
- Implementados envelope JSON canónico v1, registry N/N-1, `QueuePort`, adapter substituível `pg-boss`, worker separado com registry produtivo vazio, outbox/inbox, fencing, heartbeat, cancelamento, retry, fairness/reserva, dead-letter/replay, retenção, reconciliação, F5 actors/auditoria e métricas sanitizadas.
- `pg-boss` ficou fixado em `12.37.0` (MIT), schema 45, plano oficial versionado com SHA-256 `e0cc78ee2a2fed4b42d479a9ae2af65e2ca5b21f980afa41fb880e2eb6ffebbb`, `createSchema:false` e `migrate:false` no runtime.
- Migrations F9: Central `004_f9_async_execution` e tenant sintético `001_f9_async_execution`, mais plano explícito `pgboss` 45. Foram executadas apenas num PostgreSQL 17.11 descartável em loopback/porta 5549, com forward, rollback vazio, re-forward e restart.
- Gate final: 19/19 testes F9 e PostgreSQL, 387/387 suite backend, `node --check`, `git diff --check` e scans obrigatórios aprovados; zero testes ignorados.
- Benchmark sintético: 20 000 envelopes em 194,55 ms e 20 000 claims de fairness em 9,37 ms no ambiente local; é baseline, não sizing/SLO produtivo.
- Findings corrigidos: timer residual no shutdown, validação fechada de service actors, enforcement de concorrência/reserva operacional e controlo transacional da migration Central pelo runner.
- Vulnerabilidades reportadas por `npm audit` permanecem em dependências preexistentes fora da árvore de `pg-boss`; não foram atualizadas para respeitar o limite de dependências da F9.
- Limites preservados: nenhum job/integrador produtivo, F4.4/F4.5, bases persistentes, deploy, rollout, retenção jurídica, encryption/keys, backup/restore ou auditoria append-only.
