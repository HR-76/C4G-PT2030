# F7 — Contrato consolidado de auditoria append-only

- Estado da pesquisa: recomendação para aprovação humana; não constitui decisão aprovada nem autorização de implementação.
- Data: 2026-10-08.
- Decisões cobertas: F7-D1–F7-D27 (27/27).
- Feature: `F7 — Auditoria append-only e trilho de segurança`.

## 1. Decisão

Adotar uma topologia **source-local authoritative ledger**: eventos globais, de identidade, membership, diretório, administração C4G e concessão de suporte residem na Central; eventos sobre recursos operacionais residem no tenant que é fonte de verdade. Não existe réplica integral Central. O ledger local é append-only para roles de runtime, idempotente e tamper-evident por cadeia SHA-256 sobre JSON JCS; não é WORM, tamper-proof nem prova jurídica contra owner, superuser ou administrador capaz de reescrever dados e recalcular a cadeia.

Eventos críticos são aceites antes do efeito pela mesma transação quando efeito e ledger partilham a base, ou por uma intenção de auditoria/outbox durável na transação da origem antes de atravessar a fronteira. F9 entrega pelo menos uma vez e o ledger deduplica; não existe transação distribuída nem promessa exactly-once. Consulta usa um port fechado, F5, scope organizacional, paginação keyset e limites fixos. Não há eliminação automática até existir política jurídica aprovada.

## 2. Base factual do repositório

Convenção epistemológica: as secções 2.1–2.4 registam **factos** observados em contratos e código; consequências introduzidas como tal são **inferências**; todas as escolhas nas secções 3–9 são **recomendações ainda não aprovadas**.

### 2.1 Decisões já vinculativas

- A arquitetura aprovada separa a Central C4G das bases por organização; dados operacionais e auditoria local pertencem ao tenant, enquanto identidade, memberships, diretório e eventos centrais pertencem à Central.
- Membership F3 ativa e contexto organizacional validado são a fonte de acesso; o caller não fornece tenant, actor, policy, infraestrutura ou autoridade.
- F5 impõe deny-by-default, enforcement no servidor, quatro classes de auditoria, suporte nominativo e temporário, e payload allowlisted.
- F9 fornece outbox na transação da origem, inbox/idempotência, entrega pelo menos uma vez, redelivery, fencing, dead-letter e reconciliação; não fornece exactly-once nem ledger de auditoria.
- Auditoria é append-only; correções são novos eventos relacionados. Escrita crítica ocorre na mesma transação ou por outbox durável e a falha impede a ação sensível.
- Isolamento entre organizações abrange persistência, jobs, consulta, reporting e exports. Suspensão/offboarding bloqueiam novo acesso, mas não apagam histórico.
- Retenção é versionada e subordinada a legal hold; sem política aprovada o sistema não elimina automaticamente.
- Métricas não usam organização, utilizador, recurso, evento ou correlation ID como labels.

### 2.2 Eventos e ports já definidos

O catálogo F5 implementado contém: `AUTHORIZATION_ALLOWED`, `AUTHORIZATION_DENIED`, `AUTHORIZATION_POLICY_INVALID`, `AUTHORIZATION_MFA_REQUIRED`, `AUTHORIZATION_VERSION_ADVANCED`, `GRANT_CHANGED`, `PROFILE_CHANGED`, `SOD_CHANGED`, `SENSITIVE_ACTION_ALLOWED`, `SUPPORT_GRANTED`, `SUPPORT_STARTED`, `SUPPORT_USED`, `SUPPORT_REVOKED`, `SUPPORT_EXPIRED`, `SERVICE_JOB_DISPATCHED`, `SERVICE_JOB_COMPLETED`, `EXPORT_ALLOWED`, `EXPORT_COMPLETED`, `DOCUMENT_ALLOWED` e `DOCUMENT_COMPLETED`. F9 acrescenta `ASYNC_EFFECT_AUTHORIZED`, `ASYNC_REPLAY_AUTHORIZED`, `ASYNC_AUTHORIZATION_DENIED`, `ASYNC_JOB_OBSERVED` e `ASYNC_RECONCILIATION_REQUIRED`.

`backend/src/authorization/audit.js` valida campos escalares allowlisted e implementa timeout/fail-closed para a classe crítica. `backend/src/async/audit.js` preserva as classes no worker. Estes são ports/doubles; não persistem um ledger. O modelo lógico `tenant_audit_event` e os eventos centrais são desenho futuro, não garantia implementada.

### 2.3 Garantias realmente implementadas

- Contexto F3, policy engine F5, actors humanos/service/support e autorização sintética estão implementados e testados localmente.
- Envelope, outbox/inbox, worker separado, idempotência, fencing, retry, dead-letter e reconciliação F9 estão implementados com dados sintéticos.
- Manifests/migrations Central e tenant são versionados; runtime não deve executar DDL.
- Não existem ledger Central/tenant F7, adapter persistente, hash chain, roles F7, query port, permissions produtivas de consulta/export, retenção jurídica ou verificação pós-restore.

### 2.4 Lacunas e conflito documental

- A matriz transversal `SEC-AC-*` foi reconciliada antes de F9 e não reflete toda a fundação assíncrona já concluída. Esta pesquisa não a altera.
- O modelo lógico usa nomes e eventos mais amplos que os catálogos implementados; eles são requisitos futuros, não entram automaticamente no catálogo F7 v1.
- F5 usa `occurredAt` e `schemaVersion`; F7 normaliza estes conceitos para `observedAt`, `eventVersion` e `acceptedAt`, mantendo adapter explícito e sem reinterpretar eventos silenciosamente.

## 3. Contrato recomendado

### 3.1 Topologia e residência

O catálogo associa estaticamente cada par `(eventCode, eventVersion)` a uma regra de residência fechada. `CENTRAL_AUTHORITY` significa Central; `TENANT_AUTHORITY` significa o tenant fonte do recurso; `OPERATION_AUTHORITY` resolve uma destas duas opções pelo binding imutável do `operationCode` no registry interno. A residência nunca é input do caller.

