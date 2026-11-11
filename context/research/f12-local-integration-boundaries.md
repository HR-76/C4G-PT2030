# F12 — fronteiras da integração local

## Decisão

Para considerar a F12 concluída **localmente**, deve ser adotada uma composition factory injetável que execute os componentes reais de domínio e coordenação sobre PostgreSQL 17 descartável, `pg-boss` real e OpenTelemetry SDK/exporters in-memory reais. A factory pode usar adapters sintéticos apenas nas fronteiras que as fundações já aprovaram: policy data F5 em memória, credential/secret provider F4, `ObjectStoragePort`, `MalwareScanPort`, relógios/aleatoriedade e exporters in-memory.

Não é requisito local da F12 criar persistence produtiva F5, providers R2/scanner, um composition root produtivo F3–F12, tenants provisionados, secrets reais ou rollout. A produção deve continuar fail-closed até aos gates futuros correspondentes.

Existem duas entregas de integração que pertencem realmente à F12:

1. handlers reais dos dois jobs F12, registados por uma factory fechada no registry F9 usado pelo worker local;
2. associação física tenant-local F11↔F12, ainda ausente da migration tenant `004`.

## Factos confirmados

### F3 e F4

- F3 materializa membership e contexto organizacional na Central e fornece revalidação PostgreSQL real.
- F4.2 foi deliberadamente fechada com runtime injetável, credential provider e binding verifier sintéticos. Secret manager, destinos reais e integração de produção foram excluídos.
- F4.3 prova migrations, manifest, preflight, resolver e transações sobre PostgreSQL descartável. F4.4 ficou responsável por provisioning, fleet, ligações/credentials operacionais, backup/restore e rollout de tenants reais.
- A matriz aprovada `f12-tenant-operations-v1` exige componentes F4 reais, mas não transforma o provider sintético de credenciais aprovado pela F4.2 numa lacuna F12.

### F5

- F5-D17 entrega engine, ports, adapters comuns e vertical slice sintética; integração em canais reais e persistência autoritativa ficaram como gates futuros.
- O histórico F5 declara expressamente que `AuthorizationDataPort` tem primeira implementação em memória, sem schema ou migration, e que toda a prova funcional usa dados/ports locais.
- A composição produtiva F5 valida catálogos e permanece sem grants implícitos. A F12 acrescentou operation/permission codes, mas não aprovou residência, schema ou administração persistente de grants, hierarquia, SoD e versões autorizativas.
- Portanto, exigir persistence ports produtivos F5 para fechar localmente a F12 criaria uma migration Central e decisões de residência/versionamento que não pertencem à F12 e reabriria indevidamente o fecho da F5.

### F7

- F7 possui ledger PostgreSQL source-local real, append service real e eventos F12 fisicamente allowlisted.
- Para mutações críticas F12, o efeito, idempotência e append F7 devem usar o mesmo client/transação local. Um audit double não substitui esta prova.

### F9

- F9 foi fechada com outbox/inbox PostgreSQL, `QueuePort`, adapter `pg-boss`, relay, worker, leases/fencing, retry, dead-letter, replay e observabilidade reais.
- O registry produtivo ficou intencionalmente vazio porque F9 não introduzia consumers funcionais. Cada feature consumidora deve fornecer handlers fechados e provar o pipeline, sem obrigar a ativação produtiva.
- A F12 aprovou dois jobs funcionais. Logo, os seus handlers e a factory que os regista são responsabilidade F12; ativação no entrypoint produtivo, descoberta operacional de tenants e credentials reais continuam dependentes de F4.4/rollout.

### F10

- F10 foi fechada localmente com OpenTelemetry SDK real e exporters in-memory reais. OTLP, Collector, backend, SIEM, credentials, thresholds e rollout ficaram futuros.
- O gate F12 deve inicializar o SDK antes da composição e inspecionar spans/métricas reais; não deve exigir exporter de rede.

### F11

