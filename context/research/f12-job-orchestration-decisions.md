# F12 — semântica determinística dos jobs de oportunidade

- Data: 2026-10-09
- Estado: recomendação complementar, sujeita a aprovação humana
- Decisão: semântica fechada de `opportunity.duplicate.scan` e `opportunity.catalog.reconcile`
- Autoridade: estado atual do repositório, sem pesquisa externa

## Decisão resumida

Recomenda-se que `opportunity.duplicate.scan` seja um scan tenant-local da revisão corrente, não arquivada, com seleção por união de blocking keys exatas, ordenação total e no máximo 32 pares por execução. O job não percorre páginas funcionais nem transporta cursor no payload: o repository executa uma única consulta bounded, indexada e ordenada; o 33.º par serve apenas para indicar `moreCandidates=true` e origina uma continuação interna com a mesma revisão source e uma chave opaca derivada pelo produtor. Cada continuação começa estritamente depois do último par ordenado. Uma revisão source diferente invalida a continuação.

`opportunity.catalog.reconcile` deve adotar a alternativa **reparação apenas de projeções derivadas**. O catálogo v1 tem exatamente dois reason codes reparáveis:

1. `QUALITY_PROJECTION_DRIFT`: recalcula e corrige apenas a materialização corrente de qualidade, sem alterar snapshot, revisão, proveniência ou conteúdo;
2. `DUPLICATE_CANDIDATE_RESCAN_REQUIRED`: não repara pares diretamente; agenda idempotentemente `opportunity.duplicate.scan` para a revisão corrente.

Qualquer drift de snapshot, normalização ou content digest dentro de revisão imutável, lifecycle, ownership, proveniência, decisão humana, documento, schema, manifest ou auditoria é detetado como não reparável e termina `PERMANENT` ou `INCOMPATIBLE`, sem write funcional. Não é acrescentado qualquer evento F7.

## Factos confirmados

- Existem três pesquisas F12 anteriores no repositório. O pedido refere quatro; o quarto documento é este novo complemento.
- O payload v1 do scanner contém exatamente `opportunityId`, `revisionId`, `ruleVersion`; o payload do reconciler contém exatamente `opportunityId`, `revisionId`, `reasonCode`. Não existe campo de cursor e não pode ser acrescentado nesta decisão.
- O algoritmo fechado já produz apenas `EXACT`, `POSSIBLE` ou `DISTINCT` e reason codes de `deduplication.js`; esta pesquisa não altera o algoritmo.
- O limite F4 dos dois jobs é `maxRows=32`, `maxBytes=1 MiB`, timeout 5 s, schema exclusivamente `004_f12_opportunity_catalog/COMPATIBLE`.
- `duplicate_candidate` guarda par canónico, revisões observadas, versão da regra, classificação, reasons, evidence, digests e estado de reconciliação. A PK impede `(A,B)` e `(B,A)` separados depois da canonicalização.
- `idempotency_record` já admite `DUPLICATE_RECORD` e `QUALITY_RECOMPUTE`.
- Revisões e proveniência são imutáveis. O snapshot e as projeções derivadas históricas não podem ser reescritos.
- A oportunidade corrente materializa quality score/bucket, digest e versões. A revisão corrente contém snapshot, normalized projection, quality projection e digest.
- Os eventos F7 disponíveis e relevantes são `OPPORTUNITY_QUALITY_EVALUATED`, `OPPORTUNITY_EXACT_DUPLICATE_IDENTIFIED`, `OPPORTUNITY_DUPLICATE_CANDIDATE_IDENTIFIED` e `OPPORTUNITY_RECONCILIATION_REQUIRED`. Os quatro são observacionais; `OPPORTUNITY_DUPLICATE_DECISION_RECORDED` é reservado à decisão humana e não pode ser emitido pelo scanner.
- O envelope F9 liga conteúdo funcional ao organization, actor, operation, idempotency key e payload. Replay cria execution ID novo sem alterar o content digest funcional.
- Os índices atuais não cobrem todas as blocking keys sobre `revision.normalized_projection`. `provenance_source_identity` suporta identidade externa; os keysets de opportunity não substituem índices de blocking normalizado. Um `LIMIT 32` sem índice não prova trabalho bounded.