| Família de evento | Ledger autoritativo | Escritor | Leitor | Indisponibilidade e projeção |
| --- | --- | --- | --- | --- |
| autenticação, sessão, utilizador, membership, organização, diretório, concessão/revogação de suporte e administração C4G | Central | API/worker Central pelo `AuditAppendPort` | query service Central autorizado | classe 1 aborta; classes 2/3 seguem a semântica abaixo; sem cópia tenant |
| uso de suporte sobre recurso tenant, autorização e ações sobre recurso tenant, documento, export/report tenant, efeito/job tenant | tenant fonte de verdade | API/worker através de lease tenant validada | query service tenant autorizado | intenção fica na outbox da origem; Central recebe apenas receipt/checkpoint técnico mínimo, sem payload |
| job puramente Central e reconciliação Central | Central | worker/service actor interno | query service Central | F9 redelivery/inbox |
| evento transversal com efeitos em duas bases | um evento de intenção/resultados em cada fonte, ligados por correlation/causation | cada componente na sua transação local | por ledger | saga e reconciliação; nunca uma linha “global” que finja atomicidade |

O catálogo inicial F7 v1 é exatamente a união dos 25 códigos F5/F9 acima. A residência segue a regra fixa do código; quando a regra é `OPERATION_AUTHORITY`, a autoridade é a declarada pelo binding imutável da operação (`CENTRAL` ou `TENANT`) no registry interno, nunca pelo payload. Códigos futuros exigem nova versão do catálogo e schema; eventos do contrato geral ainda sem produtor aprovado permanecem fora de F7 v1.

| Regra de residência v1 | Event codes exatos |
| --- | --- |
| `CENTRAL_AUTHORITY` | `AUTHORIZATION_VERSION_ADVANCED`, `GRANT_CHANGED`, `PROFILE_CHANGED`, `SOD_CHANGED`, `SUPPORT_GRANTED`, `SUPPORT_STARTED`, `SUPPORT_REVOKED`, `SUPPORT_EXPIRED` |
| `TENANT_AUTHORITY` | `SUPPORT_USED`, `DOCUMENT_ALLOWED`, `DOCUMENT_COMPLETED`, `EXPORT_ALLOWED`, `EXPORT_COMPLETED` |
| `OPERATION_AUTHORITY` | `AUTHORIZATION_ALLOWED`, `AUTHORIZATION_DENIED`, `AUTHORIZATION_POLICY_INVALID`, `AUTHORIZATION_MFA_REQUIRED`, `SENSITIVE_ACTION_ALLOWED`, `SERVICE_JOB_DISPATCHED`, `SERVICE_JOB_COMPLETED`, `ASYNC_EFFECT_AUTHORIZED`, `ASYNC_REPLAY_AUTHORIZED`, `ASYNC_AUTHORIZATION_DENIED`, `ASYNC_JOB_OBSERVED`, `ASYNC_RECONCILIATION_REQUIRED` |

Para `OPERATION_AUTHORITY`, cada operation code produtivo declara exatamente uma autoridade no catálogo da release; ausência, duplicação ou mismatch bloqueia o startup. Um evento de operação Central vai à Central e um evento de operação tenant vai exclusivamente ao tenant resolvido. O adapter não pode substituir a autoridade declarada.

### 3.2 Quatro classes F5 e atomicidade

| Classe | “Aceite” e escrita | Falha/timeout | F9 e reconciliação |
| --- | --- | --- | --- |
| 1 — `CRITICAL_PRE_EFFECT` | `ACCEPTED` significa commit confirmado do evento no ledger na mesma transação do efeito, ou commit confirmado de `audit_intent`/outbox na transação da origem antes de qualquer efeito noutra fronteira. Um receipt em memória, log ou publish sem commit não serve. | aborta antes do efeito. Para efeito externo futuro: intent primeiro, efeito depois, outcome posterior; resultado incerto é reconciliado. | relay pelo menos uma vez; idempotency/digest no ledger; atraso não permite novo efeito sem reautorização |
| 2 — `DENY_PRESERVING` | decisão deny é final antes da tentativa de append; tenta append síncrono limitado ou outbox durável disponível | falha nunca converte deny em allow; sem efeito; incrementa métrica fechada e cria item reconciliável apenas se existir caminho durável seguro | retry limitado; ausência de evidência fica como incidente observável, sem fabricar evento |
| 3 — `OBSERVATIONAL_RECONCILABLE` | commit da outbox source-local é aceitação de entrega; ledger final pode ser assíncrono | não reverte efeito já válido; após 300 s sem append confirmado passa a `RECONCILIATION_REQUIRED`/dead-letter observável | polling F9, inbox, redelivery e digest; convergência idempotente |
| 4 — `OUTSIDE_F5` | F7 recusa o código no port | nenhuma falsa aceitação ou fallback | WORM, SIEM, assinatura legal e integrações não implementadas ficam fora |

### 3.3 Evento fechado v1

O evento é um plain object imutável, sem propriedades adicionais, prototypes customizados, accessors, funções ou valores não JSON. Limite: payload canónico máximo 8 KiB e evento canónico completo máximo 16 KiB.