- F11 aprovou metadata tenant-local PostgreSQL, repository e services reais, `ObjectStoragePort` double in-process e `MalwareScanPort` double local.
- R2/S3, SigV4, scanner real, URLs e CORS reais constituem Camada C futura. A composição produtiva permanecer sem provider e fail-closed foi um critério de fecho F11, não uma lacuna.
- O gate F12 deve usar metadata/repository/state machine F11 reais sobre PostgreSQL, mas storage e scanner doubles aprovados.

### F12 atual

- `opportunity_catalog.organization_opportunity` representa apenas relação tenant↔oportunidade privada ou referência opaca Central; não representa documentos.
- `document_storage.document.resource_type/resource_id` fixa o recurso no intent de upload. Não prova uma operação posterior de binding após `AVAILABLE/CLEAN`, não liga uma revisão documental específica e não oferece idempotência/digest F12 ou evento F7 atómico com a associação.
- Proveniência F12 representa origem do conteúdo/revisão, não attachment metadata. Usá-la como binding perderia FK para F11, estado documental, unicidade e semântica de retry.
- A migration tenant `004` não possui associação F11↔F12. Esta é uma lacuna real da F12.

## Sobre-extensões introduzidas pelo gate anterior

| Exigência acrescentada | Classificação correta |
|---|---|
| Persistence PostgreSQL produtiva de grants/policies/revocation/SoD F5 | Sobre-extensão; F5 aprovou ports e adapters locais in-memory, sem migration. |
| Composition root produtivo completo F3–F12 | Sobre-extensão; o fecho local requer factory injetável, não ativação produtiva. |
| Registry produtivo F9 obrigatoriamente não vazio | Sobre-extensão; handlers F12 devem existir e ser usados no gate, mas o entrypoint produtivo pode continuar fail-closed. |
| R2/scanner reais | Sobre-extensão e contrária ao contrato F11 local. |
| Secret provider/credentials/tenants operacionais | Gate F4.4, não requisito F12 local. |
| OTLP/backend/SIEM | Gate F10 futuro, não requisito F12 local. |
| Persistência do binding F11↔F12 | Não é sobre-extensão; é lacuna F12 real. |
| Pipeline F9 real em PostgreSQL/pg-boss para os dois jobs | Não é sobre-extensão; é integração local F12 necessária para AC-22. |

## Alternativas

### F5

| Alternativa | Vantagens | Problemas | Veredicto |
|---|---|---|---|
| A — persistence ports produtivos agora | Aproxima um deployment futuro | Exige migration Central, modelo administrativo, residência, versões, lifecycle e rollout não aprovados; altera o limite histórico F5 | Rejeitada |
| B — service/engine reais com adapters autoritativos in-memory fechados e versionados | Exercita membership, grants, scopes, SoD, MFA, revogação, IDOR e deny-by-default conforme F5-D17; mantém `TTL=0` | Não prova persistência ou administração produtiva, limitação que deve ser declarada | Recomendada |

No gate local, “F5 real” significa:

- `createAuthorizationService`, catálogos F12, policy engine, audit coordinator, assurance e channel/service actor adapters reais;
- membership/contexto F3 lidos da Central PostgreSQL descartável;
- resource ports que recarregam oportunidades/documentos pelos repositories reais;
- `AuthorizationDataPort` in-memory fechado, imutável e versionado, com grants sintéticos explícitos, scopes, SoD e versões de revogação;
- nenhuma decisão `allowed` pré-calculada ou injetada, nenhum mock que salte gates e nenhum grant produtivo.

Um adapter sintético aprovado implementa integralmente o port e permite mudar autoritativamente versões/estado durante o teste. Um mock proibido devolve simplesmente `allowed: true`, fornece decisão pronta ou evita membership, policy engine, resource loading, MFA, SoD ou auditoria.

### F9

Os dois handlers devem ficar num módulo F12 de worker/composição, construídos por uma factory que:

- regista exatamente `opportunity.duplicate.scan` e `opportunity.catalog.reconcile` através de `createOpportunityJobRegistry`;
- recebe `QueuePort`, outbox/inbox repositories, worker/execution lifecycle, autorização F5, runtime F4, services F12/F7 e telemetria F10 por interfaces existentes;
- escolhe internamente `OPPORTUNITY_DUPLICATE_SCAN_JOB` ou `OPPORTUNITY_CATALOG_RECONCILE_JOB`; o envelope/caller nunca escolhe handler, adapter, repository ou query module;
- recarrega recurso e reautoriza a cada attempt;
- usa o adapter tenant F4 próprio; a variante Central do reconciler permanece fora do F4;
- é usada pelo gate com PostgreSQL/pg-boss reais.