## Alternativas

### Duplicate scan

| Alternativa | Vantagem | Problema | Veredicto |
|---|---|---|---|
| varrer o catálogo em páginas e classificar tudo | não cria falso negativo por blocking | o payload não transporta cursor/accumulator; acumular top 32 exigiria novo estado persistente; custo lógico ilimitado | rejeitada |
| consulta única por blocking keys, `LIMIT 33`, ordem total | payload permanece fechado; cada attempt é bounded; usa apenas igualdade determinística | requer índices funcionais para todos os blocks aprovados | recomendada |
| apenas external ID/index já existente | implementável sem consequência física adicional | perde URL, programa/referência e sinais fracos aprovados | rejeitada |

### Catalog reconcile

| Alternativa | Vantagem | Problema | Veredicto |
|---|---|---|---|
| detect-only | máxima conservação | contradiz o job aprovado como reparação determinística e deixa quality materializada incorreta | insuficiente |
| reparar apenas projeções derivadas | preserva fontes e histórico; permite CAS/idempotência | exige distinguir rigorosamente materialização mutável de revisão imutável | recomendada |
| reparação ampla | tenta convergir qualquer drift | reescreve autoridade/histórico e permite heurísticas | rejeitada |

## `opportunity.duplicate.scan`

### Universo elegível

O source e cada target devem cumprir cumulativamente:

- pertencem ao mesmo tenant/organization resolvido por F3/F4; Central nunca entra num scan tenant;
- são oportunidades privadas correntes do repository tenant; não são aceites referências opacas Central de `organization_opportunity`;
- target é diferente do source;
- lifecycle de source e target é `DRAFT`, `ACTIVE` ou `STALE`; `ARCHIVED` é recusado como source e excluído como target;
- validation state pode ser `PENDING_REVIEW`, `VALIDATED_MANUAL` ou `CONFLICT`; validation não é blocking nem autoridade de classificação;
- apenas a revisão corrente de cada oportunidade é considerada;
- o `revisionId` do payload tem de coincidir com `current_revision_id` do source antes do cálculo e imediatamente antes do commit; caso contrário `PERMANENT/STALE_SOURCE_REVISION`, sem continuação;
- oportunidades com poucos campos continuam elegíveis se corresponderem a pelo menos um block. O classificador pode produzir `DISTINCT/INSUFFICIENT_EVIDENCE`;
- documentos e bindings F11 nunca influenciam seleção ou classificação;
- proveniência influencia apenas o block e a regra forte de identidade externa já aprovada;
- par já persistido continua elegível quando uma das revisões observadas, digest, rule version ou `reconciliation_state` deixou de ser corrente;
- par corrente com as mesmas revisões, digests, versão e classificação é no-op idempotente;
- uma decisão humana futura não é sobreposta pelo scanner. Como o modelo v1 ainda não possui tabela/estado separado de decisão humana, o scanner só escreve `duplicate_candidate`; quando essa decisão for materializada, terá de existir uma guarda explícita antes de ativar o respetivo workflow.

### Blocking keys fechadas

Os blocks formam uma união; basta um block coincidir para o par ser classificado pelo algoritmo completo. Null/ausência nunca coincide. O mesmo target encontrado por vários blocks aparece uma vez, conservando a prioridade mais forte.

