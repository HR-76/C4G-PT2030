# F9 — Contrato consolidado de execução assíncrona

## Estado da pesquisa

Pesquisa arquitetural para decisão humana conjunta de F9-D1–F9-D21. As recomendações deste documento não estão aprovadas, não promovem F9 e não autorizam código, migrations, acesso a bases persistentes, rollout ou deploy.

Data da consolidação: 2026-10-08.

## 1. Factos vinculativos, comportamento observado e lacunas

### 1.1 Decisões já vinculativas no projeto

- API e worker são processos independentes; a API não executa handlers de jobs.
- A fila do MVP é PostgreSQL atrás de abstração própria. Redis e broker dedicado ficam fora do MVP.
- A arquitetura admite `pg-boss` ou adapter equivalente, mas declara a tecnologia substituível.
- Outbox é gravada na mesma transação da alteração de origem; inbox torna o consumidor idempotente.
- Não há transações distribuídas. A entrega é pelo menos uma vez, com retries limitados, locks recuperáveis, dead-letter e reconciliação; não existe promessa de `exactly once`.
- Polling encontra outboxes pendentes mesmo quando a sinalização posterior ao commit falha; notificações não podem ser a fonte de progresso.
- Organização, tenant, actor, operação e infraestrutura vêm de contexto/adapters internos confiáveis, nunca do caller ou do payload livre.
- Jobs humanos revalidam membership F3/F5; jobs sistémicos usam service actor interno allowlisted com organização e operação fixas. Retry/replay não amplia autoridade.
- Suspensão/offboarding bloqueiam jobs funcionais. Apenas um catálogo operacional separado e explícito pode executar drenagem/reconciliação.
- F5 fixa quatro classes de auditoria: crítico pré-efeito, deny preservado, observacional reconciliável e capacidades fora de F5.
- `SEC-AC-11`, `SEC-AC-14` e `SEC-AC-15` pertencem a F9. Isolamento entre organizações, payload sanitizado e métricas de baixa cardinalidade são transversais.

### 1.2 Comportamento realmente existente

- `backend/src/server.js` executa notificações por `setInterval` e sincronização EU Funding por `node-cron` ou fallback `setInterval`, dentro do processo API.
- `backend/src/productionComposition.js` compõe serviços e jobs Legacy com o pool UBI.
- `backend/src/services/emailService.js` grava `email_outbox` Legacy e pode fazer SMTP no mesmo fluxo; isto não é uma outbox multi-tenant nem um worker separado.
- F4.1 tem transações, idempotency keys, CAS/locks e eventos atómicos específicos do diretório; não oferece outbox/inbox genérica.
- F4.2 implementa leases, fencing, deadlines, backoff/jitter, limites e reconciliação de cleanup em memória; não é fila persistente.
- F5 fornece channel adapter `JOB`, service actors, autorização sintética e audit port/doubles. Não há persistência de jobs, grants ou auditoria.
- `pg-boss` não está instalado. O backend é CommonJS e o runtime local é Node `24.13.1`.
- As migrations Central terminam em `003`; o baseline tenant é sintético/descartável. Nenhuma migration F9 existe.

### 1.3 Propostas antigas, não vinculativas

- `pg-boss` é a opção inicial prevista, não uma biblioteca aprovada para acoplamento direto.
- `email_outbox`, cron/timers e jobs UBI são material de migração, não contratos reutilizáveis.
- Tempos, concorrência, polling, retries, retenção, tamanho de payload, alertas e thresholds produtivos nunca foram aprovados.

### 1.4 Lacunas reais

Não existem entrypoint worker, queue port, adapter, schemas outbox/inbox, relay, registry de handlers, error taxonomy, dead-letter/replay, reconciliação persistente, shutdown coordenado ou gate PostgreSQL 17 de crash/redelivery. Também não existe integração real com Resend, R2, imports, conectores, exports, reporting ou jobs de produto.

## 2. Evidência tecnológica primária