A registry global do entrypoint produtivo pode continuar vazia e o worker produtivo pode continuar a recusar startup funcional sem composição/configuração futura. Ligar discovery de tenants reais, secrets, pools operacionais, scheduling e rollout pertence à F4.4 e à integração operacional posterior.

### F11

O gate usa repository, metadata, upload service, state machine, scan service e autorização F11 reais. Apenas `ObjectStoragePort` e `MalwareScanPort` são doubles contratuais. F7, PostgreSQL, F9 quando o scan usa job, F10 e o binding F12 permanecem reais no âmbito local.

### Composition root

| Opção | Avaliação |
|---|---|
| 1 — produtivo completo | Anteciparia F4.4, secrets, providers, operação e rollout; rejeitada. |
| 2 — factory local/injetável | Prova a integração real local com infraestrutura descartável e apenas adapters já aprovados; recomendada. |
| 3 — testes isolados | Não prova ordenação F3→F5→F4, registry/worker F9, atomicidade F7 nem telemetria transversal; insuficiente. |

## Modelo da composition factory local

A factory sob `backend/src/opportunities/` deve montar, sem branches “só para teste”:

```text
F3 membership/context repository (Central PG)
  → F5 authorization service + real policy engine
      → F4 operation catalog/resolver/pool/lease executor
          → F12 repositories/query modules + F7 ledger (tenant PG)

F9 outbox (source PG) → relay → pg-boss (Central PG)
  → worker/registry → inbox (effect PG) → F5 → F4 → F12/F7

F11 services + metadata repository (tenant PG)
  → storage/scanner doubles approved → F5 → F4 document bind → F12/F7

F10 SDK/exporters in-memory observe application, relay, worker and document paths
```

Dependências obrigatoriamente reais no gate: F3 repository/context, F5 service/engine/catalogs, F4 catalog/resolver/pools/lease executor, F7 ledger, F9 outbox/inbox/relay/queue/worker, F10 SDK/exporters, F11 metadata repository/services, F12 repositories/query modules e PostgreSQL/pg-boss.

Injeções sintéticas autorizadas: credential/secret provider F4, binding verifier físico F4 quando ligado ao PostgreSQL descartável conhecido, F5 authorization data adapter, object storage, malware scanner, clocks/RNG e exporters in-memory. Todas devem ser fechadas, inventariáveis e incapazes de fornecer uma decisão funcional pronta.

A factory não é ligada automaticamente a `productionComposition.js` ou `worker.js`. A composição produtiva continua fail-closed até existir configuração operacional aprovada; a factory é reutilizável por um entrypoint futuro sem conter IDs, credentials, fixtures ou lógica específica do teste.

## Modelo físico recomendado para F11↔F12

### Alternativas consideradas

| Alternativa | Avaliação |
|---|---|
| 1 — `organization_opportunity` existente | Sem documento/version FK e sem semântica documental; rejeitada. |
| 2 — tabela F12 específica | Torna organização, oportunidade, documento/version, idempotência e auditoria verificáveis na mesma base; recomendada. |
| 3 — referência em `document_storage.document` | Exigiria mutar modelo/migration F11 já fechado, mistura autoridade F11/F12 e associa antes de disponibilidade; rejeitada. |
| 4 — apenas proveniência | Não garante FK, estado documental, unicidade ou retry; rejeitada. |

### Tabela

Adicionar à migration tenant ainda não integrada `004_f12_opportunity_catalog`:

`opportunity_catalog.opportunity_document_binding`