| Campo | Regra e origem confiável |
| --- | --- |
| `eventId` | UUIDv7 RFC 9562 gerado internamente; único globalmente, mas não usado como prova de ordem |
| `eventVersion`, `catalogVersion` | valores allowlisted pelo catálogo carregado atomicamente no startup |
| `eventCode`, `auditClass`, `ledgerLocation` | registry interno; nunca caller |
| `organizationId` | contexto F3/F5/F9; obrigatório salvo eventos realmente platform-wide catalogados |
| `tenantId` | binding F4 interno; obrigatório em ledger tenant, ausente em evento puramente Central |
| `actorType` | `HUMAN`, `SERVICE` ou `SUPPORT`; contexto normalizado |
| `actorId` | ID opaco interno; obrigatório; não é email/nome |
| `membershipId`, `serviceActorCode`, `supportGrantId` | exatamente o discriminador aplicável; os restantes ausentes |
| `subjectType`, `subjectId`, `resourceType`, `resourceId` | códigos e IDs opacos allowlisted; opcionais apenas quando o schema do evento o permite |
| `operationCode`, `decision`, `outcome`, `reasonCode`, `channel`, `source` | enums fechados derivados do adapter/policy |
| `observedAt` | instante UTC da origem confiável, validado; não ordena o ledger |
| `acceptedAt` | `transaction_timestamp()` da transação PostgreSQL de append |
| `streamType`, `streamId`, `sequence` | atribuídos pelo ledger; sequência monotónica por stream |
| `correlationId`, `causationId`, `correctionOfEventId` | IDs internos; causation/correction opcionais conforme schema |
| `idempotencyKey` | chave opaca estável derivada internamente do produtor, organização, código/versão e efeito lógico |
| `payload` | objeto fechado específico do event code; apenas dados classificados e necessários |
| `canonicalizationVersion`, `hashAlgorithm`, `previousHash`, `eventHash` | atribuídos/verificados pelo ledger; `JCS-1`, `SHA-256`, 32 bytes |

São proibidos: password, secret, credential, token, cookie, assertion OIDC, DSN/connection string, host/porta, SQL, stack, mensagem externa arbitrária, email, nome, documento, payload funcional integral, texto livre e PII não aprovada. Strings ficam em UTF-8 e são validadas como NFC antes de JCS; JCS não normaliza Unicode. Números de payload são proibidos salvo inteiros seguros explicitamente declarados; decimais, valores monetários, inteiros longos e timestamps são strings canónicas. Hashing de PII não a torna anónima.

Versão desconhecida, campo adicional, valor fora da enumeração, tamanho/profundidade excedidos ou payload incompatível são recusados antes de outbox/ledger. Compatibilidade é explícita N/N-1 por schema; não há upcast implícito.

### 3.4 Identidade, ordem e tempo

