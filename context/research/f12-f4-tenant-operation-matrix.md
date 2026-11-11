# Pesquisa técnica — matriz fechada de operações F4 para F12 tenant

## Decisão

Definir a matriz fechada de operações que podem adquirir uma lease F4 para executar caminhos tenant da F12, sem criar entradas F4 para caminhos Central e sem confundir operação funcional F5 com adapter técnico F4.

**Recomendação:** adotar a alternativa 3, uma matriz híbrida com **10 operações tenant**: operações humanas separadas por boundary técnico (`create`, `get`, `list`, `update`, `archive`, `restore`, revisão de duplicado), e códigos próprios para os dois jobs e para o binding F11↔F12. A matriz só pode ser publicada depois da evolução mínima do runtime e do manifest descrita neste documento.

Esta recomendação ainda requer aprovação humana. Não altera F12-D1–F12-D32.

## Factos confirmados no repositório

### Estado F4 atual

- `tenantOperationCatalog.js` aceita exatamente `accessMode` `READ|WRITE`, `workloadClass` `FUNCTIONAL|OPERATIONAL` e compatibility states `COMPATIBLE|READ_ONLY`.
- Cada entrada tem exatamente estes campos: `operationCode`, `ownerModule`, `accessMode`, `workloadClass`, `queryModule`, `compatibleSchemaVersions`, `requiredCapabilities`, `allowedCompatibilityStates`, `readOnlyEligible`, `inputSchema`, `resultSchema`, `requiredPermission`, `limits`, `timeoutMs`.
- O catálogo e todas as entradas/arrays/schemas/query modules/adapters têm de estar congelados. A resolução aceita apenas o adapter fechado `{ operationCode, queryModule }` e exige identidade referencial do `queryModule` registado. Um caller não pode selecionar um módulo apenas repetindo o código.
- O catálogo produtivo é `tenant-read-only-bootstrap-v1` com `operations: []`. Portanto, **não existe hoje qualquer operação F12, de leitura ou escrita, autorizada pelo F4**.
- O validator admite entradas `WRITE`, mas isto é apenas suporte declarativo. Em `COMPATIBLE`, `tenantLeaseExecutor` chama o módulo diretamente e não abre `BEGIN`, não fixa `statement_timeout` local e não garante `COMMIT/ROLLBACK`. Só o ramo `READ_ONLY` abre `BEGIN TRANSACTION READ ONLY`, fixa `statement_timeout`, valida o resultado, aplica `maxRows/maxBytes`, verifica a fence e faz `COMMIT` ou `ROLLBACK`.
- Em `READ_ONLY`, uma operação só passa se `readOnlyEligible === true`, `accessMode === 'READ'` e `allowedCompatibilityStates` contiver `READ_ONLY`. O validator obriga `readOnlyEligible` a coincidir com a presença de `READ_ONLY`.
- `COMPATIBLE` admite operações cujo contrato o inclua; não transforma por si só uma operação em autorizada. `READ_ONLY` é uma restrição adicional e nunca admite `WRITE`.
- O resolver valida F3 novamente, organização, deployment mode, provisioning/connection/version, binding físico, região, schema version, compatibility state, fingerprint e capabilities antes de emitir a lease. A primeira execução volta a validar membership e snapshot; mudança de revision/version/binding/fence recusa.
- O pool manager aceita apenas workloads `FUNCTIONAL|OPERATIONAL`, reserva capacidade distinta para `OPERATIONAL`, fixa deadline de lease e invalida leases por fence em drain/revoke/block.
- `limits` contém somente `maxPageSize`, `maxRows`, `maxBytes`, todos inteiros positivos. `timeoutMs` é obrigatório. O executor atual só aplica `maxPageSize` ao input e `maxRows/maxBytes` ao resultado no ramo `READ_ONLY`; no ramo `COMPATIBLE` estes limites de resultado não são aplicados pelo executor.
- `requiredPermission` aceita atualmente apenas o regex de código técnico maiúsculo. Não existe no resolver/executor comparação desse campo com o catálogo F5 nem com uma decisão F5. Nos testes, o valor é `SYNTHETIC_READ`. O nome do campo sugere permission, mas a forma aceita é a de um operation code F5, não a permission minúscula real.
- O manifest F4 ativo contém apenas `000_tenant_control_baseline`, capability `TENANT_CONTROL_BASELINE`, e matriz read/write apenas para essa versão. O publisher de observação só aceita essa versão e só publica essa capability.
- As migrations `001_f9_async_execution`, `002_f7_append_only_audit`, `003_f11_private_document_storage` e `004_f12_opportunity_catalog` existem e têm manifests próprios de feature, mas não estão integradas no manifest, fingerprint, compatibility matrix e publisher F4. O preflight F4, com o manifest default atual, não pode publicar `004` como schema state compatível.
- A migration `004` cria o schema tenant `opportunity_catalog`, RLS por `app.organization_id`, oportunidades, revisões, proveniência, relações, idempotência e candidatos. A `003` cria `document_storage`; a `002`, `audit`; a `001`, `async_exec`.
- A compatibilidade é declarada por listas exatas de versões. Nunca é inferida por número, ordem, proximidade ou pela expressão “N-1”.