- Em 2026-10-08, a release estável mais recente observada é `pg-boss` `12.37.0`, schema interno `45`. A própria release declara migration no upgrade e correções de shutdown/claims concorrentes. [Releases oficiais](https://github.com/timgit/pg-boss/releases)
- A documentação oficial de `pg-boss` 12 requer Node `22.12+` e PostgreSQL `13+`; Node 24.13.1 e PostgreSQL 17 satisfazem estes mínimos. A biblioteca usa `SKIP LOCKED`, suporta envio transacional, polling com `LISTEN/NOTIFY` opcional, retries/backoff e dead-letter. [Documentação oficial](https://github.com/timgit/pg-boss/blob/master/docs/index.md)
- `pg-boss` usa por omissão o schema `pgboss`. Pode impedir criação/migration automática com `createSchema:false` e `migrate:false`; quando existem migrations pendentes, `start()` bloqueia o uso. [Constructor oficial](https://github.com/timgit/pg-boss/blob/master/docs/api/constructor.md)
- Heartbeat e expiração são mecanismos diferentes; heartbeat mínimo é 10 segundos e o refresh do worker deve ser inferior. Polling continua a funcionar quando `LISTEN/NOTIFY` está ativo e é a rede de segurança. [Queues](https://github.com/timgit/pg-boss/blob/master/docs/api/queues.md) e [workers](https://github.com/timgit/pg-boss/blob/master/docs/api/workers.md)
- Os retries da biblioteca suportam backoff exponencial com jitter, cap, expiração e retenção; os defaults da biblioteca não são automaticamente a política C4G. [Jobs oficiais](https://github.com/timgit/pg-boss/blob/master/docs/api/jobs.md)
- PostgreSQL documenta `SKIP LOCKED` como adequado a consumidores concorrentes de tabelas tipo fila, mas a vista é deliberadamente inconsistente e não serve para consultas gerais. [PostgreSQL 17 — SELECT](https://www.postgresql.org/docs/17/sql-select.html)
- PostgreSQL documenta uma corrida inicial em `LISTEN`; a sequência segura é iniciar/commit do listener, inspecionar o estado e só depois usar notificações. Isto confirma que `NOTIFY` deve ser hint, não garantia. [PostgreSQL 17 — LISTEN](https://www.postgresql.org/docs/17/sql-listen.html)
- Node permite cancelar waits/timers promisificados com `AbortSignal`; shutdown precisa ainda de estado persistido/fencing porque cancelamento cooperativo não interrompe efeitos externos já iniciados. [Node.js timers](https://nodejs.org/api/timers.html) e [Node.js process](https://nodejs.org/api/process.html)

Inferência: `pg-boss` é compatível e reduz manutenção de claims/retries, mas não substitui o contrato C4G de outbox/inbox, autorização, fencing de efeitos, fairness, sanitização, replay ou reconciliação multi-base.

## 3. Contrato recomendado consolidado

### 3.1 Tecnologia, port e composição

Adotar um port interno C4G com adapter `pg-boss` `12.x`, inicialmente fixado à versão exata validada no lockfile e ao schema esperado pela release. O domínio, handlers e testes não importam classes, tipos, job objects, estados, nomes de queue ou opções `pg-boss`.

O `QueuePort` expõe apenas operações C4G: `publish(envelope)`, `claim(registration, limits)`, `heartbeat(claim)`, `complete(claim, result)`, `fail(claim, classifiedFailure)`, `cancel(jobRef)`, `deadLetter(jobRef, evidence)`, `redrive(authorizedReplay)` e snapshots sanitizados. O adapter traduz para `pg-boss`; APIs de singleton, debounce, throttle, cron, raw SQL, dashboard, migrations e connection objects não atravessam o port.

O schema Central `pgboss` é propriedade exclusiva da biblioteca. F9 mantém a versão esperada e os planos/migrations `pg-boss` no manifest Central, aplicados explicitamente pelo runner revisto; produção usa `createSchema:false` e `migrate:false`. O role de runtime não tem DDL. Startup valida versão da package, schema interno e queues/registry esperados; qualquer mismatch fecha worker e readiness sem consumir jobs.

Testes unitários usam adapter in-memory fiel ao port; testes de contrato executam os mesmos cenários contra adapter `pg-boss` e PostgreSQL 17 descartável. Nenhum objeto da biblioteca entra no domínio.

Não usar diretamente `pg-boss`: o acoplamento misturaria políticas C4G com opções da biblioteca e dificultaria substituição/testes. Não implementar uma fila completa própria: `SKIP LOCKED`, maintenance, retries e estados aumentariam superfície de concorrência e manutenção sem benefício arquitetural.

### 3.2 Topologia, schemas e transações

- Fila e schema `pgboss`: base Central, um deployment lógico por ambiente.
- Schema C4G `async_exec`: na Central para registry lógico, execução/replay/reconciliação global e inbox de efeitos centrais; no tenant para outbox e inbox de efeitos tenant-local.
- Outbox: na mesma base e transação do dado que origina o evento. Eventos centrais usam Central; eventos tenant usam o respetivo tenant.
- Inbox: na base onde o efeito transacional ocorre, com chave única por consumidor e idempotency key.
- Payload Central contém apenas IDs opacos, organização, actor/operation binding e dados sintéticos/allowlisted; nunca connection string, credential ref resolvida, host, schema físico ou DSN.

O relay reclama outboxes por `FOR UPDATE SKIP LOCKED`, publica envelope com identidade lógica estável e marca a outbox publicada. Não há transação distribuída: crash depois do publish e antes da marca pode republicar. A duplicação física conserva a mesma identidade lógica e a inbox elimina duplicação de efeito.

O worker não recebe pool tenant do job. Revalida actor/membership F5, resolve o tenant pelo contexto F3/F4 e `operationCode` do handler registry, adquire lease e só então chama o handler. Mismatch de organização, binding, versão, fence ou schema recusa antes da query.

Roles futuros:

- migration owner: cria/altera `pgboss` e `async_exec`, nunca usado pelo runtime;
- relay: lê/claims outbox e publica fila; apenas atualiza colunas de entrega da outbox;
- worker: consome fila e usa procedures/repositories allowlisted de inbox/execução;
- API: insere outbox apenas através da transação de domínio; não consome fila.

F9 pode criar migrations Central e tenant sintéticas/manifestos e validá-las em bases descartáveis. F4.4 continua responsável por aplicar o baseline F9 em tenants reais e por provisioning/rollout; F9 não precisa de tenant provisionado.

### 3.3 Semântica de entrega e efeito

- Aceite: o queue adapter confirma commit durável do job ou reconhece a mesma identidade lógica com digest idêntico. Conflito de digest é `INCOMPATIBLE`, nunca sucesso.
- Reclamado: existe claim persistido, attempt, owner, heartbeat e fence correntes.
- Concluído: autorização foi revalidada; inbox/effect transaction fez commit; e o adapter confirmou completion. Se o último ack for incerto, redelivery consulta a inbox e conclui sem repetir o efeito.
- Idempotency key: gerada pelo produtor confiável a partir da intenção funcional estável; imutável em retry/replay.
- Inbox key: `(consumerCode, jobType, jobVersion, organizationId, idempotencyKey)`.
- `eventId`: identidade lógica estável da intenção/outbox; `executionId`: identidade de cada publicação/replay; `attempt`: atribuído pela fila, nunca pelo payload.
- `correlationId` liga a operação; `causationId` aponta ao evento/execução imediata anterior; replay mantém root/causa e recebe novo `executionId`.
- Fencing: cada claim tem token monotónico. Antes de cada efeito, o handler confirma claim/fence/deadline e a inbox bloqueada. Worker antigo não consegue finalizar nem iniciar novo efeito.

Duplicação de entrega é esperada. Duplicação de execução pode ocorrer até à verificação da inbox. Duplicação de efeito é impedida para efeitos PostgreSQL pela inbox e efeito na mesma transação; para futuros efeitos externos exige idempotency key do fornecedor ou intent/outcome persistido e reconciliação. Não existe garantia `exactly once`.

Crash antes do efeito deixa claim expirar e redelivery retoma. Crash após efeito PostgreSQL mas antes do ack encontra inbox `COMPLETED`. Resultado externo incerto fica `RECONCILIATION_REQUIRED`; não se repete cegamente.

### 3.4 Envelope fechado e versionado

Envelope v1 proposto:

```json
{
  "envelopeVersion": 1,
  "eventId": "uuid",
  "executionId": "uuid",
  "jobType": "synthetic_resource.update",
  "jobVersion": 1,
  "organizationId": "uuid",
  "actor": {
    "type": "HUMAN|SERVICE",
    "actorId": "opaque-id",
    "membershipId": "opaque-id|null",
    "membershipVersion": 1,
    "authorizationVersion": 1,
    "serviceExecutionId": "opaque-id|null"
  },
  "operationCode": "registry-owned-code",
  "correlationId": "uuid",
  "causationId": "uuid",
  "idempotencyKey": "opaque-stable-key",
  "createdAt": "UTC ISO-8601",
  "notBefore": "UTC ISO-8601|null",
  "deadlineAt": "UTC ISO-8601",
  "payloadVersion": 1,
  "payload": {}
}
```

Produtor confiável fixa `eventId`, `executionId`, organização, actor, operação, correlação/causa, idempotência e tempos. Registry fixa handler, service actor permitido, versões, schema do payload, queue interna, timeout, retry class, concorrência e categoria F5. A fila atribui `attempt`, claim e fence fora do payload imutável.

Serialização: JSON UTF-8 canónico, apenas null/boolean/string/número finito seguro/arrays densos/objetos plain; profundidade máxima 8, máximo 100 chaves por objeto, string máxima 4096 bytes e envelope serializado máximo 32 KiB. UUIDs e timestamps usam formas canónicas; campos extra, accessors, prototypes, cycles, binary, `BigInt`, `Date` implícita e números não finitos são recusados.

Proibidos: secrets, passwords, tokens, cookies, OTP, private keys, DSNs, connection/credential refs, host/porta/base/schema físicos, SQL, stack traces, documentos/binários, HTML integral, payload externo bruto e PII não classificada. PII é proibida por omissão; exceção futura exige schema, finalidade, minimização, retenção e proteção aprovados. Dados grandes usam referência opaca futura.

Envelope/handler/payload desconhecido ou combinação fora da matriz `N` e `N-1` é `INCOMPATIBLE` e vai para dead-letter sem handler. Não há upcast implícito; transformações são funções puras, explícitas, versionadas e testadas.

### 3.5 Defaults locais e relações temporais

| Parâmetro local F9 | Default recomendado | Relação/invariante |
| --- | ---: | --- |
| polling normal | 1 s | garantia de progresso; jitter de 0–250 ms |
| polling de reconciliação | 30 s | independente de `NOTIFY` |
| batch outbox/queue | 10 | limitado antes de claim |
| heartbeat timeout | 30 s | respeita mínimo `pg-boss` de 10 s |
| heartbeat refresh | 10 s | `< heartbeat/2 + margem`; três oportunidades antes de expirar |
| margem de fencing | 5 s | nenhum novo efeito nos últimos 5 s da validade/deadline |
| timeout de handler | 120 s | inferior ao deadline global |
| deadline global do job | 300 s desde aceite | inclui espera e retries locais |
| shutdown grace | 30 s | para de reclamar; aborta cooperação; não promete terminar handler de 120 s |
| clock skew tolerado | 2 s | DB UTC é autoridade; excesso fecha execução |
| tentativas totais | 5 | tentativa inicial + 4 retries |
| backoff | full jitter, base 2 s, cap 60 s | delay aleatório em `[0,min(60,2×2^retry)]` |

O worker deixa de reclamar no shutdown, emite AbortSignal, mantém heartbeat enquanto drena e após 30 s abandona a claim sem marcar sucesso; lease/heartbeat e fence tornam o job recuperável. Estes defaults são determinísticos para F9 local. Produção pode configurar polling 0,5–30 s, heartbeat 10–300 s, handler 1–3600 s, deadline até 24 h, grace 5–300 s, 1–10 tentativas e cap de backoff até 3600 s, mas valida sempre `refresh < heartbeat`, `fencingMargin < heartbeat`, `handlerTimeout < deadline`, e deadline suficiente para a política de retries. Sizing/carga aprovados são gate antes de staging/produção.

`LISTEN/NOTIFY` fica desligado no baseline local inicial. Pode ser ativado posteriormente como hint de latência, mantendo polling de segurança, conexão dedicada e teste de reconnect/race.

### 3.6 Taxonomia fechada de resultados

| Classe | Retry | Terminal/dead-letter | Auditoria/evidência |
| --- | --- | --- | --- |
| `SUCCESS` | não | `COMPLETED` | observacional sanitizado |
| `RETRYABLE` | até 4, dentro do deadline | dead-letter ao esgotar/expirar | reason code allowlisted, tentativa, nextAt |
| `PERMANENT` | não | dead-letter | causa sanitizada; sem mensagem externa como policy |
| `CANCELLED` | não | `CANCELLED`; reconcilia efeito iniciado | evento autorizado/observacional conforme ação |
| `EXPIRED` | não | dead-letter `DEADLINE_EXCEEDED` | tempos e attempt mínimos |
| `AUTHORIZATION_REVOKED` | não | `CANCELLED` funcional ou dead-letter para investigação | deny preservado; nunca reativa |
| `INCOMPATIBLE` | não | dead-letter/quarentena | versões/digest, sem payload integral |
| `POISON_MESSAGE` | não | dead-letter imediato | schema/reason code; sem eco inseguro |
| `CLEANUP_FAILURE` | não repete efeito; reconciliação | estado `RECONCILIATION_REQUIRED` | falha agregada sanitizada |

Somente códigos internos registados podem produzir `RETRYABLE`. HTTP status, texto de erro de fornecedor, exception name ou mensagem externa nunca decidem retry. Timeout antes de efeito pode ser retryable; timeout/erro com efeito externo incerto é cleanup/reconciliation, não retry automático.

### 3.7 Concorrência, fairness e ordenação

Defaults locais: concorrência global 8; reserva operacional 2; máximo funcional 6; por job type 4; por organização 2; batch 10. Configuração é validada com máximos absolutos de 64 global, 16 por tipo e 8 por organização. Produção escolhe valores até esses tetos por benchmark; ultrapassá-los exige nova decisão.

O scheduler do port aplica deficit round-robin por organização entre jobs elegíveis, com prioridade apenas dentro da classe e reserva operacional separada para reconciliação/cleanup. Uma organização sem backlog não retém capacidade. Uma organização ruidosa fica limitada a 2 localmente e não impede as restantes. Rate limiting controla frequência/janela de admissão; concurrency controla trabalho simultâneo — não são intercambiáveis.

Ordenação é opt-in no registry por `orderingKeyDigest` e apenas quando o domínio exige. Não usar singleton/debounce/throttle como substituto de idempotência. `pg-boss` pode implementá-los dentro do adapter, mas o domínio só vê política C4G `UNORDERED` ou `SERIAL_PER_KEY`.

Métricas: contadores/histogramas/gauges por `jobType` allowlisted, resultado, errorClass, queueClass e worker role. Organização, actor, event/job/execution/resource IDs, payload e idempotency key nunca são labels.

### 3.8 Dead-letter, replay e retenção

Dead-letter ocorre por `PERMANENT`, `INCOMPATIBLE`, `POISON_MESSAGE`, deadline, retries esgotados ou estado incerto que requer intervenção. Preserva IDs/versionamento, actor mínimo, organização, operação, correlação/causa, idempotency digest, timestamps, attempts, reason code, source/root job reference, payload digest/classificação e reconciliation reference. Não duplica secret, DSN, stack, SQL, conteúdo externo ou payload proibido.

Replay não é automático. Requer autoridade F5 explícita, `RECENT_MFA` quando sensível, motivo, ticket opaco e SoD quando aplicável. Revalida organização/membership/service actor, handler/version e payload antes de criar novo `executionId`; conserva `eventId`, root causation e idempotency key. Inbox `COMPLETED` torna replay no-op; inbox falhada só pode abrir nova geração de tentativa sob lock/fence e sem apagar história.

Cancelamento persiste intenção, incrementa fence e impede novos efeitos; handler recebe abort cooperativo. Efeito já iniciado fica em reconciliação. Expiração nunca é convertida em nova deadline pelo replay sem nova autorização.

Retenção local inicial: completed/succeeded 24 h na fila; published outbox 7 dias; cancelled/failed 7 dias; dead-letter 30 dias; inbox terminal e evidência de idempotência 30 dias após a última possibilidade de replay. Payload é minimizado; purge é job operacional idempotente. Estes valores são técnicos para dados sintéticos. Retenção jurídica/produtiva, legal hold e períodos contratuais permanecem gate externo e podem exigir valores maiores antes de dados reais.

### 3.9 Estados e reconciliação

| Componente | Estados/transições normativas |
| --- | --- |
| Outbox | `PENDING → CLAIMED → PUBLISHED`; `CLAIMED → PENDING` por lease expirada; `PENDING/CLAIMED → BLOCKED` por incompatibilidade; nunca apagar antes da retenção. |
| Relay | claim com owner/fence; publish idempotente; mark published; resultado incerto volta a observar queue/outbox por identidade/digest. |
| Queue | `CREATED/SCHEDULED → ACTIVE → COMPLETED`; falha classificada leva a `RETRY` ou `FAILED/DEAD_LETTER`; cancelamento a `CANCELLED`. |
| Inbox | `RECEIVED → AUTHORIZED → EFFECT_STARTED → COMPLETED`; recusa a `DENIED`; incerteza a `RECONCILIATION_REQUIRED`; replay autorizado incrementa geração sem trocar a chave. |
| Handler/effect | preflight → F5 → fence/deadline → efeito transacional → inbox commit → ack; efeito externo futuro usa intent/outcome. |
| Dead-letter | `QUARANTINED → REPLAY_AUTHORIZED → REDRIVEN` ou `RESOLVED/EXPIRED`; nunca redrive automático. |
| Reconciliação | `DETECTED → CLASSIFIED → AUTO_SAFE|HUMAN_REQUIRED → RESOLVED`; cada ação é idempotente e auditada. |

Claims usam `SKIP LOCKED`, ordem estável e batch 10. Polling de 1 s com jitter garante progresso; notificação futura apenas desperta polling. Recovery reabre claims com heartbeat vencido e fence novo. Reconciliação procura outbox presa, publicação incerta, queue sem outbox conhecida, inbox incompleta, completion incerta, lease expirada, dead-letter não resolvida e versões divergentes.

Reparações automáticas permitidas: republicar mesma identidade/digest, libertar claim expirada, concluir ack quando inbox prova `COMPLETED`, marcar duplicado/no-op e renovar observação. Exigem autoridade humana: alterar payload/versão/organização/actor, ignorar F5, criar nova idempotency key, redrive permanente, adotar registo órfão desconhecido, apagar evidência ou executar compensação destrutiva.

### 3.10 F5, auditoria e revogação

- Actor humano: envelope conserva originator; no início do attempt revalida user, organização, membership/version e autorização F5. Mudança entre enqueue e execução recusa.
- Service actor: registry cria actor interno com `serviceId`, organização, operationCode, executionId e authorizationVersion; payload nunca o fornece.
- Apenas `synthetic_resource.read` e `synthetic_resource.update` podem existir em fixtures F9; não são permissions produtivas.
- `SERVICE_JOB_DISPATCHED` é crítico antes de aceitar/publicar a intenção que produz efeito; falha aborta a ação/outbox quando a transação ainda é controlável.
- Denials de actor, membership, organização, policy, envelope ou scope permanecem deny mesmo se a auditoria falhar.
- `SERVICE_JOB_COMPLETED` e sinais de heartbeat/reconciliação seguros são observacionais reconciliáveis.
- Replay/cancelamento privilegiado e qualquer futuro efeito sensível usam evento crítico antes do efeito.
- O envelope/audit event só transporta campos allowlisted F5 e digests mínimos; o audit port não é o queue port e não prova ledger append-only.

Se F5 revoga entre enqueue e execução, o worker não chama o handler. Se revoga durante execução, fence/version é revalidado imediatamente antes do primeiro efeito e de cada novo efeito sensível; trabalho já atomicamente committed não é desfeito por inferência e segue reconciliação/compensação explícita.

## 4. Matriz F9-D1–F9-D21

Todas as recomendações abaixo são propostas, ainda não aprovadas.

| ID | Pergunta e opções viáveis | Recomendação e fundamento | Impacto, risco, dependências e redação normativa proposta |
| --- | --- | --- | --- |
| F9-D1 | `pg-boss` direto; port+adapter; fila própria PostgreSQL. | Port C4G + adapter `pg-boss` 12.x. Reutiliza concorrência madura sem contaminar domínio. | Risco de adapter incompleto/upgrade. Depende de contrato tests. **Norma:** “Domínio só conhece `QueuePort`; `pg-boss` é adapter substituível e versionado.” |
| F9-D2 | Fila Central, por tenant ou híbrida. | Fila Central; outbox na fonte; inbox junto do efeito. | Exige relay multi-base, mas evita fila por tenant. **Norma:** “Coordenação é Central; atomicidade local permanece na base de origem/efeito.” |
| F9-D3 | Tudo Central ou separação global/tenant. | Jobs globais Central; intenção/efeito tenant-local no tenant; fila guarda refs opacas. | Requer F4 para resolução, não F4.4 real. **Norma:** “Nenhum dado operacional tenant é copiado para a fila além do envelope mínimo.” |
| F9-D4 | `public`, schemas próprios ou schema library-owned. | `pgboss` exclusivo da biblioteca; `async_exec` C4G na Central/tenant; migrations explícitas. | Mais manifests/roles; reduz colisão. **Norma:** “Runtime não tem DDL e startup recusa drift/migration pendente.” |
| F9-D5 | Polling, notification ou híbrido. | Polling adaptativo é garantia; `LISTEN/NOTIFY` opcional como hint posterior. | Latência/carga parametrizáveis. **Norma:** “Perder NOTIFY nunca perde trabalho.” |
| F9-D6 | At-most-once ou at-least-once. | At-least-once + inbox/idempotência/fencing. | Duplicação física esperada. **Norma:** “Não existe garantia exactly-once.” |
| F9-D7 | Lease/heartbeat fixos ou por classe. | Local: heartbeat 30 s, refresh 10 s, margin 5 s; registry pode apertar, produção faz sizing. | Workload longo requer parâmetros maiores validados. **Norma:** “Refresh < heartbeat e nenhum efeito após margem/fence.” |
| F9-D8 | Retry linear, exponencial; jitter; máximo. | Códigos fechados, full jitter, base 2 s, cap 60 s, total 5 attempts local. | Produção ajusta dentro dos limites após carga. **Norma:** “Mensagem/status externo nunca decide retry.” |
| F9-D9 | Deadline global ou por tipo. | Registry fixa deadline absoluto; local 300 s, handler 120 s; payload não altera. | Jobs longos futuros exigem decisão do tipo. **Norma:** “Retry nunca prolonga deadline.” |
| F9-D10 | Retenção imediata ou por estado. | 24 h completed, 7 d outbox/failed/cancelled, 30 d DLQ/inbox locais. | Não é política jurídica. **Norma:** “Retenção produtiva é gate; purge preserva evidência mínima.” |
| F9-D11 | Teto único ou por tipo. | Envelope máximo 32 KiB e limites menores no registry. | Jobs de ficheiros usam refs futuras. **Norma:** “Oversize é poison/permanent antes da persistência.” |
| F9-D12 | PII proibida ou allowlist. | Proibida por omissão; exceção por schema/finalidade/retenção aprovados. | Features consumidoras precisam classificar campos. **Norma:** “Payload genérico não contém PII.” |
| F9-D13 | Storage encryption ou field-level. | Interface/classificação agora; field-level só com keys/rotação aprovadas. | Dados sintéticos não dependem de secret manager. **Norma:** “Payload sensível real permanece bloqueado.” |
| F9-D14 | Limites globais/tipo/org. | Local 8 global, 4/type, 2/org, 2 slots operacionais; caps 64/16/8. | Throughput produtivo requer benchmark. **Norma:** “Configuração excedente falha startup.” |
| F9-D15 | FIFO simples ou fairness/reserva. | Deficit round-robin por organização e reserva operacional; ordering opt-in por key. | Scheduler no port; risco de complexidade testado. **Norma:** “Prioridade não permite starvation cross-org.” |
| F9-D16 | Replay automático ou autorizado. | Nunca automático para DLQ; F5/MFA/SoD conforme ação, novo executionId e mesma chave semântica. | Exige UI/operador futuro, double local agora. **Norma:** “Replay não contorna inbox, F5 ou suspensão.” |
| F9-D17 | Cancelamento best-effort ou fenced/cooperativo. | Estado persistido + fence + AbortSignal; efeito incerto reconcilia. | Não promete interromper efeito já iniciado. **Norma:** “Cancelado não inicia novo efeito.” |
| F9-D18 | Envelope apenas ou envelope+handler. | Versionar ambos e payload; matriz explícita N/N-1. | Upgrades precisam contract tests. **Norma:** “Versão desconhecida nunca executa nem é descartada.” |
| F9-D19 | Suspensão termina tudo ou catálogo operacional. | Jobs funcionais bloqueados; catálogo operacional separado para drain/reconcile. | Catálogo real depende F4.4; fixture sintética basta. **Norma:** “Retry reautoriza e não reativa acesso.” |
| F9-D20 | Métricas e thresholds. | Labels por códigos fechados; IDs proibidos; thresholds produtivos são gate. | Mantém cardinalidade; alertas locais por backlog/age/failure. **Norma:** “Tenant/job/user/resource não são labels.” |
| F9-D21 | Bases dev ou descartáveis; canais reais ou doubles. | PostgreSQL 17 descartável, forward/rollback/drift/crash; slice sintética apenas. | Integrações reais ficam futuras. **Norma:** “F9 local não consulta bases dev nem fornecedores.” |

## 5. Impacto nos 23 critérios

| Critério | Estado após aprovação deste contrato | Decisões determinantes |
| --- | --- | --- |
| F9-AC-01 | completamente determinado | D1, D21 |
| F9-AC-02 | completamente determinado | D2–D4 |
| F9-AC-03 | completamente determinado | D1, D2, D5, D6 |
| F9-AC-04 | completamente determinado | D2, D6 |
| F9-AC-05 | completamente determinado | D6, D18 |
| F9-AC-06 | completamente determinado | D11, D12, D18 |
| F9-AC-07 | completamente determinado | D1–D4, D18 |
| F9-AC-08 | completamente determinado | D11–D13 |
| F9-AC-09 | completamente determinado | D19 |
| F9-AC-10 | completamente determinado | D2, D3, D14, D15 |
| F9-AC-11 | completamente determinado | D8 |
| F9-AC-12 | completamente determinado | D7–D9 |
| F9-AC-13 | completamente determinado | D8, D10, D16 |
| F9-AC-14 | completamente determinado | D10, D12, D20 |
| F9-AC-15 | completamente determinado | D7, D17 |
| F9-AC-16 | completamente determinado | D5–D9 |
| F9-AC-17 | completamente determinado | D7, D9, D17 |
| F9-AC-18 | completamente determinado | D2, D5, D10, D16, D21 |
| F9-AC-19 | completamente determinado | D20 |
| F9-AC-20 | completamente determinado | D16, D19, D20 |
| F9-AC-21 | completamente determinado | D18 |
| F9-AC-22 | completamente determinado | D5–D21 |
| F9-AC-23 | completamente determinado | D21 |

Após aprovação conjunta, nenhuma decisão comportamental necessária à implementação local fica bloqueada. Sizing, thresholds, retenção jurídica, encryption real e integrações externas permanecem gates operacionais/futuros, não ambiguidades do comportamento local.

## 6. Plano de testes recomendado

### Unitários

- Envelope/registry canónico, campos extras, prototypes, profundidade, 32 KiB, PII/secrets/DSN/SQL e versões incompatíveis.
- Error taxonomy, total de attempts, full jitter com RNG/clock controlados, deadline, cancellation e reason codes.
- F5 humano/service actor, actor falsificado, revogação entre enqueue/execute, audit classes e métricas sem IDs.
- Fair scheduler, limites 8/4/2, reserva 2, starvation, ordered key e noisy organization.

### Contratos de ports/adapters

- Mesma suite contra queue in-memory e `pg-boss`: publish duplicado, digest conflict, claim, heartbeat, fence, complete/fail/cancel/dead-letter/redrive.
- Adapter não devolve job object/SQL/config `pg-boss`; startup recusa package/schema/queue mismatch e migrations pendentes.
- Outbox/inbox/reconciliation/audit/authorization/tenant ports com fault injection em cada fronteira.

### PostgreSQL 17 descartável

- Alteração de origem e outbox na mesma transação, rollback, relay concorrente e `SKIP LOCKED`.
- Crash antes/depois de publish, mark-published, inbox, efeito e ack; publicação duplicada e conclusão incerta.
- Múltiplos workers, lease expirada, fence antigo, heartbeat perdido, restart PostgreSQL e reconnect.
- Permanent/poison/deadline/retries esgotados para dead-letter; replay autorizado/recusado e inbox completed no-op.
- Shutdown e cancelamento com subprocessos; outbox/inbox órfãos e reconciliação automática versus humana.
- Matriz A/B com IDs coincidentes, suspensão/offboarding e tentativa de resolver tenant/actor pelo payload.
- Migrations F9 e `pg-boss` forward, rollback permitido apenas vazio, re-forward, checksum, drift e incompatibilidade de schema.

### Futuras validações operacionais

- Benchmark/sizing com backlog, latência, conexões, CPU/IO, fairness e recovery para fixar parâmetros produtivos.
- Rollout N/N-1, upgrade `pg-boss`, backups/restore da fila, observabilidade/alertas e permissões PostgreSQL reais.
- Contract tests por consumidor real: Resend, R2, imports, conectores, reporting, exports, privacidade e F4.4.

## 7. Riscos residuais e gates

- `pg-boss` é mantido externamente e tem schema próprio: pin, revisão de release e teste de upgrade são obrigatórios.
- O queue Central pode ser gargalo/indisponibilidade comum; limites, backpressure, backups e capacidade ficam gate operacional.
- Fairness C4G não deve depender apenas de políticas internas da biblioteca; precisa de testes adversariais do adapter/scheduler.
- Efeitos externos nunca herdam atomicidade PostgreSQL; cada integração futura deve fornecer idempotência/reconciliação própria.
- Defaults locais não são SLOs. Produção exige sizing, thresholds, retention/privacy, encryption/keys, restore e runbooks aprovados.
- F4.4 aplica schemas a tenants reais e governa lifecycle; F9 apenas prova o contrato em Central/tenant descartáveis sintéticos.

## 8. Bloco único de aprovação humana

> Aprovo conjuntamente F9-D1–F9-D21 como contrato de execução assíncrona: `QueuePort` C4G fechado com adapter `pg-boss` 12.x versionado e substituível; schema library-owned `pgboss` na Central com migrations explícitas e bloqueadas no startup, e schema C4G `async_exec` na Central e em tenants sintéticos; fila/coordenação Central, outbox na mesma transação e base da origem e inbox na base do efeito; entrega pelo menos uma vez, sem garantia exactly-once, com identidade lógica/digest estáveis, inbox idempotente, fencing e reconciliação; envelope JSON canónico v1 até 32 KiB, versões de envelope/job/payload, actor/organização/operação fixados por fonte confiável e proibição de handler, policy, infraestrutura, DSN, secrets, SQL, documentos e PII não aprovada no payload; compatibilidade explícita N/N-1 sem upcast implícito; polling como garantia e LISTEN/NOTIFY apenas como hint futuro; defaults locais de polling 1 s, batch 10, heartbeat 30 s, refresh 10 s, margem de fencing 5 s, handler 120 s, deadline 300 s, shutdown 30 s, skew 2 s, cinco tentativas totais e full jitter base 2 s/cap 60 s; concorrência local 8 global, 4 por tipo, 2 por organização e reserva operacional 2, com caps configuráveis 64/16/8 e deficit round-robin; taxonomia fechada SUCCESS/RETRYABLE/PERMANENT/CANCELLED/EXPIRED/AUTHORIZATION_REVOKED/INCOMPATIBLE/POISON_MESSAGE/CLEANUP_FAILURE; dead-letter sanitizada, replay nunca automático e sempre reautorizado por F5 com novo executionId e mesma idempotency key; retenção local técnica de 24 h completed, 7 dias outbox/failed/cancelled e 30 dias dead-letter/inbox; cancelamento persistido, cooperativo e fenced; jobs humanos revalidam membership, service actors são internos, suspensão/offboarding bloqueiam jobs funcionais e auditoria respeita as quatro classes F5; métricas usam apenas labels fechadas sem IDs; testes usam PostgreSQL 17 descartável, múltiplos workers, crashes e dados exclusivamente sintéticos. Sizing, thresholds, retenção jurídica, encryption/keys reais, F4.4, jobs e integrações reais, staging/produção e rollout permanecem gates futuros. Esta aprovação permite promover F9 para Ready e elaborar o plano técnico, mas não autoriza implementação, migrations em bases persistentes, acesso às bases dev, deploy ou rollout.

## 9. Texto sugerido para `current-work.md` após aprovação

### Decisões confirmadas

F9-D1–F9-D21 foram aprovadas conjuntamente segundo `context/research/f9-async-execution-decisions.md`. F9 usa `QueuePort` fechado com adapter `pg-boss` 12.x; fila e `pgboss` ficam na Central, outbox na base/transação de origem e inbox na base do efeito, sob schema C4G `async_exec`. Entrega é pelo menos uma vez, sem `exactly once`, com envelope v1 fechado até 32 KiB, identidade lógica/digest estáveis, inbox idempotente, fencing, reautorização F5 e reconciliação. Polling garante progresso; `LISTEN/NOTIFY` é apenas hint futuro. Replay nunca é automático e não contorna F5, suspensão, offboarding ou inbox.

### Arquitetura aprovada

API não executa handlers. Worker separado compõe registry versionado, queue adapter, relay, inbox, authorization/tenant/audit ports e reconciliação. Runtime não tem DDL; migrations `pg-boss` e F9 são explícitas e startup falha fechado perante package/schema/queue incompatível. Queue payload contém apenas referências opacas e dados allowlisted; tenant é resolvido por F3/F4, nunca pelo payload.

### Defaults locais aprovados

Polling 1 s com jitter 0–250 ms; reconciliação 30 s; batch 10; heartbeat 30 s; refresh 10 s; margem de fencing 5 s; handler 120 s; deadline 300 s; shutdown 30 s; skew 2 s; cinco tentativas totais; full jitter base 2 s/cap 60 s; concorrência 8 global, 4/tipo, 2/organização e reserva operacional 2; envelope 32 KiB; retenção técnica 24 h completed, 7 dias outbox/failed/cancelled e 30 dias dead-letter/inbox.

### Parâmetros e integrações futuras

Produção pode configurar apenas dentro dos limites validados e após benchmark/sizing. Thresholds, SLOs, retenção jurídica, PII real, field encryption/keys, backup/restore, integrações Resend/R2/imports/connectores/reporting/exports, F4.4, staging e rollout permanecem gates próprios. F9 local usa apenas jobs, actors, organizações e payloads sintéticos em PostgreSQL 17 descartável.

### Plano técnico autorizado para planeamento

Planear, sem implementar: manifests/migrations explícitos; contracts de envelope/registry/errors; queue port e adapters in-memory/`pg-boss`; outbox/relay; inbox/effect transaction; worker lifecycle/claims/heartbeat/fencing/shutdown; retry/dead-letter/replay/cancel; fairness/limites; reconciliação; F5/audit/metrics; vertical slice sintética e gates PostgreSQL 17 de crash/redelivery.

### Gate para Ready

Após aprovação conjunta acima, não resta decisão comportamental necessária à implementação local e F9 pode ser promovida a `Ready`. A promoção não autoriza código, migrations persistentes, acesso às bases dev, integrações reais, deploy ou rollout.

## 10. Fontes

### Internas

- `AGENTS.md`
- `context/current-work.md`
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
- `backend/src/server.js`
- `backend/src/productionComposition.js`
- `backend/src/services/emailService.js`
- `backend/src/authorization/channelAdapters.js`
- `backend/src/authorization/audit.js`
- `backend/src/security/tenantLeaseExecutor.js`
- `backend/src/security/tenantPoolManager.js`
- manifests, migrations e repositories em `backend/database/` e `backend/src/security/`
- `backend/package.json`

### Externas primárias

- [`pg-boss` — documentação e requisitos](https://github.com/timgit/pg-boss/blob/master/docs/index.md)
- [`pg-boss` — releases](https://github.com/timgit/pg-boss/releases)
- [`pg-boss` — constructor/schema/migrations](https://github.com/timgit/pg-boss/blob/master/docs/api/constructor.md)
- [`pg-boss` — queues, retries, heartbeat e dead-letter](https://github.com/timgit/pg-boss/blob/master/docs/api/queues.md)
- [`pg-boss` — workers, polling, NOTIFY e shutdown signal](https://github.com/timgit/pg-boss/blob/master/docs/api/workers.md)
- [`pg-boss` — jobs, retry/backoff e retenção](https://github.com/timgit/pg-boss/blob/master/docs/api/jobs.md)
- [PostgreSQL 17 — `SELECT ... SKIP LOCKED`](https://www.postgresql.org/docs/17/sql-select.html)
- [PostgreSQL 17 — `LISTEN`](https://www.postgresql.org/docs/17/sql-listen.html)
- [PostgreSQL 17 — explicit/advisory locking](https://www.postgresql.org/docs/17/explicit-locking.html)
- [Node.js — process lifecycle/signals](https://nodejs.org/api/process.html)
- [Node.js — cancellable timers](https://nodejs.org/api/timers.html)

Next step: aprovar, rejeitar ou alterar conjuntamente o contrato F9 antes de promover a feature para `Ready`.