- UUIDv7 segue [RFC 9562](https://www.rfc-editor.org/rfc/rfc9562.html) e é validado por vetores; colisão falha fechado. A aplicação não infere ordem causal do UUID.
- Stream: `(ledgerLocation, organizationId ou PLATFORM, streamType)`. `streamType` é fechado (`SECURITY`, `ACCESS`, `SUPPORT`, `ASYNC`, `DATA`, `OPERATIONS`). Não há cadeia por partição.
- Uma row `chain_head` por stream é bloqueada e avançada na mesma transação do append. Rollback não consome sequência; concorrência serializa apenas o stream. Gaps, duplicados e regressão são inválidos.
- Não existe ordem total entre organizações, streams ou bases. `sequence` ordena só dentro do stream; `acceptedAt` desempata consultas, não causalidade.
- `acceptedAt = transaction_timestamp()` fornece um instante consistente à transação, conforme a [semântica temporal do PostgreSQL 17](https://www.postgresql.org/docs/17/functions-datetime.html). `observedAt` pode ser anterior; skew local permitido é ±2 s para produtores síncronos e até ao deadline F9 (300 s) para entrega assíncrona. Fora disso o evento continua preservável como atrasado, com `reasonCode`, mas nunca é retroinserido na sequência.
- Restore/replay mantém event ID, sequência, hashes e timestamps; replay funcional cria um novo evento causal, nunca reinventa o original.

### 3.5 Integridade e significado de tamper-evident

Canonicalização: [RFC 8785/JCS](https://www.rfc-editor.org/rfc/rfc8785.html) sobre o documento imutável completo sem `eventHash`, depois de validação fechada. JCS depende do modelo numérico I-JSON/IEEE-754, ordena propriedades deterministicamente e preserva Unicode sem normalização; por isso F7 limita números e valida NFC antes da canonicalização. Material:

`UTF8("C4G-AUDIT-EVENT\u0000JCS-1\u0000SHA-256\u0000") || JCS(eventWithoutEventHash)`

O documento inclui todos os campos persistidos, inclusive `previousHash`, `acceptedAt`, sequência e payload. `eventHash = SHA-256(material)`, algoritmo definido pelo [NIST FIPS 180-4](https://csrc.nist.gov/pubs/fips/180-4/upd1/final). O primeiro evento usa 32 bytes zero em `previousHash`. A cadeia é por stream e atravessa partições. Checkpoint a cada 10 000 eventos e no sealing mensal guarda stream, intervalo, first/last sequence e last hash. Para ledger tenant, um receipt de checkpoint mínimo pode ser projetado na Central por F9; não contém payload nem substitui o ledger local.

O verifier recalcula do genesis/checkpoint confiável, valida sequência, previous hash, hash, catálogo/canonicalização e identifica a primeira divergência. Gap, reorder, delete, update, substituição e digest mismatch invalidam o segmento. Checkpoint sem âncora externa continua regravável pelo mesmo atacante privilegiado.

Garantia exata: o desenho deteta corrupção acidental, alterações pelo runtime e alterações ordinárias que não consigam reescrever toda a cadeia e todos os checkpoints. Um owner/superuser/administrador com acesso suficiente pode desativar triggers, alterar linhas e recalcular cadeia/checkpoints. HMAC, assinatura, WORM e âncora externa são ports futuros e não são alegados pela F7.

### 3.6 PostgreSQL append-only em profundidade

- Schema dedicado `audit`; `PUBLIC` sem privilégios e default privileges revogados.
- Roles sem login: `c4g_audit_owner`, `c4g_audit_writer`, `c4g_audit_reader`, `c4g_audit_verifier`; role de migration/login operacional separada pode `SET ROLE c4g_audit_owner` apenas no runner aprovado.
- Owner possui objetos mas não é credencial runtime. Writer recebe apenas `EXECUTE` na função estreita `audit.append_event_v1`; não recebe `INSERT`, `SELECT`, `UPDATE`, `DELETE`, `TRUNCATE`, sequence ou DDL diretamente.
- A função `SECURITY DEFINER` usa owner controlado, `search_path` fixo a `pg_catalog, audit`, argumentos tipados, nenhuma SQL dinâmica e revoga `EXECUTE` de `PUBLIC`. Valida catálogo, contexto materializado, idempotência, digest, head e partição dentro da transação.
- Reader usa query functions/views read-only com scope obrigatório; verifier tem `SELECT` apenas sobre colunas necessárias. RLS com `FORCE ROW LEVEL SECURITY` é defesa adicional, não única autorização; a [documentação PostgreSQL 17](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) explicita que superusers e roles `BYPASSRLS` contornam políticas e que owners normalmente também as contornam.
- Triggers `BEFORE UPDATE OR DELETE` e statement trigger `BEFORE TRUNCATE` abortam nas tabelas/partições; PostgreSQL 17 suporta triggers de `TRUNCATE` ao nível de statement ([`CREATE TRIGGER`](https://www.postgresql.org/docs/17/sql-createtrigger.html)). Attach/detach/drop, criação de partições, disable trigger e alteração de head só pertencem ao migrator/owner e são preflighted.
- Runtime nunca cria partições, executa DDL ou migra automaticamente. Preflight verifica owner, grants, default privileges, RLS, triggers, funções, checksums e schema fingerprint.
- Estas barreiras não protegem contra superuser e não impedem owner de se conceder privilégios; segregação operacional e âncora externa futura são necessárias para uma garantia mais forte.

### 3.7 Payload, PII e catálogo

Cada versão de event code declara residência, classe F5, actor types, campos opcionais, payload schema, classificação e retenção aplicável. O catálogo inicial reutiliza somente os 25 códigos já implementados; não cria eventos de produto por inferência. `reasonCode` é enum fechado. Payload livre é sempre proibido.

Redaction acontece antes do digest/outbox; dados removidos nunca entram no evento. IDs opacos continuam dados pessoais/pseudónimos quando ligáveis e são protegidos como tal. Exceção com PII exige, em nova versão de catálogo, finalidade, base/classificação, campos exatos, query permission e política de retenção aprovadas. Isto concretiza minimização e proteção contra injection/exposição do [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html) e os controlos V16 do [OWASP ASVS 5.0](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.json).

### 3.8 Consulta e autorização

`AuditQueryPort` expõe apenas `listEvents`, `getEvent`, `verifyStream` e `requestExport`; recebe subject/actor e scope normalizados, nunca SQL, database, tenant, partition ou policy. O adapter seleciona Central/tenant pelo registry interno.

Permissions propostas para aprovação em F7, sem grants/perfis automáticos: `audit_event.read`, `audit_event.verify` e `audit_event.export`; a operação transversal C4G é `audit_event.read_cross_organization`, separada, sensível, com MFA recente, SoD e suporte explícito quando incide sobre cliente. Scope admitido: `ORGANIZATION`; `RESOURCE` apenas estreita uma consulta já autorizada e nunca amplia acesso. Se o catálogo F5 produtivo continuar vazio, todas as consultas são negadas.

Defaults locais: página 50, máximo 100; janela máxima 31 dias; timeout 5 s; resposta máxima 1 MiB. Cursor versionado contém organização, `(acceptedAt,eventId)` e digest dos filtros; é input não confiável, validado contra o contexto e não uma autorização. Ordenação fixa `acceptedAt DESC, eventId DESC`. Filtros: período, event code, actor type, outcome, resource type e correlation ID exato; nenhum texto livre.

Export é assíncrono via F9, reautoriza na execução, máximo 100 000 linhas ou 100 MiB (o primeiro limite atingido), sem R2/export jurídico nesta feature. Acesso e export geram eventos críticos antes da leitura material/export; paginação subsequente revalida F5. F7 v1 não faz fan-out cross-tenant: consulta Central vê apenas eventos Central/checkpoints; leitura tenant exige um tenant resolvido. Consulta transversal real depende de F4.4 e operação futura.

### 3.9 Retenção, partições e restore

- Tabela de eventos particionada mensalmente por `acceptedAt`; identidade/idempotência global e `chain_head` ficam em tabelas não particionadas para garantir unicidade entre partições. Toda chave/índice de consulta inclui organização.
- Migrations criam partição corrente, próxima e `DEFAULT`. Evento atrasado é particionado por `acceptedAt`, não `observedAt`. Job operacional futuro cria/seala partições; runtime normal não o faz.
- Índices mínimos: `(organization_id, accepted_at DESC, event_id DESC)`, `(organization_id, event_code, accepted_at DESC, event_id DESC)` e correlation exata. Benchmark decide ajustes, não o contrato.
- Nenhuma partição é descartada, detached ou arquivada automaticamente. A partição `DEFAULT` é alerta/reconciliação e só é drenada por migration/job autorizado e idempotente.
- `RetentionEvaluationPort`, `LegalHoldPort` e `ArchivePort` podem calcular/representar bloqueios, mas F7 não executa eliminação, anonimização ou arquivo. Offboarding/suspensão conservam o ledger.
- Teste local usa dump/restore sintético em PostgreSQL 17 descartável e verifica manifest, roles, row counts, heads, checkpoints e cadeia completa. Tecnologia produtiva, RPO/RTO, backups, keys, legal hold operacional e cadeia de custódia são gates futuros.

### 3.10 Idempotência, F9 e reconciliação

Unique lógico: `(producerCode, organizationId/PLATFORM, eventCode, eventVersion, idempotencyKey)`. O digest de entrada é SHA-256/JCS do evento pré-append sem campos atribuídos pelo ledger. Mesmo unique+digest retorna o receipt persistido; mesmo unique com digest diferente falha fechado e cria incidente de reconciliação sem novo evento conflitante.

Crash antes do commit não aceita; crash depois do commit e antes do ack é resolvido por retry idempotente. Redelivery F9 usa inbox; o ledger continua a última barreira. Poison/incompatible vai para dead-letter sanitizada. Reparação automática pode apenas redeliver outbox, repetir append idempotente, recomputar verificação e reemitir receipt; nunca muda/apaga evento, escolhe actor/org, ignora mismatch ou recalcula cadeia como “reparação”. Casos ambíguos exigem autoridade humana futura.

### 3.11 Observabilidade

Métricas allowlisted: `audit_append_total`, `audit_append_duration_seconds`, `audit_rejection_total`, `audit_duplicate_total`, `audit_digest_mismatch_total`, `audit_chain_verification_total`, `audit_delivery_lag_seconds`, `audit_reconciliation_total`, `audit_partition_failure_total`, `audit_query_total`, `audit_query_duration_seconds`, `audit_timeout_total`. Labels fechadas: `ledger_location`, `audit_class`, `result`, `reason_bucket`, `source`, `operation`; nunca organização, actor, event/resource/correlation/idempotency ID ou payload. Alertas e thresholds de produção são gates operacionais; health não concede acesso nem declara integridade sem verificação.

## 4. Matriz F7-D1–F7-D27

Abreviações: `I` = evidência interna; `P` = fonte primária externa.

| ID e pergunta normativa | Opções viáveis | Recomendação e evidência | Impacto, risco e dependências | Redação normativa proposta |
| --- | --- | --- | --- | --- |
| F7-D1 — Onde reside a auditoria? | Central; tenant; híbrida; source-local | Source-local: Central para domínio Central, tenant para domínio tenant. I: arquitetura base por organização. | Mantém atomicidade/residência; aumenta operação multi-base. Dep.: F4.4 futura. | Cada evento tem exatamente um ledger autoritativo na base fonte; não há réplica integral Central. |
| F7-D2 — Que evento reside onde? | por caller; por família; registry | Registry versionado `(code,version)->location`; 25 códigos existentes, binding interno para códigos contextuais. I: catálogos F5/F9. | Evita sink confusion; catálogo deve evoluir. | Residência é allowlisted e imutável por versão, nunca fornecida pelo caller. |
| F7-D3 — Como escrever? | síncrono; outbox; ambos | Mesma transação se co-localizado; outbox/intenção durável antes da fronteira. I: F5/F9. | Sem 2PC; estado incerto reconciliável. | Nenhum efeito crítico começa sem commit local de ledger ou intenção durável. |
| F7-D4 — Qual semântica das quatro classes? | uniformizar; preservar F5 | Preservar tabela da secção 3.2; classe 3 deadline local 300 s. I: F5. | Fail-closed sem bloquear observacionais indefinidamente. | Classe 1 aborta sem aceite; classe 2 nunca autoriza; classe 3 reconcilia; classe 4 é recusada. |
| F7-D5 — Schema/partições? | tabela única; temporal; org+tempo | `audit`, RANGE mensal por `acceptedAt`, registry/head globais e DEFAULT. P: PostgreSQL exige incluir partition key em unique da tabela particionada. | Boa manutenção; mais objetos/preflight. Dep.: benchmark. | Partições mensais não definem cadeia nem podem ser eliminadas automaticamente. |
| F7-D6 — Identidade? | UUIDv4; UUIDv7; composta | UUIDv7 interno RFC 9562; unique global; não ordena causalidade. I: modelo lógico; P: RFC 9562. | Índice temporal; exige gerador/vetores. | `eventId` é UUIDv7 confiável e colisão falha fechado. |
| F7-D7 — Ordem? | global; org; stream; nenhuma | Monotónica por org/stream via head transacional; nenhuma ordem global. | Locks localizados; hot stream possível. | Só `sequence` dentro do mesmo stream estabelece ordem. |
| F7-D8 — Tempo? | app; DB; ambos | `observedAt` confiável + `acceptedAt=transaction_timestamp()`. P: PostgreSQL fixa timestamp ao início da transação. | Preserva origem e aceite; clock da DB ainda operacional. | Partição e consulta usam `acceptedAt`; skew não reordena eventos. |
| F7-D9 — Idempotência? | eventId; key composta; inbox apenas | unique composto + digest; duplicate igual retorna receipt, divergente falha. I: F9. | Redelivery seguro; produtor deve manter key. | Idempotência é scoped por produtor/org/code/version/key e ligada ao digest. |
| F7-D10 — Integridade? | constraints; digest; chain; Merkle | Chain por evento + checkpoints 10k/seal. | Deteta gap/reorder; contention por stream e custo de verify. | Cada evento inclui previous/event hash; verifier localiza primeira divergência. |
| F7-D11 — Domínio da cadeia? | global; org; partição; stream | organização+stream, atravessando partições; platform stream separado. | Isolamento/concorrência; sem ordem entre streams. | Genesis e head são independentes por stream; partição não reinicia cadeia. |
| F7-D12 — Canonicalização? | F9 própria; JCS; binária | RFC 8785/JCS v1 após schema/NFC; vetores oficiais. P: RFC 8785. | Interoperável; números/Unicode exigem regras estritas. | `JCS-1` é a única canonicalização v1; versões novas não reinterpretam hashes antigos. |
| F7-D13 — Hash? | SHA-256; SHA-512; outro | SHA-256 com algorithm code. P: NIST FIPS 180-4. | Suficiente para deteção; não autentica origem privilegiada. | Hash v1 usa SHA-256 sobre domínio+JCS e persiste algoritmo. |
| F7-D14 — HMAC/assinatura? | nenhuma; HMAC; assinatura/âncora | Nenhuma key em F7; port/checkpoint futuro. | Evita key theatre; não resiste a admin capaz de recalcular. Dep.: key ownership/rotation/backup. | F7 não alega autenticidade criptográfica externa, WORM ou assinatura legal. |
| F7-D15 — Proteção PostgreSQL? | grants; trigger; RLS; função; combinação | Função estreita SECURITY DEFINER, grants mínimos, RLS, triggers e preflight. P: PostgreSQL roles/RLS/triggers/function security. | Defesa em profundidade; complexidade de ownership/search_path. | Writer só executa append; mutações/DDL são recusadas ao runtime. |
| F7-D16 — Roles? | role única; writer/reader; quatro roles | owner, writer, reader, verifier + migrator operacional separado; NOLOGIN onde aplicável. | Menor privilégio; composição deve separar credenciais. | Nenhuma role runtime herda owner/migrator ou combina write e leitura ampla. |
| F7-D17 — Limite privilegiado? | omitir; alegar proteção; explicitar | Superuser/owner fora do trust boundary; checkpoint Central reduz risco de compromisso único. P: PostgreSQL superuser/RLS. | Risco residual material. Dep.: WORM/âncora futura. | `tamper-evident` não significa `tamper-proof`; privileged rewrite+rehash continua possível. |
| F7-D18 — PII/redaction? | payload genérico; hash; allowlist | PII deny-by-default, schemas por código, redaction antes do digest; IDs opacos continuam protegidos. I: segurança/privacidade; P: OWASP. | Minimização forte; novos casos exigem revisão. | Texto livre e PII não aprovada são rejeitados; hash não é anonimização. |
| F7-D19 — Query model? | SQL direto; views; port | `AuditQueryPort` sobre funções/views read-only, filtros fechados, keyset. | Previne SQL/IDOR; exige adapters Central/tenant. | Caller nunca fornece SQL, ledger, tenant, partition ou policy. |
| F7-D20 — Permissions F5? | role implícita; códigos F5; suporte bypass | Quatro códigos propostos, zero grants/perfis implícitos. I: F5 catálogo vazio. | Torna acesso explícito; requer aprovação F7. | Sem permission+membership+scope válidos a consulta é recusada antes dos dados. |
| F7-D21 — Limites? | livres; configuráveis sem caps; caps | 50/100, 31 d, 5 s, 1 MiB; export 100k/100MiB. | Reduz enumeração/DoS; sizing futuro pode baixar dentro dos caps. | Limites máximos são validados server-side; cursor não autoriza. |
| F7-D22 — Retenção provisória? | TTL; archive; conservar | Conservar, sem delete automático; avaliar apenas. I: política `REVIEW_MANUAL`. | Crescimento de storage. Dep.: política jurídica. | Ausência de política significa preservar, nunca apagar. |
| F7-D23 — Legal hold/delete? | implementar; port; ignorar | Ports/estado fail-closed, sem execução. | Prepara integração sem antecipar lei/SoD. | Hold desconhecido bloqueia futura destruição; F7 não elimina. |
| F7-D24 — Manutenção? | runtime; job; migration | Partições por migration/job operacional allowlisted; seal/checkpoint; DEFAULT; nunca drop. P: PostgreSQL partition maintenance. | Evita DDL runtime comum; precisa calendário operacional. | Attach/detach/drop requer workflow futuro e auditoria crítica. |
| F7-D25 — Backup/restore? | fora; restore local; operação completa | Restore sintético + verify integral local; produção é gate. | Prova formato, não RPO/RTO. Dep.: F4.4/operação. | Restore só é aceite após manifest, roles, counts, heads, checkpoints e chains válidos. |
| F7-D26 — Reconciliação/alertas? | manual; F9 scanner; auto repair amplo | F9 scanner; só retry/idempotent append/receipt automáticos; thresholds futuros. | Deteta incerteza sem reescrever história. | Mismatch/gap nunca é “reparado” por alteração do ledger. |
| F7-D27 — Migração/rollout? | backfill; cutover; novo ledger | Migrations apenas PG17 descartável; novo ledger sem backfill/UBI; expand-migrate-contract futuro. | Sem falsa completude histórica. Dep.: F4.4/F4.5/rollout. | O início do ledger é explicitamente datado; dados anteriores não são declarados auditados. |

## 5. Impacto nos 26 critérios

| Critério | Estado após aprovação | Decisões que o determinam | Evidência futura exigida |
| --- | --- | --- | --- |
| F7-AC-01 | completamente determinado | D2, D12 | startup/fingerprint/catalog tests |
| F7-AC-02 | completamente determinado | D2, D12 | unknown code/version/schema probes |
| F7-AC-03 | completamente determinado | D12, D18 | closed-schema/prototype/size tests |
| F7-AC-04 | completamente determinado | D18 | canary scans |
| F7-AC-05 | completamente determinado | D1–D4, D18 | forged context probes |
| F7-AC-06 | completamente determinado | D2, D18 | human/service/support matrix |
| F7-AC-07 | completamente determinado | D9, D12–D13 | duplicate/mismatch concurrency tests |
| F7-AC-08 | completamente determinado | D15–D17 | correction and mutation attacks |
| F7-AC-09 | completamente determinado | D15–D16 | role/grant attack matrix |
| F7-AC-10 | completamente determinado | D10–D17 | update/delete/reorder/gap tests |
| F7-AC-11 | completamente determinado | D10–D14 | vectors and first-divergence verifier |
| F7-AC-12 | completamente determinado | D6–D8 | concurrent streams/skew/late event tests |
| F7-AC-13 | completamente determinado | D3, D9 | API→outbox→worker→ledger tests |
| F7-AC-14 | completamente determinado | D1–D2, D19–D21 | organization A/B and IDOR |
| F7-AC-15 | completamente determinado | D19–D20 | F5 deny/MFA/SoD/support tests |
| F7-AC-16 | completamente determinado | D19–D21 | caps/cursor/export probes |
| F7-AC-17 | completamente determinado | D3–D4 | fault injection before effect |
| F7-AC-18 | completamente determinado | D4, D26 | unavailable audit port preserves deny |
| F7-AC-19 | completamente determinado | D3–D4, D9, D26 | 300 s deadline/redelivery/reconcile |
| F7-AC-20 | completamente determinado | D9, D26 | F9 redelivery/multi-worker |
| F7-AC-21 | completamente determinado | D3–D4, D9, D26 | crash at every boundary |
| F7-AC-22 | completamente determinado | D22–D24 | no-delete scans/role tests |
| F7-AC-23 | completamente determinado | D19–D23 | suspension/offboarding tests |
| F7-AC-24 | completamente determinado | D26 | metric/log label scans |
| F7-AC-25 | completamente determinado | D5, D15–D17, D24–D27 | disposable PostgreSQL 17 gate |
| F7-AC-26 | completamente determinado | D10–D17, D25 | documentation/assertion scan |

Resultado: 26 completamente determinados, 0 parcialmente determinados, 0 bloqueados para implementação local. Política jurídica, operação e tenants reais permanecem gates de integração, não ambiguidades do comportamento local.

## 6. Plano de testes recomendado

### Unitários

- catálogo/fingerprint, schemas e residência; unknown code/version e extras;
- JCS com vetores RFC 8785, NFC, safe integers, timestamps e payload 8 KiB/evento 16 KiB;
- UUIDv7 RFC 9562, idempotency digest, SHA-256, genesis, chain/checkpoint e primeira divergência;
- redaction e canários de secret/token/stack/DSN/email/documento/mensagem externa;
- cursor, filtros, limites, permissions e métricas sem IDs.

### Contratos

- `AuditAppendPort`, `AuditQueryPort`, `AuditVerifyPort`, receipts e erros sanitizados;
- quatro classes F5, timeout, deny preservado e deadline observacional 300 s;
- adapter F5 e F9, redelivery, inbox, duplicate same digest e mismatch;
- actor humano/service/support, suspensão/offboarding, suporte e reautorização de export.

### PostgreSQL 17 descartável

- migrations forward/rollback permitido/re-forward, manifest/fingerprint e runtime sem DDL;
- owner/writer/reader/verifier, `PUBLIC`, default privileges, RLS e `SECURITY DEFINER` search path;
- writer/reader contra `UPDATE`, `DELETE`, `TRUNCATE`, direct insert/select, DDL, sequence/head e partitions;
- dois writers no mesmo/diferentes streams, locks, rollback sem gap, idempotência e digest mismatch;
- partição corrente/próxima/DEFAULT, evento atrasado e seal/checkpoint sem drop;
- A/B com IDs coincidentes, IDOR, paginação e consulta F5;
- crash antes/depois de outbox, append, commit, inbox e ack; múltiplos workers e restart PostgreSQL;
- adulteração controlada por owner de teste para provar deteção e documentar que superuser pode recalcular;
- dump/restore sintético e verificação de manifest, roles, counts, heads, checkpoints e chains.

### Futuras validações operacionais

Thresholds/SLO, sizing, F4.4, backup/restore produtivo, RPO/RTO, retenção/legal hold, keys/HMAC/assinatura, WORM/âncora, SIEM, fan-out transversal, staging e rollout. Não bloqueiam `Ready` local; bloqueiam alegações e operação correspondentes.

## 7. Riscos residuais e experiências

- Hot stream pode serializar escrita: benchmark local deve medir um stream ruidoso e múltiplas organizações; pode aumentar número de streams, mas não remover ordem/chain aprovada.
- Particionamento mensal mais registry/head aumenta custo de migration/preflight: provar em PG17 descartável e manter runtime sem DDL.
- JCS/UUIDv7 exigem implementação/vetores rigorosos; nenhuma dependência deve ser escolhida sem revisão de licença, manutenção e comportamento.
- Checkpoint Central ajuda a detetar compromisso isolado de tenant, mas não é âncora independente e não supera administrador com controlo de ambos.
- Os limites de query/export são defaults/caps locais; produção pode reduzi-los após sizing, nunca ampliá-los sem nova decisão.
- A matriz `SEC-AC-*` continua documentalmente anterior a F9/F7 e deve ser reconciliada noutra tarefa.

## 8. Texto único para aprovação humana

> Aprovo conjuntamente F7-D1–F7-D27 conforme este contrato completo: ledger autoritativo na fonte, com eventos globais/identidade/membership/diretório/administração e concessões de suporte na Central e eventos de recursos operacionais no respetivo tenant, sem réplica integral; residência fixa por catálogo/versionamento e contexto interno; escrita crítica na mesma transação quando co-localizada ou por audit intent/outbox durável aceite antes do efeito, sem transação distribuída e com as quatro classes F5 preservadas; catálogo F7 v1 limitado aos 25 códigos F5/F9 já implementados; evento fechado v1 com UUIDv7 interno, actor humano/service/support, organização/tenant confiáveis, correlation/causation, payload máximo 8 KiB e evento máximo 16 KiB, sem secrets, tokens, stacks, DSNs, SQL, documentos, mensagens externas, texto livre ou PII não aprovada; sequência monotónica apenas por organização/stream, sem ordem global, `observedAt` validado e `acceptedAt=transaction_timestamp()`; idempotência composta e digest fail-closed; RFC 8785/JCS-1 após validação/NFC, SHA-256 e cadeia por organização/stream atravessando partições, checkpoint a cada 10 000 eventos e no sealing mensal, sem HMAC/assinatura/WORM/âncora nesta fase e reconhecendo que owner/superuser pode reescrever e recalcular; schema `audit`, owner/writer/reader/verifier separados, writer apenas por função insert-only `SECURITY DEFINER`, RLS/triggers/preflight, runtime sem update/delete/truncate/DDL; query port fechado com permissions propostas `audit_event.read`, `audit_event.verify`, `audit_event.export` e `audit_event.read_cross_organization`, sem grants implícitos, scope organizacional, página 50/máximo 100, janela 31 dias, timeout 5 s, resposta 1 MiB e export assíncrono máximo 100 000 linhas ou 100 MiB; partições mensais por `acceptedAt`, partição DEFAULT, sem drop/detach/eliminação automática; retenção conservadora, legal hold/archive apenas por ports futuros; F9 para redelivery/inbox/reconciliação, reparações automáticas apenas determinísticas/idempotentes; restore sintético verificado em PostgreSQL 17 descartável. Aprovo como defaults locais o skew síncrono de ±2 s, deadline observacional de 300 s, checkpoints 10 000/mês e os limites de consulta/export acima. Permanecem gates futuros política jurídica e retenção, legal hold operacional, F4.4/F4.5, tenants reais, keys/HMAC/assinatura, WORM/âncora/SIEM, backups/restore e RPO/RTO produtivos, sizing/alert thresholds, fan-out transversal, staging, produção e rollout. Esta aprovação permite promover F7 para Ready e elaborar o plano técnico; não autoriza implementação, migrations em bases persistentes, dados reais, rollout ou deploy.

## 9. Texto exato sugerido para `context/current-work.md`

### Decisões confirmadas

F7-D1–F7-D27 foram aprovadas conjuntamente em `context/research/f7-append-only-audit-decisions.md`. O contrato aprovado adota ledger autoritativo source-local (Central para domínio Central e tenant para domínio operacional), residência por catálogo, atomicidade local/outbox pré-efeito sem transação distribuída, quatro classes F5, evento fechado v1, UUIDv7, sequência por organização/stream, timestamps observado/aceite, idempotência composta, RFC 8785/JCS-1, SHA-256, hash chain/checkpoints, roles PostgreSQL segregadas, payload/PII deny-by-default, query port F5 com limites, retenção conservadora, partições mensais sem eliminação, F9 para entrega/reconciliação e migrations/testes apenas em PostgreSQL 17 descartável.

### Arquitetura e defaults aprovados

- Catálogo F7 v1 limitado aos 25 event codes F5/F9 existentes; novos códigos exigem versão/schema aprovados.
- Payload canónico máximo 8 KiB; evento completo máximo 16 KiB; JCS-1/SHA-256; cadeia por organização/stream; checkpoint a cada 10 000 eventos e no sealing mensal.
- `acceptedAt=transaction_timestamp()`; skew síncrono ±2 s; entrega observacional sem confirmação após 300 s entra em reconciliação.
- Consulta: página 50/máximo 100, janela 31 dias, timeout 5 s, resposta 1 MiB; export F9 máximo 100 000 linhas ou 100 MiB.
- Permissions propostas: `audit_event.read`, `audit_event.verify`, `audit_event.export`, `audit_event.read_cross_organization`; nenhuma grant/perfil automático.
- Partições mensais por `acceptedAt`, partição DEFAULT, nenhum drop/detach/delete automático.

### Limitações e gates futuros

F7 oferece append-only para runtime e tamper-evidence dentro do trust boundary testado. Não oferece proteção contra owner/superuser capaz de recalcular a cadeia, WORM, HMAC/assinatura, âncora externa, prova jurídica ou compliance. Política jurídica/retenção, legal hold operacional, F4.4/F4.5, tenants reais, backup/restore/RPO/RTO produtivos, keys, SIEM, sizing/alertas, fan-out, staging, produção e rollout permanecem gates de integração.

### Plano técnico

1. Catálogo/schema/envelope e adapters F5/F9.
2. Canonicalização, UUIDv7, idempotência, hash chain, checkpoints e verifier.
3. Migrations Central/tenant, partições, roles, função append-only, triggers/RLS e preflight.
4. Ports de append/query/verify/reconciliation e quatro classes F5.
5. Query F5, limites, audit-of-audit e export sintético via F9.
6. Reconciliação, métricas e restore sintético.
7. Gate unitário/contrato/adversarial e PostgreSQL 17 descartável contra F7-AC-01–26.

### Gate `Ready`

F7 pode ser promovida a `Ready` após registo da aprovação humana conjunta deste contrato. Nenhuma decisão comportamental necessária à implementação local permanece aberta; os gates jurídicos e operacionais limitam integração/alegações futuras, não a vertical slice sintética.

## 10. Fontes

### Internas

- `AGENTS.md`
- `context/project-overview.md`
- `context/architecture.md`
- `context/coding-standards.md`
- `context/features/security-privacy-and-audit-foundation.md`
- `context/decisions/multi-tenant-identity-and-data.md`
- `context/decisions/tenant-directory-and-lifecycle.md`
- `context/references/logical-data-dictionary.md`
- `context/history/f2-identidade-e-sessao-segura.md`
- `context/history/f3-membership-session-context.md`
- `context/history/f4-tenant-contract-lifecycle.md`
- `context/history/f4-tenant-central-directory.md`
- `context/history/f4-tenant-runtime-access.md`
- `context/history/f43-tenant-schema-compatibility.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f9-async-execution-foundation.md`
- `context/research/f5-authorization-policy-decisions.md`
- `context/research/f9-async-execution-decisions.md`
- `backend/src/authorization/audit.js`
- `backend/src/async/`
- `backend/src/security/centralMigrationManifest.js`
- `backend/src/security/tenantMigrationManifest.js`

### Primárias externas

- [PostgreSQL 17 — Database Roles](https://www.postgresql.org/docs/17/user-manag.html): roles, ownership e privilégios.
- [PostgreSQL 17 — Row Security Policies](https://www.postgresql.org/docs/17/ddl-rowsecurity.html): RLS, `FORCE ROW LEVEL SECURITY` e bypass por superuser/`BYPASSRLS`.
- [PostgreSQL 17 — `ALTER DEFAULT PRIVILEGES`](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html): revogação e privilégios de objetos futuros.
- [PostgreSQL 17 — Function Security](https://www.postgresql.org/docs/17/perm-functions.html): riscos e fronteira de funções executadas por roles.
- [PostgreSQL 17 — `CREATE TRIGGER`](https://www.postgresql.org/docs/17/sql-createtrigger.html): triggers de `UPDATE`, `DELETE` e `TRUNCATE`.
- [PostgreSQL 17 — Table Partitioning](https://www.postgresql.org/docs/17/ddl-partitioning.html): constraints/índices e manutenção de partições.
- [PostgreSQL 17 — Date/Time Functions](https://www.postgresql.org/docs/17/functions-datetime.html): semântica de `transaction_timestamp()` e `clock_timestamp()`.
- [RFC 9562 — UUIDs](https://www.rfc-editor.org/rfc/rfc9562.html): formato e semântica UUIDv7.
- [RFC 8785 — JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785.html): serialização determinística, limites de números e tratamento Unicode.
- [NIST FIPS 180-4 — Secure Hash Standard](https://csrc.nist.gov/pubs/fips/180-4/upd1/final): SHA-256.
- [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html): minimização, sanitização, proteção e monitorização de logs de segurança.
- [OWASP ASVS 5.0 — V16 Security Logging](https://github.com/OWASP/ASVS/blob/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.json): logging de autenticação/autorização, proteção de logs e erros sem detalhes sensíveis.