### Contratos F5/F12 confirmados

Os sete operation codes F5 são:

| F5 operation | Permission |
| --- | --- |
| `OPPORTUNITY_READ` | `opportunity.read` |
| `OPPORTUNITY_PRIVATE_CREATE` | `opportunity.private.create` |
| `OPPORTUNITY_PRIVATE_UPDATE` | `opportunity.private.update` |
| `OPPORTUNITY_ARCHIVE` | `opportunity.archive` |
| `OPPORTUNITY_RESTORE` | `opportunity.restore` |
| `OPPORTUNITY_DUPLICATE_REVIEW` | `opportunity.duplicate.review` |
| `OPPORTUNITY_CENTRAL_MANAGE` | `opportunity.central.manage` |

Os quatro perfis produtivos têm zero grants. `archive`, `restore`, duplicate review e central manage são sensíveis; os respetivos contratos F5/assurance/SoD continuam aplicáveis. `OPPORTUNITY_CENTRAL_MANAGE` é Central-only e não entra no catálogo F4.

Os application services F12 expõem create/get/list/update/archive/restore/evaluateDuplicate. O repository tenant é fixo e source-local. Os jobs aprovados são `opportunity.duplicate.scan` e `opportunity.catalog.reconcile`. O binding F11 existe apenas para repository `ORGANIZATION` e requer autorização da oportunidade e do documento.

## Lacuna identificada e evolução mínima obrigatória

A matriz **não pode ser simplesmente acrescentada** ao catálogo atual. Antes de a publicar é necessário:

1. Integrar cumulativamente `000`–`004` no manifest F4, incluindo checksums, fingerprints, capabilities e compatibility lists exatas; atualizar preflight, publisher e startup atómico.
2. Criar uma nova versão explícita do catálogo, recomendada `f12-tenant-operations-v1`; manter o bootstrap vazio como versão histórica, sem mutá-lo.
3. Evoluir `tenantLeaseExecutor` para que toda entrada `WRITE` em `COMPATIBLE` execute em `BEGIN TRANSACTION READ WRITE`, fixe `statement_timeout`, valide input/resultado e limites, verifique fence imediatamente antes de `COMMIT`, e faça rollback sanitizado em qualquer falha. O `queryModule` recebe o client transacional já aberto e não pode iniciar/confirmar uma transação concorrente.
4. Aplicar validação de resultado e `maxRows/maxBytes` também em `COMPATIBLE`; aplicar o cap de input antes da aquisição/trabalho caro através do `inputSchema` e do adapter interno.
5. Ligar `requiredPermission` ao catálogo F5 no startup e à decisão F5 por request/attempt. Como o schema atual só aceita maiúsculas, a recomendação é tratá-lo explicitamente como **operation code F5** e validar `operationCatalog.resolve(requiredPermission)`. Renomear o campo seria uma evolução separada e não é necessário para F12.
6. Impedir o caller de fornecer `operationCode`, `queryModule`, permission, workload, access mode ou limites: o application/job/document adapter interno escolhe um adapter congelado pré-registado.
7. Exigir que authorization aconteça antes da resolução F4 e seja revalidada dentro do caminho de efeito quando o contrato F5/F9 o exige. F4 não concede autorização funcional.

Sem estas alterações, writes F12 catalogados não têm a garantia transacional/limites declarada e `requiredPermission` é metadata não aplicada.

## Inventário e classificação F12