| Coluna | Contrato |
|---|---|
| `organization_id uuid` | Obrigatória; primeira componente de todas as chaves/FKs e RLS. |
| `binding_id uuid` | Identidade interna, PK composta com organização e unique global local à base. |
| `opportunity_id uuid` | FK `(organization_id, opportunity_id)` para oportunidade privada. |
| `document_id uuid` | Identidade F11 tenant-local. |
| `document_version_id uuid` | Versão concreta que estava `AVAILABLE/CLEAN` no bind. |
| `opportunity_revision_id uuid` | Revisão F12 observada e FK composta; impede binding sobre snapshot não identificado. |
| `expected_opportunity_row_version bigint` | CAS observado, positivo. |
| `idempotency_key text` | 8–128, unique por organização e operação de binding. |
| `request_digest char(64)` | SHA-256 interno sobre organização, oportunidade/revisão, documento/versão e operation domain separator. |
| `row_version bigint` | Inicia em 1; binding v1 é append-only e não tem update funcional. |
| `created_by_actor_type text` | `HUMAN` ou service actor aprovado, fechado. |
| `created_by_actor_reference text` | Referência interna limitada, nunca token/PII livre. |
| `created_at timestamptz` | `transaction_timestamp()` autoritativo. |
| `archived_at timestamptz` | Sempre `NULL` em v1; reservado apenas se uma operação futura de unbind/archive for aprovada. |

Constraints e índices:

- PK `(organization_id, binding_id)` e `UNIQUE(binding_id)`;
- `UNIQUE(organization_id, opportunity_id, document_id, document_version_id)`;
- `UNIQUE(organization_id, idempotency_key)`;
- FK `(organization_id, opportunity_id)` para `opportunity_catalog.opportunity`;
- FK `(organization_id, opportunity_revision_id)` para `opportunity_catalog.revision`;
- FK `(organization_id, document_id, document_version_id)` para `document_storage.document_version` usando a unique já existente;
- índice `(organization_id, opportunity_id, created_at, binding_id)` para reload bounded;
- índice `(organization_id, document_id, document_version_id)` para validação/inventário;
- checks para digest, limites, `row_version = 1` e `archived_at IS NULL` enquanto não existir lifecycle de binding.

O comando recarrega na mesma transação a oportunidade/revisão e a metadata F11. Exige oportunidade não `ARCHIVED`, row version/revision esperadas, documento/version da mesma organização e versão `AVAILABLE` com `scan_state='CLEAN'`. O evento crítico `OPPORTUNITY_PROVENANCE_LINKED` é appended pelo writer F7 com o mesmo client antes do commit.

Retry com a mesma key/digest devolve a projeção persistida. Mesma key com digest diferente falha fechado. Redelivery concorrente converge pelas duas unique constraints; não cria segundo binding ou evento. Archive da oportunidade não altera nem elimina o binding ou o documento. Não existe delete físico, unbind ou cascade destrutivo.

Segurança física:

- RLS por `organization_id = current_setting('app.organization_id', true)::uuid`;
- runtime F12 recebe apenas `SELECT, INSERT`; sem `UPDATE`, `DELETE`, `TRUNCATE` ou DDL;
- grants mínimos de `REFERENCES` ao owner F12 e `SELECT` das colunas F11 necessárias ao runtime/função de binding; não há ownership cruzado;
- queries schema-qualified e parametrizadas;
- rollback de `004` recusa dados F12 e remove a tabela com o schema, sem alterar metadata F11.

Como `004` ainda não foi integrada, esta correção pertence à própria `004`, não a uma `005`. A alteração exige novo checksum, fingerprint `004`, manifest cumulativo, preflight de tabela/FKs/RLS/grants/índices e atualização dos testes forward/rollback/re-forward.

## Matriz de evidência dos 11 critérios