| Prioridade | Código interno | Projeção exata | Suporte físico necessário | Risco |
|---:|---|---|---|---|
| 1 | `BLOCK_EXTERNAL_ID` | `sourceNamespace + NUL + normalizedExternalIdentifier` da proveniência da revisão corrente | índice existente `provenance_source_identity`, restringido à revisão corrente/tenant | baixo falso negativo apenas quando não existe ID; cardinalidade baixa |
| 2 | `BLOCK_PROGRAMME_REFERENCE` | `normalizedProgrammeName + NUL + normalizedCallReference`, ambos não-null | índice funcional tenant sobre os dois valores de `revision.normalized_projection`, ligado à revisão corrente | fontes sem ambos ficam fora deste block; cardinalidade normalmente baixa |
| 3 | `BLOCK_OFFICIAL_URL` | `normalized officialUrl`, não-null | índice funcional tenant sobre URL normalizada da revisão corrente | URLs ausentes não coincidem; URLs muito partilhadas podem ampliar candidatos |
| 4 | `BLOCK_CONTENT_DIGEST` | `content_digest` corrente igual | índice tenant por `(organization_id,content_digest,opportunity_id)` | é conservador e pode não encontrar equivalências parciais; baixa explosão |
| 5 | `BLOCK_TITLE` | título normalizado igual | índice funcional tenant sobre título normalizado da revisão corrente | títulos genéricos podem gerar muitos pares |
| 6 | `BLOCK_FUNDER` | financiador normalizado igual | índice funcional tenant sobre financiador normalizado | financiadores grandes podem gerar explosão |
| 7 | `BLOCK_DATE` | opening date igual ou closing date igual, ignorando null | índices tenant separados para datas correntes | datas comuns têm cardinalidade alta |
| 8 | `BLOCK_CLASSIFICATION` | igualdade de programme normalizado ou interseção exata de um código thematic/territory normalizado | índices funcionais/GIN apropriados sobre projeção normalizada corrente | maior fan-out; permanece exato, não fuzzy |

Os índices funcionais indicados são consequência necessária para provar que a consulta é bounded. Devem ser acrescentados à migration F12 ainda não integrada apenas depois da aprovação desta decisão, com novo checksum/fingerprint/preflight. Esta pesquisa não altera migrations. Sem esses índices, o scanner deve falhar startup/preflight como `INCOMPATIBLE`; não pode degradar silenciosamente para sequential scan.

### Ordem total

Depois de deduplicar targets encontrados em múltiplos blocks, a seleção é ordenada por:

1. menor prioridade numérica do block coincidente;
2. menor `opportunityId` target em ordem UUID bytewise.

A classificação e os reason codes são calculados **depois** de selecionados os no máximo 32 targets e, por isso, não influenciam a página. Esta separação é necessária para um cursor fechado compatível com o payload atual e impede que uma alteração de algoritmo reordene silenciosamente uma continuação da mesma `ruleVersion`. Dentro do resultado, os pares mantêm a ordem de seleção; não são reordenados por classificação.

Não entram `updated_at`, timestamp, ordem física, chegada, score, random ou relógio. Um target em vários blocks conserva uma só linha e a prioridade mais forte; todos os blocks coincidentes podem ser usados apenas como evidence codes internos, nunca como novos reason codes F7/F12.

### Batch, cursor e continuação

- Cada execução devolve/persiste no máximo 32 pares e consulta `LIMIT 33` para detetar continuação.
- O cursor não integra o payload. É produzido internamente e incorporado apenas na idempotency key da continuação criada pelo orchestration service.
- Cursor lógico v1: `{lastBlockPriority,lastTargetId}`. Tenant, source opportunity, source revision e rule version já pertencem ao envelope/payload e entram no digest de ligação, não são repetidos em claro.
- A idempotency key interna da continuação tem formato exato `f12ds1.<priority>.<targetUuid>.<digest>`, onde `digest` é SHA-256 hexadecimal de `C4G:OPPORTUNITY:DUPLICATE_SCAN_CURSOR:v1\0` + JCS de `{organizationId,sourceOpportunityId,sourceRevisionId,ruleVersion,lastBlockPriority,lastTargetId}`. O máximo é 111 bytes, dentro do limite F9 de 128. Não existe cursor no payload, nova coluna ou metadata arbitrária.
- O cursor é ligado ao tenant, source/revision, rule version e ordem. Alteração de qualquer campo falha fechado.
- A continuação usa nova execution ID e idempotency key de página, mas mantém a identidade funcional raiz `tenant/source/revision/ruleVersion` no digest interno.
- Retry/redelivery da mesma página reutiliza a mesma key/digest. Replay mantém o content digest funcional e volta a autorizar.
- Se source revision mudar, a página atual não escreve e nenhuma continuação é criada. Um produtor autorizado pode criar um novo scan raiz para a nova revisão.
- O scan fica completo quando não existe 33.º target. Não existe accumulator global nem segunda ordenação dependente da chegada.
- Para evitar starvation, o cursor avança pela ordem total; novos targets anteriores ao cursor não entram nessa execução lógica e serão apanhados pelo scan da revisão seguinte ou por novo scan raiz explícito.
- Limite por execução: 32 resultados, uma consulta por família de blocks consolidada, 1 MiB e 5 s. Não se fixa limite global de catálogo nem SLO nesta decisão. Se a consulta indexada não terminar em 5 s, `RETRYABLE/TIMEOUT`; após retries F9 bounded, dead-letter/reconciliação, nunca scan ilimitado.