| Ação aprovada | Classificação | F5 | Entrada F4 |
| --- | --- | --- | --- |
| create/update/archive/restore Central | Central-only | `OPPORTUNITY_CENTRAL_MANAGE` ou lifecycle aplicável | nenhuma |
| get/list Central | Central-only | `OPPORTUNITY_READ` | nenhuma |
| dedupe/reconcile Central | Central-only | actor/operação Central aprovados | nenhuma |
| create privada | tenant command | `OPPORTUNITY_PRIVATE_CREATE` | `OPPORTUNITY_PRIVATE_CREATE` |
| get privada | tenant query | `OPPORTUNITY_READ` | `OPPORTUNITY_PRIVATE_GET` |
| list/search privada | tenant query | `OPPORTUNITY_READ` | `OPPORTUNITY_PRIVATE_LIST` |
| update privada | tenant command | `OPPORTUNITY_PRIVATE_UPDATE` | `OPPORTUNITY_PRIVATE_UPDATE` |
| archive privada | tenant command | `OPPORTUNITY_ARCHIVE` | `OPPORTUNITY_PRIVATE_ARCHIVE` |
| restore privada | tenant command | `OPPORTUNITY_RESTORE` | `OPPORTUNITY_PRIVATE_RESTORE` |
| decisão/revisão humana de candidato | tenant command | `OPPORTUNITY_DUPLICATE_REVIEW` | `OPPORTUNITY_DUPLICATE_REVIEW` |
| scan determinístico assíncrono | tenant job | `OPPORTUNITY_DUPLICATE_REVIEW` | `OPPORTUNITY_DUPLICATE_SCAN_JOB` |
| reconciliação determinística tenant | tenant job | `OPPORTUNITY_PRIVATE_UPDATE` | `OPPORTUNITY_CATALOG_RECONCILE_JOB` |
| associação F11↔F12 | tenant document binding | `OPPORTUNITY_PRIVATE_UPDATE` + `DOCUMENT_READ` | `OPPORTUNITY_DOCUMENT_BIND` |
| merge, delete físico, import, connector, matching, candidatura/reporting | inexistente/fora do âmbito | nenhuma | nenhuma |

O mapping atual de `jobs.js` usa `OPPORTUNITY_CENTRAL_MANAGE` para todo `catalog.reconcile`. Para um efeito tenant isso é incorreto: central manage não concede autoridade tenant. A composição deve escolher internamente a variante source-local: Central sem F4; tenant com `OPPORTUNITY_PRIVATE_UPDATE` e a entrada F4 acima. Isto não cria uma oitava permission.

## Matriz fechada recomendada

Campos até `timeoutMs` são os nomes exatos validados pelo catálogo real. Actor, transação, efeitos, eventos/signals e testes são obrigações dos adapters/application services e não novos campos do schema F4.

Convenções comuns:

- `compatibleSchemaVersions = ['004_f12_opportunity_catalog']` para todas as entradas.
- `allowedCompatibilityStates = ['COMPATIBLE']` e `readOnlyEligible = false` para todas. A F12 não existe em `003`; nem get/list são legitimamente N-1 ou `READ_ONLY`.
- `timeoutMs = 5000`; deadline efetiva é o mínimo entre 5 s, lease F4 e, nos jobs, deadline F9.
- módulos são objetos singleton congelados exportados pelos paths indicados; owner/query module não vêm de input.
- input máximo F12 é 32 KiB, texto 16 KiB e listas 32 itens, aplicado pelos schemas F12 antes da lease. `maxBytes` abaixo limita o resultado.
- writes são `BEGIN TRANSACTION READ WRITE`; reads são `BEGIN TRANSACTION READ ONLY`, também em `COMPATIBLE`.