| Critério | Evidência local mínima | Componentes reais | Adapter sintético permitido | Persistência necessária | Limitação futura preservada |
|---|---|---|---|---|---|
| AC-17 | A/B por create/get/list/update/jobs/binding; IDs válidos cruzados não chegam ao tenant errado | F3 PG, F4 resolver/lease, RLS e repositories F11/F12 | credential provider/binding verifier | Central F3/F4 e tenants A/B | tenants reais/F4.4 |
| AC-18 | resource reload antes de F5 e resposta uniforme para inexistente/B | F5 service/engine e resource ports sobre repositories | authorization data in-memory | recursos F11/F12 | integração HTTP produtiva |
| AC-19 | allow/deny, grant revogado e scope/state pelo caminho F12 | F5 catalogs/service/policy/audit adapter; F3 membership PG | policy snapshot/grants versionados in-memory | membership e recursos | persistence/admin F5 futura |
| AC-20 | MFA ausente/expirado/válido e SoD conflitante | policy engine e assurance F2/F5 | snapshot SoD/grants e clock | não requer persistence F5 | Keycloak/ações administrativas reais |
| AC-21 | mutação/binding/candidato e evento no mesmo client; falha F7 faz rollback | F7 ledger/writer e repository F12 | nenhum audit double para esta prova | tenant audit + F12 | sink/âncora/WORM futuros |
| AC-22 | ambos jobs por outbox→relay→pg-boss→worker→inbox→F5→F4→efeito; retry/replay/fence | stack F9, handlers F12, PG/pg-boss | clock/RNG e credential provider | outbox/inbox/execution/effect | ativação/scheduling produtivos |
| AC-23 | spans application/relay/worker, parent/links, métricas e falha exporter sem efeito | SDK OTel e exporters in-memory reais | exporters in-memory são o contrato local | nenhuma persistence de telemetria | OTLP/backend/SIEM/SLO |
| AC-24 | upload/scan AVAILABLE+CLEAN e bind persistente, A/B/estado/rollback | repository/services F11, tabela binding, F5/F4/F7 | storage e scanner doubles | metadata F11 + binding F12 | R2/scanner/Camada C |
| AC-25 | get/list/filtros/cursor/limites, `duplicateClass` e concorrência A/B | repositories/query modules/F4 transaction | nenhum adapter de dados | F12 tenant | sizing/search futura |
| AC-27 | `003`, `004`, READ_ONLY, capability/drift/module/actor mismatch recusados antes do efeito | manifest/preflight/catalog/resolver F4 | credential provider | Central snapshot + tenant ledger | fleet/cutover F4.4 |
| AC-29 | forward/restart/rollback/re-forward, concorrência, A/B e cleanup em PG17 | todas as migrations/repositories e pg-boss | apenas fronteiras aprovadas | Central + tenants descartáveis | rollout/backups/RPO/RTO |
| AC-32 | startup atómico de catálogos/manifests/handlers/factory; produção sem config continua fechada | validators e factories reais | adapters locais explicitamente declarados | manifests/ledger físicos | entrypoints e config produtivos |

Critérios de integração podem ser `Satisfied` localmente com esta evidência mesmo sem adapters produtivos expressamente excluídos. A limitação deve ser descrita como gate futuro, não como parte incompleta do comportamento local aprovado.

## Implementação necessária após aprovação

1. Alterar a migration tenant `004`, down migration, checksum, fingerprint, manifest e preflight para o binding acima.
2. Implementar repository/query module transacional de binding com F7 no mesmo client.
3. Implementar os dois handlers F12 e uma factory fechada de registry/worker F9; manter o registry global produtivo vazio/fail-closed.
4. Criar composition factory F12 injetável, sem fixtures ou IDs embutidos.
5. Criar adapters locais versionados para policy data F5 e fronteiras externas aprovadas; usar F3/resource repositories reais.
6. Executar gate PG17 descartável com Central, tenants A/B, pg-boss, metadata F11, F12/F7 e SDK F10.
7. Provar os onze critérios pela matriz anterior e documentar separadamente os gates produtivos preservados.

## Gates futuros preservados

- F4.4: provisioning, secret manager, credential rotation, discovery/fleet, operação e recovery de tenants reais.
- F4.5: migração/adaptação Legacy/UBI.
- F5: persistence/administração produtiva de grants, hierarquia, SoD, suporte e versões autorizativas.
- F9: scheduling, consumers ativados em entrypoints produtivos, sizing e operação multi-tenant real.
- F10: OTLP, Collector/backend/SIEM, retenção, thresholds, SLI/SLO e on-call.
- F11 Camada C: R2/S3, SigV4, URLs/CORS, scanner real, residência/DPA, encryption/lifecycle e comportamento de provider.
- staging, produção, rollout, deploy, dados reais, backups, RPO/RTO, retenção jurídica e legal hold.