### Persistência

- `EXACT` e `POSSIBLE` são persistidos para pares novos.
- `DISTINCT` não é persistido para um par novo, evitando crescimento quadrático. É persistido apenas ao atualizar um `duplicate_candidate` já existente que deixou de ser exact/possible, preservando evidência de que o candidato anterior foi reavaliado.
- Par existente com mesmas revisões, digests, rule version, classificação, reasons e evidence é no-op: não atualiza `observed_at`, não cria idempotency adicional nem evento.
- Mudança de revisão/digest ou classificação atualiza o mesmo par canónico e as revisões observadas. Nunca cria par invertido.
- Idempotency key funcional de par: digest interno de `tenant + sourceRevision + targetRevision + ruleVersion`; o request digest inclui classificação/reasons/evidence/digests.
- Persistência de candidato, idempotency record e F7 usam o mesmo client/transação F4. Fence e deadline são revalidados antes do commit.
- Evento existente: `EXACT` novo/alterado usa `OPPORTUNITY_EXACT_DUPLICATE_IDENTIFIED`; `POSSIBLE` novo/alterado usa `OPPORTUNITY_DUPLICATE_CANDIDATE_IDENTIFIED`; transição para `DISTINCT` de candidato existente usa `OPPORTUNITY_RECONCILIATION_REQUIRED`. No-op e `DISTINCT` novo não emitem evento.
- `OPPORTUNITY_DUPLICATE_DECISION_RECORDED` nunca é emitido pelo scanner.

## `opportunity.catalog.reconcile`

### Objetivo e autoridade

O reconciler compara o snapshot imutável da revisão corrente com materializações derivadas que o modelo permite corrigir sem inventar conteúdo. Não edita snapshot, título, financiador, programa, referência, URL, datas, lifecycle, validation state, ownership, proveniência, bindings/documentos, decisões humanas, schema ou grants.

O payload seleciona exatamente um reason code. A execução recarrega o recurso e confirma `revisionId`; não aceita uma lista fornecida pelo caller. Um produtor interno pode criar até duas execuções, uma por reason code, quando ambos forem detetados.

### Catálogo fechado v1

| reasonCode | Deteção/fonte autoritativa | Reparação/no-op | Repository/operação | Idempotência, CAS e F7 | F10/F9 | Concorrência e proibições |
|---|---|---|---|---|---|---|
| `QUALITY_PROJECTION_DRIFT` | recalcular `evaluateQuality(snapshot atual, hasExternalIdentifier da proveniência corrente)` e comparar com `opportunity.quality_score`, `quality_bucket`, `quality_rule_version`; snapshot+proveniência são a fonte | atualizar apenas score, bucket e rule version na linha corrente. No-op se os três coincidem | método interno `recomputeCurrentQuality`, via `OPPORTUNITY_CATALOG_RECONCILE_JOB` | key por tenant/opportunity/revision/reason/rule version; digest da projeção esperada; CAS exige current revision/rowVersion sem incrementar revisão funcional; evento `OPPORTUNITY_QUALITY_EVALUATED` apenas quando existe write | signal `c4g.opportunity.reconciliation.required` na deteção e operation `opportunity.reconcile`; `SUCCESS` write/no-op; conflito CAS `RETRYABLE`; snapshot inválido `PERMANENT` | update concorrente vence por CAS e obriga novo cálculo; proíbe snapshot/revision/provenance/content/lifecycle/ownership |
| `DUPLICATE_CANDIDATE_RESCAN_REQUIRED` | existe par envolvendo a oportunidade com revisão/digest/rule version não corrente ou `reconciliation_state != CURRENT`, ou não existe evidência de scan para a revisão corrente quando o produtor determinístico o exige | não altera candidato diretamente; enqueue idempotente do scanner para opportunity/revision/ruleVersion. No-op se já existe outbox/inbox/completion com a mesma identidade funcional | outbox F9 na mesma transação local; nenhuma chamada direta ao handler | key por tenant/opportunity/revision/ruleVersion; digest do envelope funcional; evento `OPPORTUNITY_RECONCILIATION_REQUIRED` somente quando cria nova intenção | mesmo signal/operation; `SUCCESS` enqueue/no-op; infraestrutura transitória `RETRYABLE`; versão de algoritmo/schema desconhecida `INCOMPATIBLE` | alteração de revisão antes do commit cancela enqueue; proíbe reclassificar, merge, delete, decisão humana ou conteúdo |