| operationCode | Finalidade; ownerModule / queryModule | mode / workload | requiredCapabilities | requiredPermission | limits (`page,rows,bytes`) | Actor e efeitos |
| --- | --- | --- | --- | --- | --- | --- |
| `OPPORTUNITY_PRIVATE_CREATE` | criar privada; `F12_OPPORTUNITY_APPLICATION` / `F12_PRIVATE_CREATE_QUERY` | `WRITE` / `FUNCTIONAL` | `F12_PRIVATE_CATALOG_WRITE`, `F7_AUDIT_LEDGER` | `OPPORTUNITY_PRIVATE_CREATE` | `1,1,1048576` | humano; cria snapshot/revision/provenance/idempotency e `OPPORTUNITY_CREATED`; proíbe tenant/ID/módulo do caller |
| `OPPORTUNITY_PRIVATE_GET` | carregar recurso tenant; `F12_OPPORTUNITY_APPLICATION` / `F12_PRIVATE_GET_QUERY` | `READ` / `FUNCTIONAL` | `F12_PRIVATE_CATALOG_READ` | `OPPORTUNITY_READ` | `1,1,1048576` | humano/service autorizado; sem efeito; signal `opportunity.read` |
| `OPPORTUNITY_PRIVATE_LIST` | list/search keyset; `F12_OPPORTUNITY_APPLICATION` / `F12_PRIVATE_LIST_QUERY` | `READ` / `FUNCTIONAL` | `F12_PRIVATE_CATALOG_READ` | `OPPORTUNITY_READ` | `100,100,1048576` | humano/service autorizado; filtros/order/cursor fechados; sem efeito; signal `opportunity.read` |
| `OPPORTUNITY_PRIVATE_UPDATE` | nova revisão/CAS; `F12_OPPORTUNITY_APPLICATION` / `F12_PRIVATE_UPDATE_QUERY` | `WRITE` / `FUNCTIONAL` | `F12_PRIVATE_CATALOG_WRITE`, `F7_AUDIT_LEDGER` | `OPPORTUNITY_PRIVATE_UPDATE` | `1,1,1048576` | humano; revision/provenance/idempotency + `OPPORTUNITY_REVISION_CREATED`; sem overwrite histórico |
| `OPPORTUNITY_PRIVATE_ARCHIVE` | arquivo lógico; `F12_OPPORTUNITY_APPLICATION` / `F12_PRIVATE_ARCHIVE_QUERY` | `WRITE` / `FUNCTIONAL` | `F12_PRIVATE_CATALOG_WRITE`, `F7_AUDIT_LEDGER` | `OPPORTUNITY_ARCHIVE` | `1,1,1048576` | humano, SoD/MFA F5; revisão/proveniência/idempotency + `OPPORTUNITY_ARCHIVED`; sem delete |
| `OPPORTUNITY_PRIVATE_RESTORE` | restauro explícito; `F12_OPPORTUNITY_APPLICATION` / `F12_PRIVATE_RESTORE_QUERY` | `WRITE` / `FUNCTIONAL` | `F12_PRIVATE_CATALOG_WRITE`, `F7_AUDIT_LEDGER` | `OPPORTUNITY_RESTORE` | `1,1,1048576` | humano, SoD/RECENT_MFA; revisão/proveniência/idempotency + `OPPORTUNITY_RESTORED` |
| `OPPORTUNITY_DUPLICATE_REVIEW` | decisão humana allowlisted; `F12_OPPORTUNITY_APPLICATION` / `F12_DUPLICATE_REVIEW_QUERY` | `WRITE` / `FUNCTIONAL` | `F12_PRIVATE_CATALOG_READ`, `F12_PRIVATE_CATALOG_WRITE`, `F12_DEDUPLICATION`, `F7_AUDIT_LEDGER` | `OPPORTUNITY_DUPLICATE_REVIEW` | `1,1,1048576` | humano, SoD/RECENT_MFA; par canónico + `OPPORTUNITY_DUPLICATE_DECISION_RECORDED`; sem merge/delete |
| `OPPORTUNITY_DUPLICATE_SCAN_JOB` | recalcular candidatos; `F12_OPPORTUNITY_WORKER` / `F12_DUPLICATE_SCAN_JOB_QUERY` | `WRITE` / `OPERATIONAL` | `F9_ASYNC_EXECUTION`, `F7_AUDIT_LEDGER`, `F12_PRIVATE_CATALOG_READ`, `F12_PRIVATE_CATALOG_WRITE`, `F12_DEDUPLICATION` | `OPPORTUNITY_DUPLICATE_REVIEW` | `1,32,1048576` | service actor fixo `F12_DUPLICATE_SCANNER`; candidato/idempotency/outbox-inbox e evento exact/possible; sem decisão humana/merge |
| `OPPORTUNITY_CATALOG_RECONCILE_JOB` | reparar apenas divergência determinística tenant; `F12_OPPORTUNITY_WORKER` / `F12_CATALOG_RECONCILE_JOB_QUERY` | `WRITE` / `OPERATIONAL` | `F9_ASYNC_EXECUTION`, `F7_AUDIT_LEDGER`, `F12_PRIVATE_CATALOG_READ`, `F12_PRIVATE_CATALOG_WRITE`, `F12_DEDUPLICATION` | `OPPORTUNITY_PRIVATE_UPDATE` | `1,32,1048576` | service actor fixo `F12_CATALOG_RECONCILER`; reautorização por attempt, `OPPORTUNITY_RECONCILIATION_REQUIRED`; sem repair destrutivo |
| `OPPORTUNITY_DOCUMENT_BIND` | associar metadata F11 a privada; `F12_DOCUMENT_BINDING` / `F12_DOCUMENT_BIND_QUERY` | `WRITE` / `FUNCTIONAL` | `F11_PRIVATE_DOCUMENT_STORAGE`, `F12_PRIVATE_CATALOG_READ`, `F12_PRIVATE_CATALOG_WRITE`, `F7_AUDIT_LEDGER` | `OPPORTUNITY_PRIVATE_UPDATE` | `1,1,1048576` | humano; F5 adicional `DOCUMENT_READ`; metadata `AVAILABLE/CLEAN`, mesma org, lifecycle F12 não `ARCHIVED`; idempotent binding + `OPPORTUNITY_PROVENANCE_LINKED` |

Os `inputSchema` e `resultSchema` de cada linha devem ser singletons fechados e congelados, derivados dos contratos F12/F11/F9 correspondentes. `maxPageSize=1` significa “não paginado”, não uma página funcional.

### Testes específicos por grupo