Concluir a F12 localmente não afirma prontidão produtiva nem autoriza qualquer destes gates.

## Riscos

- A factory local pode tornar-se um segundo framework se duplicar os entrypoints; deve apenas compor ports/factories existentes e ser reutilizável futuramente.
- O adapter F5 in-memory só é válido se implementar versões e revogação por pedido; um `allow` stub invalidaria AC-19/20/22.
- A FK cross-schema F11↔F12 exige grants de `REFERENCES` e SELECT mínimos cuidadosamente testados; ownership não deve ser alargado.
- O pipeline F9 deve observar rows reais em outbox, pg-boss e inbox; chamar o handler diretamente não é evidência.
- Production fail-closed deve continuar coberta por testes para evitar que doubles locais se tornem fallback.

## Decisões fora do âmbito

- modelo administrativo e schema produtivo de grants F5;
- tecnologia de secret manager e operação F4.4;
- provider/conta/região de storage e scanner;
- ativação dos handlers F12 em produção e scheduling;
- observabilidade externa, SLOs e incident response;
- política futura de unbind/archive de attachments;
- rollout, deploy, dados reais e migração Legacy.

## Bloco único de aprovação humana

> Aprovo para o fecho **local** da F12 a composition factory injetável recomendada: `createAuthorizationService`, policy engine, catálogos e adapters F5 reais podem usar um `AuthorizationDataPort` in-memory fechado, imutável e versionado com grants sintéticos explícitos, sem persistence ou migration F5; membership F3 e resource loading continuam reais. Aprovo `ObjectStoragePort` e `MalwareScanPort` doubles locais conforme F11, mantendo metadata repository, services/state machine e PostgreSQL reais. Aprovo PostgreSQL 17 descartável, `pg-boss`, outbox/inbox/relay/worker F9, ledger F7, SDK/exporters in-memory F10 e repositories/query modules F11/F12 reais. Aprovo que os handlers `opportunity.duplicate.scan` e `opportunity.catalog.reconcile` residam numa factory F12 de worker/registry fechada usada pelo gate, enquanto a registry/entrypoint produtivos permanecem vazios e fail-closed sem F4.4. Aprovo acrescentar à migration tenant ainda não integrada `004_f12_opportunity_catalog` a tabela `opportunity_catalog.opportunity_document_binding` com organização, oportunidade/revisão, documento/versão, CAS observado, idempotency key/digest, actor, timestamp, FKs tenant-local, RLS, grants mínimos, append-only, sem delete e evento F7 na mesma transação; checksum, fingerprint, manifest, preflight e rollback serão atualizados. Esta aprovação permite afirmar satisfação local dos critérios quando o gate acima passar, mas não afirma prontidão produtiva, não ativa providers/entrypoints reais e não autoriza F4.4/F4.5, rollout, deploy ou dados reais.

## Fontes internas

- `context/current-work.md`
- `context/research/f12-opportunity-catalog-decisions.md`
- `context/research/f12-f4-tenant-operation-matrix.md`
- `context/history/f3-membership-session-context.md`
- `context/history/f4-tenant-contract-lifecycle.md`
- `context/history/f4-tenant-central-directory.md`
- `context/history/f4-tenant-runtime-access.md`
- `context/history/f43-tenant-schema-compatibility.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f7-append-only-audit.md`
- `context/history/f9-async-execution-foundation.md`
- `context/history/f10-operational-observability.md`
- `context/history/f11-private-document-storage.md`
- `context/features/security-privacy-and-audit-foundation.md`
- `context/features/opportunity-catalog.md`
- `backend/src/productionComposition.js`, `backend/src/worker.js`
- `backend/src/authorization/`, `backend/src/async/`, `backend/src/audit/`, `backend/src/documents/`, `backend/src/opportunities/`
- `backend/database/central/migrations/004_f9_async_execution.up.sql`
- `backend/database/tenant/migrations/001_f9_async_execution.up.sql`
- `backend/database/tenant/migrations/003_f11_private_document_storage.up.sql`
- `backend/database/tenant/migrations/004_f12_opportunity_catalog.up.sql`