Não entram no catálogo v1:

- `NORMALIZATION_DRIFT` ou `CONTENT_DIGEST_DRIFT`: a projeção divergente está dentro da revisão imutável. Não existe reparação segura sem reescrever história nem proveniência; deteção termina `PERMANENT/IMMUTABLE_REVISION_DRIFT` e emite apenas `OPPORTUNITY_RECONCILIATION_REQUIRED` se a auditoria observacional puder ser persistida sem alterar a revisão.
- `LIFECYCLE_DRIFT`: não é possível escolher silenciosamente entre snapshot e materialização corrente; `PERMANENT/LIFECYCLE_AUTHORITY_CONFLICT`.
- `DOCUMENT_BINDING_DRIFT`: bindings são append-only e protegidos por FK; disponibilidade posterior do documento não autoriza unbind/delete; detect-only fora do reconciler F12.
- referência Central indisponível: um job tenant não contacta Central nem transforma ausência externa em write local; fica para reconciliação cross-authority futura.
- outbox/inbox incerta: é responsabilidade da reconciliação F9 já existente, não reason code funcional F12.
- schema/fingerprint/capability drift: `INCOMPATIBLE` antes do query module; nunca reparado pelo job.

### No-op, conclusão e loops

- No-op devolve `SUCCESS/NO_CHANGE`, sem revisão, evento F7, idempotency record novo ou job adicional.
- Uma execução trata exatamente um reason code e faz no máximo uma reparação ou um enqueue. O limite F4 de 32 rows permite leitura bounded de evidência, não 32 writes.
- Múltiplos drifts são execuções separadas, criadas apenas pelo detector interno com keys distintas. Não há payload array.
- CAS/revision alterada durante o cálculo produz `RETRYABLE/STALE_REVISION`; após reload, se o drift desapareceu, no-op.
- `QUALITY_PROJECTION_DRIFT` não agenda outro reconciler. `DUPLICATE_CANDIDATE_RESCAN_REQUIRED` agenda no máximo um scanner por revisão/ruleVersion. Estas regras eliminam loops.
- Drift imutável/não reparável exige revisão humana/diagnóstico e termina `PERMANENT`; não cria revisão automática.
- Deadline e timeout são 5 s dentro do deadline F9. Cleanup tardio nunca converte falha em sucesso.

## Autoridade e segurança comuns

- Scanner: service actor fixo `F12_DUPLICATE_SCANNER`, reautorizado em cada attempt com `OPPORTUNITY_DUPLICATE_REVIEW`, adapter F4 interno `OPPORTUNITY_DUPLICATE_SCAN_JOB`.
- Reconciler tenant: service actor fixo `F12_CATALOG_RECONCILER`, reautorizado com `OPPORTUNITY_PRIVATE_UPDATE`, adapter `OPPORTUNITY_CATALOG_RECONCILE_JOB`. A variante Central não é usada.
- Organization/tenant vêm do envelope confiável e contexto F3/F4; payload não contém tenant, repository, module, permission ou infraestrutura.
- Suspensão/offboarding, schema `004/COMPATIBLE`, capabilities, lease, fence e deadline são revalidados por attempt e antes do commit.
- Toda persistência funcional e evento F7 aplicável usam o mesmo client tenant. Não existe fallback Central.
- F10 usa apenas job type, operation e result class allowlisted. Nenhum ID, cursor, payload, título, URL, SQL, DSN ou stack vira label/atributo.
- Falhas mapeiam apenas para `SUCCESS`, `RETRYABLE`, `PERMANENT`, `CANCELLED`, `EXPIRED`, `AUTHORIZATION_REVOKED`, `INCOMPATIBLE`, `POISON_MESSAGE` ou `CLEANUP_FAILURE`.