- Commands humanos: autorização antes de lease; actor service recusado; input extra/oversize; transaction read-write; F7 no mesmo client; CAS/idempotency/digest; rollback e fence antes de commit.
- Get/list: transaction read-only; get máximo uma linha; list 25 default/100 máximo, resposta 1 MiB, cursor scope/filter/sort; A/B e IDOR uniformes.
- Duplicate review: par canónico, `EXACT|POSSIBLE|DISTINCT`, reason codes, concorrência invertida, sem merge/delete.
- Jobs: só service actor registado; envelope v2, deadline, membership quando humano, reautorização, claim/lease/fence/inbox/outbox, redelivery/replay, suspensão/offboarding, capability ausente, zero efeito/evento duplicado.
- Binding: oportunidade e documento recarregados, ambas autorizações, ambas capabilities, tenant A/B, estados F11, archived F12, idempotência e rollback F7.

## Catálogo de capabilities

### Capability atualmente publicada

| Código | Estado |
| --- | --- |
| `TENANT_CONTROL_BASELINE` | existe no manifest/preflight/publisher F4 para `000`; não prova F9/F7/F11/F12 |

### Capabilities cumulativas propostas

| Código exato | Estabelecida por | Publicação/prova | Operações que exigem | Ausente / compatibilidade |
| --- | --- | --- | --- | --- |
| `F9_ASYNC_EXECUTION` | migration tenant `001_f9_async_execution` (`async_exec`) | manifest F4 cumulativo + preflight de objetos/grants/fingerprint | dois jobs | fail-closed; presente em 001–004, não em 000 |
| `F7_AUDIT_LEDGER` | `002_f7_append_only_audit` (`audit`) | manifest + preflight de ledger/functions/event constraints | todos os writes F12 | fail-closed; presente em 002–004 |
| `F11_PRIVATE_DOCUMENT_STORAGE` | `003_f11_private_document_storage` (`document_storage`) | manifest + preflight de schema/functions/RLS/grants | binding | fail-closed; presente em 003–004 |
| `F12_PRIVATE_CATALOG_READ` | `004_f12_opportunity_catalog` (`opportunity_catalog` e grants SELECT) | manifest + preflight/fingerprint/RLS | get/list e operações que recarregam recursos | fail-closed; **só 004** |
| `F12_PRIVATE_CATALOG_WRITE` | `004` (grants INSERT/UPDATE, sem DELETE/DDL) | manifest + preflight de grants/RLS/functions | todos os commands/jobs/binding | fail-closed; **só 004** |
| `F12_DEDUPLICATION` | `004` (`duplicate_candidate`, índices/constraints) | manifest + preflight de par canónico/classification/index | review e dois jobs quando tratam candidatos | fail-closed; **só 004** |

Não se propõe capability separada para “jobs/reconciliation”: `F9_ASYNC_EXECUTION` prova a infraestrutura e as capabilities F12 provam o efeito permitido. Uma capability `F12_JOB_*` seria redundante e não provaria um objeto físico adicional. Também não se propõe capability separada de binding F12: a conjunção `F11_PRIVATE_DOCUMENT_STORAGE + F12_PRIVATE_CATALOG_WRITE` é mais precisa e evita um bit que poderia ficar verdadeiro com um dos lados ausente.

Cada entrada de manifest deve publicar capabilities cumulativas apenas depois de o preflight provar os objetos daquela versão. `003` nunca publica qualquer capability F12; `004` publica as três F12. A evidência da Central é uma observação, não substitui o preflight físico.

## Matriz de compatibilidade de schema

| Operação | `003_f11_private_document_storage` | `004_f12_opportunity_catalog` / `COMPATIBLE` | `004` / `READ_ONLY` | drift/fingerprint/capability/version desconhecida |
| --- | --- | --- | --- | --- |
| create/update/archive/restore/review | recusada | permitida com F5 + caps | recusada | recusada antes de query |
| get/list | recusada: tabelas F12 não existem | permitida | recusada nesta release | recusada antes de query |
| duplicate scan/reconcile jobs | recusada | permitida com service actor/F9/F5 | recusada | `INCOMPATIBLE`/retry controlado, sem efeito |
| document binding | recusada: falta F12 | permitida com caps F11+F12 | recusada | recusada e sem associação parcial |

Não há N-1 F12 legítimo: `003` tem F11 mas não contém as tabelas F12. A frase aprovada “reads podem suportar N/N-1 explicitamente” é uma possibilidade de evolução, não autorização para declarar 003 compatível. Writes são apenas 004.

Durante migration, `MIGRATION_REQUIRED`, estado desconhecido, ledger parcial, drift ou fingerprint divergente recusa. Uma lease adquirida antes de alteração de schema revision/version é invalidada pela revalidação do snapshot; mudança de fence impede execução/commit. Não existe upcast implícito.

## Jobs F9

| Job | Decisão F4 |
| --- | --- |
| `opportunity.duplicate.scan` | código próprio `OPPORTUNITY_DUPLICATE_SCAN_JOB`, módulo worker próprio, `OPERATIONAL`, service actor `F12_DUPLICATE_SCANNER`, write permitido só para candidatos/idempotency/audit; exige F9+F7+F12 read/write+dedupe; F5 `OPPORTUNITY_DUPLICATE_REVIEW`; proibido durante suspensão/offboarding; 5 s por efeito e até 32 candidatos/resultados bounded |
| `opportunity.catalog.reconcile` | código próprio `OPPORTUNITY_CATALOG_RECONCILE_JOB`, módulo worker próprio, `OPERATIONAL`, service actor `F12_CATALOG_RECONCILER`; variante tenant usa F5 `OPPORTUNITY_PRIVATE_UPDATE`, nunca `OPPORTUNITY_CENTRAL_MANAGE`; write apenas de reparação determinística aprovada; mesmas caps e limites; proibido durante suspensão/offboarding |

Ambos são **FUNCTIONAL quanto à taxonomia F9**, porque podem alterar estado funcional F12; `workloadClass='OPERATIONAL'` é apenas a classe de capacidade do pool F4 e não transforma o job em manutenção sem autorização. Não reutilizam adapter humano: isso impediria distinguir actor, workload, envelope/deadline, fencing e auditoria. O handler é interno e o caller não escolhe job module/repository/permission.

## Binding F11↔F12

- F4: `OPPORTUNITY_DOCUMENT_BIND`.
- F5 primária F12: `OPPORTUNITY_PRIVATE_UPDATE`; autorização adicional obrigatória F11: `DOCUMENT_READ` sobre metadata carregada internamente.
- Módulos: owner `F12_DOCUMENT_BINDING`; query module singleton `F12_DOCUMENT_BIND_QUERY`.
- `WRITE/FUNCTIONAL`, schema exclusivamente `004`, compatibility exclusivamente `COMPATIBLE`.
- Capabilities: `F11_PRIVATE_DOCUMENT_STORAGE`, `F12_PRIVATE_CATALOG_READ`, `F12_PRIVATE_CATALOG_WRITE`, `F7_AUDIT_LEDGER`.
- Estados F11 aceites: `AVAILABLE` e scan `CLEAN`; quarentena, pendente, rejeitado, arquivado, eliminado lógico ou metadata obsoleta recusam.
- F12: apenas oportunidade privada tenant-local e não `ARCHIVED`. Oportunidade Central não resolve F4 e é recusada antes de qualquer binding.
- A transaction source-local pertence ao módulo de binding/repository tenant e inclui associação idempotente e evento crítico `OPPORTUNITY_PROVENANCE_LINKED` no mesmo client. Não elimina documento ao arquivar a oportunidade.
- Limites: um documento por comando, input ≤32 KiB, resultado ≤1 MiB, 5 s/deadline de lease.
- A/B: o contexto F3 escolhe o tenant; RLS, resource reload e document organization devem coincidir. ID válido de B em A resulta em not-found sanitizado.
- Se F11 ou F12 estiver incompatível/capability ausente, resolver recusa antes da query; não existe fallback Central, filesystem ou provider.

## Alternativas comparadas

| Critério | 1. Um F4 por F5 tenant | 2. Por adapter técnico | 3. Híbrida recomendada |
| --- | --- | --- | --- |
| least privilege | insuficiente para separar get/list e humano/job | forte, mas pode fragmentar demais | forte nos boundaries com risco real |
| auditabilidade/reautorização | mistura canais sob o mesmo código | máxima | máxima para humano/job/binding |
| estabilidade | acopla F4 à evolução funcional F5 | acopla a detalhes internos | estável por caso de uso e boundary |
| cardinalidade | baixa | potencialmente alta | 10 entradas justificadas |
| risco de bypass | jobs podem reutilizar adapter humano | baixo | baixo; jobs e binding próprios |
| compatibilidade/testes | matriz ambígua por query | clara, mas verbosa | clara por transação e schema |
| evolução futura | difícil separar workloads | flexível demais | permite acrescentar só novos boundaries aprovados |

A alternativa 3 preserva a relação explícita com F5 sem assumir equivalência 1:1, distingue get/list, isola actors/jobs e torna o binding documental verificável sem criar códigos por cada função SQL/repository helper.

## Validação obrigatória

### Startup e catálogo

- catálogo/entrada/arrays/módulos mutáveis; código duplicado; campo extra; access/workload/state desconhecido;
- módulo falsificado ou objeto diferente com o mesmo código; adapter não congelado; caller a fornecer operation/module;
- `requiredPermission` inexistente, divergente do F5 operation catalog ou com effect incompatível com `accessMode`;
- capability ausente/falsa, versão desconhecida, fingerprint/ledger drift; startup atómico sem catálogo parcialmente publicado.

### Runtime/compatibilidade