## Testes obrigatórios

### Scanner

- zero candidates: success/no writes/events;
- 1, 32 e 33+ targets, comprovando limite 32 e cursor interno;
- mesmo target em vários blocks aparece uma vez com prioridade mais forte;
- igualdade integral, UUIDs adversariais e desempate final estável;
- source revisto antes do cálculo e entre seleção/commit;
- retry, redelivery e replay mantêm identidade funcional e não duplicam par/evento;
- `(A,B)` e `(B,A)` concorrentes convergem;
- A/B e ID válido cruzado falham fechado;
- source archived é recusado; target archived é excluído;
- cursor adulterado/scope diferente é recusado;
- algorithm version desconhecida resulta `INCOMPATIBLE`;
- novo `DISTINCT` não persiste; transição de candidato existente para `DISTINCT` persiste uma vez;
- `EXPLAIN` comprova uso dos índices de blocking e ausência de sequential scan no corpus do gate.

### Reconciler

- cada um dos dois reason codes em drift e no-op;
- ambos os drifts geram execuções separadas, não payload composto;
- limite de uma reparação/enqueue por execução;
- CAS/revisão obsoleta, reparação concorrente e retry;
- falha F7 reverte quality repair ou outbox intent;
- replay não repete write/event/job;
- normalization/content/lifecycle/document/ownership/history drift não é reparado;
- tentativa de reason code desconhecido é `POISON_MESSAGE` antes de F4;
- loops: quality não reagenda reconcile; rescan não duplica scan;
- A/B, suspensão, revogação, capability/schema/fence/deadline;
- falha PostgreSQL transitória `RETRYABLE`, constraint/contrato permanente sanitizado;
- pipeline real outbox→relay→pg-boss→worker→inbox→F5→F4→F12/F7, sem handler direto.

## Impacto nos módulos existentes após aprovação

- `jobs.js`: fechar os dois payload validators e reason codes, mantendo os campos atuais.
- novo módulo de orchestration services: seleção interna de adapters, cursor interno, mapping F9 e no-op.
- repository F12: loaders bounded de revisão/proveniência; query de blocks; persistência condicional de candidate; recompute de quality; detector de candidate drift.
- factory local: ligar handlers aos orchestration services, sem ativar registry produtiva.
- migration/preflight tenant: consequência física dos índices de blocking. Não muda IDs, tabelas, permissions, events ou capabilities; exige aprovação antes de alterar `004`, checksum e fingerprint. A Central fica fora desta decisão complementar.
- testes/gate: pipeline PostgreSQL/pg-boss e OpenTelemetry real, além dos casos acima.

## Limites e decisões ainda abertas

A semântica funcional fica fechada por esta recomendação. Resta uma aprovação explícita antes da implementação porque os índices funcionais necessários afetam o SQL tenant ainda não integrado de `004`, embora não alterem o modelo lógico nem a numeração da migration. Sem essa aprovação, o scanner deve permanecer fail-closed como `INCOMPATIBLE`; não existe alternativa segura que seja simultaneamente completa, bounded e compatível com o payload atual.

Continuam fora do âmbito: F4.4/F4.5, rollout, scheduling produtivo, dados reais, R2/scanner, connectors/imports, fuzzy matching, decisões humanas/UI, matching/qualificação, merge/delete e SLO.

## Bloco único de aprovação humana

> Aprovo a semântica dos jobs F12 documentada em `context/research/f12-job-orchestration-decisions.md`. Para `opportunity.duplicate.scan`, aprovo universo exclusivamente tenant-local de oportunidades privadas correntes `DRAFT|ACTIVE|STALE`, source não arquivado, targets não arquivados, qualquer validation state fechado, apenas revisões correntes e recusa de source revision obsoleta; aprovo a união ordenada dos blocks exatos `BLOCK_EXTERNAL_ID`, `BLOCK_PROGRAMME_REFERENCE`, `BLOCK_OFFICIAL_URL`, `BLOCK_CONTENT_DIGEST`, `BLOCK_TITLE`, `BLOCK_FUNDER`, `BLOCK_DATE` e `BLOCK_CLASSIFICATION`, com null nunca coincidente e índices físicos/preflight obrigatórios; aprovo ordem total de seleção por prioridade do block e target UUID, calculando `EXACT|POSSIBLE|DISTINCT` e reason codes apenas depois dos no máximo 32 targets selecionados; aprovo batch `LIMIT 33`, cursor interno `f12ds1.<priority>.<targetUuid>.<digest>` ligado a tenant/source/revision/ruleVersion, continuação por novo envelope F9 interno e recusa se a revisão source mudar; aprovo persistir `EXACT` e `POSSIBLE` novos/alterados, persistir `DISTINCT` apenas para candidato já existente, no-op para par corrente idêntico, par canónico, idempotência por revisões/ruleVersion e zero merge/delete; aprovo eventos existentes `OPPORTUNITY_EXACT_DUPLICATE_IDENTIFIED`, `OPPORTUNITY_DUPLICATE_CANDIDATE_IDENTIFIED` e `OPPORTUNITY_RECONCILIATION_REQUIRED` conforme a transição, nunca `OPPORTUNITY_DUPLICATE_DECISION_RECORDED`. Para `opportunity.catalog.reconcile`, aprovo apenas reparação de projeções derivadas com os reason codes fechados `QUALITY_PROJECTION_DRIFT` — corrigir score/bucket/rule version correntes por CAS, sem nova revisão — e `DUPLICATE_CANDIDATE_RESCAN_REQUIRED` — criar uma intenção idempotente do scanner, sem reclassificação direta; aprovo no-op sem write/event/job quando já convergente, uma reparação ou enqueue por execução, eventos `OPPORTUNITY_QUALITY_EVALUATED` e `OPPORTUNITY_RECONCILIATION_REQUIRED` apenas quando existe efeito, e `PERMANENT`/`INCOMPATIBLE` sem reparação para drift de revisão imutável, lifecycle, documento, ownership, proveniência, decisão humana, schema ou infraestrutura. Aprovo os limites de 32 resultados, 1 MiB, 5 s, reautorização F5 por attempt, F4 source-local, fence/deadline antes do commit, F7 na mesma transação e F10 sem IDs. Aprovo como consequência física acrescentar à tenant `004` ainda não integrada apenas os índices funcionais de blocking e respetivo checksum/fingerprint/preflight, sem nova migration, tabela, permission, event ou capability; a Central permanece fora desta decisão.

## Referências locais

- `context/current-work.md`
- `context/research/f12-opportunity-catalog-decisions.md`
- `context/research/f12-f4-tenant-operation-matrix.md`
- `context/research/f12-local-integration-boundaries.md`
- `backend/src/opportunities/contracts.js`
- `backend/src/opportunities/normalization.js`
- `backend/src/opportunities/digests.js`
- `backend/src/opportunities/deduplication.js`
- `backend/src/opportunities/applicationService.js`
- `backend/src/opportunities/repositorySupport.js`
- `backend/src/opportunities/jobs.js`
- `backend/src/opportunities/tenantOperations.js`
- `backend/database/central/migrations/006_f12_opportunity_catalog.up.sql`
- `backend/database/tenant/migrations/004_f12_opportunity_catalog.up.sql`
- `backend/src/async/envelope.js`
- `backend/src/async/outboxRepository.js`
- `backend/src/async/inboxRepository.js`
- `backend/src/async/outboxRelay.js`
- `backend/src/async/deadLetter.js`
- `backend/src/async/jobResult.js`
- `backend/test/f12OpportunityDomain.test.js`
- `backend/test/f12PersistenceContract.test.js`
- `backend/test/f12TenantOperationMatrix.test.js`
- `backend/test/f9AsyncExecution.test.js`
- `backend/test/f9ExecutionPolicy.test.js`
- `backend/test/f9PostgresIntegration.test.js`