- cada operação em schema `003` é recusada antes de credencial/pool/SQL; cada operação válida em `004/COMPATIBLE` segue a matriz;
- `READ_ONLY` recusa todas as entradas F12; write sob transaction read-only falha e faz rollback;
- read usa transação read-only também em `COMPATIBLE`; write usa read-write, statement timeout e rollback;
- lease obsoleta, schema revision alterada ou fence antiga não executa/não confirma commit;
- limites de input/page/rows/bytes/timeout/deadline aplicados em ambos os modos.

### Actor, autoridade e integrações

- actor humano recusado nos jobs; service actor recusado nas operações humanas salvo contrato explícito de read;
- tenant A/B, UUID válido cruzado e context/resource mismatch;
- suspensão/offboarding bloqueiam request/job; revogação F5 observada no próximo pedido/attempt;
- binding sem qualquer uma das capabilities, sem `DOCUMENT_READ`, documento B ou estado inválido;
- job testado pelo pipeline F9, nunca chamada direta ao handler; zero fallback Central/tenant.

## Impacto de implementação após aprovação

### F4

- alterar `tenantMigrationManifest.js`, `tenantMigrationPreflight.js`, `tenantSchemaObservationPublisher.js`, `tenantOperationCatalog.js`, `tenantLeaseExecutor.js` e composição do runtime;
- adicionar factory produtiva F12 e 10 query modules/adapters singleton congelados, sem exportar seleção livre ao caller;
- validar atomicamente catálogo F4↔F5, manifests/capabilities e identity dos módulos.

### F5

- não criar permissions nem grants;
- validar o bridge `requiredPermission`→operation F5 e effect; manter autorização/resource loading nos application services;
- corrigir o mapping tenant do reconciler para `OPPORTUNITY_PRIVATE_UPDATE`; Central permanece `OPPORTUNITY_CENTRAL_MANAGE` sem F4.

### F9

- os dois handlers escolhem internamente os adapters job próprios; resolution F4 ocorre depois de envelope/actor/target/reautorização e antes do efeito;
- deadline/fence/heartbeat/cancel/replay permanecem F9; lease/pool/schema são F4.

### F11/F12

- binding usa adapter próprio e transação tenant local;
- repositories deixam de abrir transações independentes quando recebem o client F4 já transacional; continuam sem aceitar client/repository do caller;
- Central services/repositories não importam nem resolvem adapters F4.

### Módulos novos ou alterados previstos

- alterados: os seis módulos F4 acima, composition root F12, `opportunities/applicationService.js`, `jobs.js`, `documentBinding.js` e boundary transacional dos repositories;
- novos: `opportunities/tenantOperationCatalog.js`, `opportunities/tenantOperationSchemas.js`, `opportunities/tenantQueryModules.js` (ou nomes equivalentes alinhados com o padrão real), mantendo os 10 singleton modules descritos;
- testes: catálogo/bridge/startup, executor write, manifest/preflight 000–004, 10 adapters, F5 real, F9 pipeline, F11 binding e gate PG17 A/B.

## Riscos e decisões fora do âmbito

- O campo `requiredPermission` tem nome enganador; esta pesquisa recomenda semântica de operation code F5 para evitar quebrar o schema. Uma renomeação futura exige decisão própria.
- A permissão `opportunity.duplicate.review` é sensível e foi aprovada para decisão humana; usá-la no scanner service actor exige política F5 explícita e restrita. Não cria grant produtivo por si só.
- O reconciler tenant necessita corrigir o mapping atual Central-only. Esta é uma consequência da autoridade source-local, não uma nova permission.
- Não se decide rollout N-1 futuro, provisioning F4.4/F4.5, SLO/sizing, connectors/imports, matching, candidaturas/reporting, R2/scanner real, UI, dados reais ou deploy.
- Não se autoriza `READ_ONLY` F12 em `004` nesta versão. Uma futura leitura durante rollout precisa de nova matriz/catálogo e prova de compatibilidade.

## Scan de decisões ocultas

Não é necessário decidir nomes de schema/tabelas, novos estados, novos eventos, novas permissions, grants, thresholds ou providers. As únicas escolhas materiais desta pesquisa são os 10 códigos F4, seis capabilities novas cumulativas, compatibilidade apenas com `004/COMPATIBLE`, semântica bridge de `requiredPermission`, transação read-write obrigatória e mapping tenant do reconciler. Todas estão enumeradas no bloco de aprovação.

## Texto exato proposto para `context/current-work.md`

> **Matriz F4/F12 aprovada:** adotar `f12-tenant-operations-v1` com 10 operações tenant fechadas (`OPPORTUNITY_PRIVATE_CREATE`, `OPPORTUNITY_PRIVATE_GET`, `OPPORTUNITY_PRIVATE_LIST`, `OPPORTUNITY_PRIVATE_UPDATE`, `OPPORTUNITY_PRIVATE_ARCHIVE`, `OPPORTUNITY_PRIVATE_RESTORE`, `OPPORTUNITY_DUPLICATE_REVIEW`, `OPPORTUNITY_DUPLICATE_SCAN_JOB`, `OPPORTUNITY_CATALOG_RECONCILE_JOB`, `OPPORTUNITY_DOCUMENT_BIND`), exclusivamente para schema `004_f12_opportunity_catalog` em `COMPATIBLE`; integrar cumulativamente manifests/preflight/capabilities 000–004; evoluir o executor F4 para transações read-write/read-only explícitas, limites e bridge obrigatório ao F5; publicar `F9_ASYNC_EXECUTION`, `F7_AUDIT_LEDGER`, `F11_PRIVATE_DOCUMENT_STORAGE`, `F12_PRIVATE_CATALOG_READ`, `F12_PRIVATE_CATALOG_WRITE` e `F12_DEDUPLICATION`; manter caminhos Central fora do F4, zero grants implícitos e nenhuma compatibilidade F12 com `003`/`READ_ONLY`.

## Bloco único de aprovação humana

> Aprovo a matriz F4/F12 documentada em `context/research/f12-f4-tenant-operation-matrix.md`: aprovo a alternativa híbrida e o catálogo `f12-tenant-operations-v1` com exatamente 10 operation codes — `OPPORTUNITY_PRIVATE_CREATE`, `OPPORTUNITY_PRIVATE_GET`, `OPPORTUNITY_PRIVATE_LIST`, `OPPORTUNITY_PRIVATE_UPDATE`, `OPPORTUNITY_PRIVATE_ARCHIVE`, `OPPORTUNITY_PRIVATE_RESTORE`, `OPPORTUNITY_DUPLICATE_REVIEW`, `OPPORTUNITY_DUPLICATE_SCAN_JOB`, `OPPORTUNITY_CATALOG_RECONCILE_JOB` e `OPPORTUNITY_DOCUMENT_BIND`; aprovo exatamente as capabilities cumulativas novas `F9_ASYNC_EXECUTION`, `F7_AUDIT_LEDGER`, `F11_PRIVATE_DOCUMENT_STORAGE`, `F12_PRIVATE_CATALOG_READ`, `F12_PRIVATE_CATALOG_WRITE` e `F12_DEDUPLICATION`, preservando `TENANT_CONTROL_BASELINE`; aprovo compatibilidade F12 apenas com `004_f12_opportunity_catalog` em `COMPATIBLE`, sem `003`, N-1 ou `READ_ONLY`; aprovo que `requiredPermission` seja validado como operation code F5, que todos os writes F4 usem transação PostgreSQL read-write explícita e que reads usem read-only, com timeout/limites/fence antes do commit; aprovo `OPPORTUNITY_DUPLICATE_REVIEW` para o scanner service actor restrito e `OPPORTUNITY_PRIVATE_UPDATE` para a variante tenant do reconciler, mantendo `OPPORTUNITY_CENTRAL_MANAGE` apenas na Central; aprovo binding F11↔F12 com `OPPORTUNITY_PRIVATE_UPDATE` e autorização adicional `DOCUMENT_READ`; confirmo que paths Central não entram no catálogo F4, que não são criadas permissions/grants/eventos adicionais e que a implementação só pode retomar após integrar manifest/preflight 000–004 e provar startup/transações/isolamento no gate descartável.

## Referências locais

- `AGENTS.md`
- `context/current-work.md`
- `context/research/f12-opportunity-catalog-decisions.md`
- `context/history/f4-tenant-central-directory.md`
- `context/history/f4-tenant-contract-lifecycle.md`
- `context/history/f4-tenant-runtime-access.md`
- `context/history/f43-tenant-schema-compatibility.md`
- `context/history/f5-functional-authorization.md`
- `context/history/f9-async-execution-foundation.md`
- `context/history/f11-private-document-storage.md`
- `backend/src/security/tenantOperationCatalog.js`
- `backend/src/security/tenantResolver.js`
- `backend/src/security/tenantLeaseExecutor.js`
- `backend/src/security/tenantPoolManager.js`
- `backend/src/security/tenantMigrationManifest.js`
- `backend/src/security/tenantMigrationPreflight.js`
- `backend/src/security/tenantSchemaObservationPublisher.js`
- `backend/database/tenant/migrations/000_tenant_control_baseline.up.sql` a `004_f12_opportunity_catalog.up.sql`
- `backend/src/authorization/catalogs.js`
- `backend/src/opportunities/applicationService.js`, `repositorySupport.js`, `jobs.js`, `documentBinding.js`
- testes F4.0–F4.3, F5, F9, F11 e F12 em `backend/test/`
