# F13-P1 — Revisão humana formal de código e segurança (R2)

## 1. Snapshot

- Data/hora: `2026-10-10T21:51:10+01:00` (`Europe/Lisbon`).
- Branch: `feat/f12-opportunity-catalog`.
- HEAD: `64b657be954548233cc79ce797feab86af92d99d` — `feat(opportunities): complete F12 catalog foundation`.
- Estado da feature: `In Progress`; esta revisão não alterou o estado.
- F13: `Ready — implementation blocked by F13-P1`.
- Worktree: sujo, com alterações F13/F13-P1 e alterações partilhadas F5/F7/F12. A alteração preexistente `.vscode/settings.json` foi explicitamente excluída do âmbito e não foi lida nem alterada.
- Implementação F13-P1 não rastreada: migration `006` up/down, `backend/src/organizationalScopes/`, teste unitário F13-P1 e gate `test/integration/f13p1/`.
- Superfícies partilhadas modificadas e revistas: catálogos F5/F7, manifest/preflight/fingerprint tenant, testes de manifest/workload/audit e integração cumulativa F12.
- Documentação F13/F13-P1 não rastreada foi usada como contrato; não foi alterada.
- Não foram executados testes, PostgreSQL, Docker, gates ou benchmark nesta revisão.
- Evidência anterior declarada em `context/current-work.md`: backend `545/545`, gate F13-P1 PostgreSQL 17 e gate cumulativo F12 verdes. É evidência previamente executada, não independente desta revisão.

## 2. Âmbito e limitações

Foram lidos o contrato F13-P1, readiness audit, decisões de fundação/archive/stable code, arquitetura, standards, contratos F3/F4/F5/F7 relevantes, migrations tenant `000–006`, runner, manifest, preflight, fingerprint, implementação, testes e gates F13-P1/F12 relacionados. A revisão foi exclusivamente estática. Não se afirma comportamento runtime novo.

## 3. Revalidação dos findings corrigidos

### A. Integridade estrutural SQL — `CORRIGIDO`

- `scope_tree_mutation_lock` é `BEFORE INSERT OR UPDATE OR DELETE FOR EACH STATEMENT` e adquire `pg_advisory_xact_lock` pela organização do contexto antes do trigger por row (`006...up.sql:57-69`).
- `guard_scope_mutation` recusa delete, alteração de identidade/tipo/stable code, parent inválido, TEAM com filhos, ciclo e archive com descendente ativo (`006...up.sql:71-115`).
- Create/reparent/archive usam a mesma chave de advisory lock (`repository.js:14-16,54-61,71-91`).
- O gate contém writers SQL diretos para ciclo concorrente e archive leaf-first (`gate.js:123-145,175-187`).
- Não foi encontrado writer funcional alternativo sobre `organizational_scope.scope` fora da migration, repository e probes explícitos.

Risco residual: a validação de drift destas proteções tem lacunas, reportadas separadamente em `F13P1-R2-001`; isso não reabre a implementação estrutural em si.

### B. Integração F5 — `CORRIGIDO`

- As cinco operações entram pelo mesmo `transaction()` e chamam `authorization.authorize()` antes do efeito (`service.js:10-26`).
- O adapter usa o `createAuthorizationService` canónico e liga o resource loader ao mesmo client preparado (`authorization.js:3-16`).
- O loader resolve organização/scope server-side e lê lifecycle sob RLS (`repository.js:43-52`).
- Actor humano, membership/auth versions e assurance são contratos fechados; service actors são recusados (`contracts.js:24-35`).
- Archive é sensível no catálogo e passa pela avaliação canónica de `RECENT_MFA` (`authorization/catalogs.js:133,177`; `authorization/policyEngine.js:39-50`).
- Os eventos de decisão F5 são distintos dos eventos funcionais F7; estes últimos são append source-local no mesmo client (`catalogs.js:174-177`; `repository.js:31-35,61,69,80,91`).
- O gate atual cobre grant ausente, membership suspensa, cross-tenant, MFA ausente/stale/válida e ausência de mutação após deny (`gate.js:165-166,207-226`).
- Não existe callback `authorize: () => allowed` no caminho F13-P1 atual.

Risco residual original: a composição existia apenas no gate, reportada em `F13P1-R2-003`; a reconciliação posterior desse finding está registada abaixo.

## 4. Findings abertos

### F13P1-R2-001 — HIGH — `CORRIGIDO`

**Título:** Startup/fingerprint não protegem policies RLS, `FORCE RLS`, roles nem grants F13-P1.

- Ficheiros/linhas: `backend/src/security/tenantSchemaFingerprint.js:14-21,49-57`; `backend/src/security/tenantMigrationPreflight.js:163-176`.
- AC afetados: F13-P1-AC-02, AC-15, AC-25, AC-29, AC-31.
- Comportamento: o fingerprint inclui shape de tabelas/triggers/funções, mas não inclui `relrowsecurity`, `relforcerowsecurity`, `pg_policy`, ACLs ou membership/atributos das roles F13-P1. O preflight exige apenas duas tabelas com RLS enabled; não valida `FORCE RLS`, expressão exata das policies, owner, grants mínimos nem `rolbypassrls` da role `c4g_organizational_scope_runtime`.
- Caminho alcançável: uma alteração administrativa ou migration divergente pode substituir `scope_isolation` por `USING (true)`, remover `FORCE ROW LEVEL SECURITY`, conceder privilégios adicionais ou tornar a runtime role `BYPASSRLS`. O ledger/checksum permanece igual e o preflight pode continuar a aceitar a instalação.
- Evidência: o snapshot do fingerprint não consulta policies/ACL/RLS flags; `validateFeatureCapabilities()` conta apenas `relrowsecurity` e tabelas. Em contraste, a migration pretende `ENABLE/FORCE RLS` e grants mínimos (`006...up.sql:122-140`).
- Impacto: startup pode servir F13-P1 sobre estado físico que viola isolamento A/B ou mínimo privilégio.
- Correção recomendada: incorporar policies, RLS/FORCE, owners, role attributes/memberships e grants F13-P1 no snapshot/fingerprint e validar contratos exatos no preflight.
- Prova que deve falhar sem correção: mutar isoladamente policy para `USING (true)`, retirar FORCE, conceder DELETE/PUBLIC ou BYPASSRLS à runtime; cada variante deve ser recusada por preflight/startup.

**Reconciliação posterior à revisão (2026-10-10):** o fingerprint passou a representar RLS/FORCE RLS, policies, ownership, roles, memberships e grants F13-P1, e o preflight passou a validar o contrato exato. Probes PostgreSQL recusaram policy `USING (true)`, remoção de FORCE RLS, grant DELETE à runtime e runtime `BYPASSRLS`, restaurando e revalidando o estado após cada mutação. Evidência executada: 18/18 testes focados, gate F13-P1 com `securityDriftDenied: true`, gate cumulativo F12 e suite backend 545/545 verdes. Fingerprint 006 corrente: `29a98501da147ab979043e156e290c7f625dcc442b6da593c1c6ff135bbea70f`. Esta reconciliação não altera o estado dos demais findings nem constitui uma nova revisão humana integral.

### F13P1-R2-002 — HIGH — `CORRIGIDO`

**Título:** Falha de rollback devolve ao pool um client potencialmente contaminado.

- Ficheiro/linha: `backend/src/organizationalScopes/service.js:19`.
- AC afetados: F13-P1-AC-02, AC-15, AC-20, AC-31.
- Comportamento: o catch ignora qualquer erro de `ROLLBACK` e o `finally` chama sempre `client.release()` sem argumento. Também perde a falha de cleanup e não descarta a ligação.
- Caminho alcançável: depois de `BEGIN`, `SET LOCAL ROLE` e `set_config(app.organization_id, ..., true)`, uma falha funcional seguida de falha de rollback devolve a ligação ao pool ainda em transação/estado incerto. A próxima aquisição pode herdar role/contexto ou uma sessão abortada.
- Evidência: o runner tenant já usa o padrão seguro oposto, agregando rollback failure e chamando `client.release(error)` (`tenantMigrationRunner.js:192-205`). Não existe teste F13-P1 de rollback failure/client discard.
- Impacto: contaminação cross-request, falhas persistentes e risco de contexto tenant incorreto numa ligação reutilizada.
- Correção recomendada: preservar erro primário e cleanup, descartar o client quando rollback falha, impedir double release e testar BEGIN/COMMIT/ROLLBACK/release failures.
- Prova que deve falhar sem correção: client fake/preparado em que o efeito falha e `ROLLBACK` falha; exigir `release(error)` uma única vez, erro agregado sanitizado e impossibilidade de reutilização.

**Reconciliação posterior à revisão (2026-10-10):** o transaction wrapper preserva agora o erro primário sanitizado, agrega falhas sanitizadas de rollback/release e descarta uma única vez a ligação quando o estado é incerto. Duas regressões provam (a) falha funcional + rollback falhado com `release(error)` único e (b) rollback + release falhados sem segunda libertação nem exposição dos canários. Evidência executada: testes F13-P1 9/9, gate PostgreSQL F13-P1 e suite backend 547/547 verdes, além de `node --check` e `git diff --check`. Esta reconciliação não altera o estado dos demais findings nem constitui uma nova revisão humana integral.

### F13P1-R2-003 — HIGH — `CORRIGIDO`

**Título:** A composição produtiva não instala a fundação F13-P1 nem as cinco operações.

- Ficheiros/linhas: `backend/src/organizationalScopes/tenantOperations.js:15-21`; `backend/src/server.js:6-12`; `backend/src/app.js:62-75`.
- AC afetados: F13-P1-AC-17, AC-18, AC-20, AC-29, AC-32.
- Comportamento: factories de repository/service/F5/tenant operations existem, mas só são compostas em `test/integration/f13p1/gate.js:49-73`. Não há import/registro em `productionComposition`, server, app, router ou catálogo tenant produtivo.
- Caminho alcançável: ao iniciar a aplicação atual, nenhuma operação funcional consegue chegar à fundação; startup também não valida a coerência conjunta de catalogs, participant registry e capability para esta feature.
- Evidência: `rg` encontra `createOrganizationalScopeService`, `createOrganizationalScopeAuthorization` e `createF13P1TenantOperations` apenas no próprio módulo, teste unitário e gate. O app monta apenas as rotas legacy existentes.
- Impacto: a implementação demonstrada é um harness isolado, não uma capacidade utilizável pelo produto; as garantias F5/loader não existem num boundary de aplicação real.
- Correção recomendada: compor os módulos no boundary tenant aprovado, registrar as cinco operações constantes no catálogo/runtime e adicionar startup validation. Não é necessário inventar UI; a superfície pode permanecer application-service/port se esse for o boundary aprovado.
- Prova que deve falhar sem correção: teste de composição produtiva que resolve as cinco operações através do catálogo real, prova deny antes do efeito e falha startup perante catalog/capability/participant divergente.

**Reconciliação posterior à revisão (2026-10-10):** a composição produtiva importa agora o módulo F13-P1, valida o catálogo cumulativo de 27 operações, expõe um binder tenant interno e compõe repository, F5/resource loader, F7, participant registry, serviço e cinco operações. Os handlers reutilizam um prepared client e não criam transação paralela; nenhuma rota/UI foi adicionada. Provas executadas: 46/46 testes focados, incluindo resolução das cinco operações, deny antes do efeito e startup fail-closed para catálogo stale/registry não registado; gates PostgreSQL F13-P1 e F12 cumulativo; suite backend 549/549; `node --check` e `git diff --check`. Esta reconciliação não altera o estado dos demais findings nem constitui nova revisão humana integral.

### F13P1-R2-004 — MEDIUM — `CORRIGIDO`

**Título:** Serialization/deadlock não é repetido com a mesma intenção.

- Ficheiros/linhas: `backend/src/organizationalScopes/service.js:10-19`; `backend/src/organizationalScopes/errors.js:23-27`.
- AC afetados: F13-P1-AC-08, AC-12, AC-14.
- Comportamento: SQLSTATE `40001`/`40P01` é apenas mapeado para `STATE_CONFLICT`; não existe retry bounded que preserve command, idempotency key e intention digest.
- Caminho alcançável: create/reparent/archive concorrentes usam advisory e row locks; deadlock/serialization failure transitório termina o comando apesar do contrato aprovado exigir retry com a mesma intenção.
- Evidência: nenhuma função de retry existe no módulo; os testes de concorrência aceitam um rejected, mas não injetam 40001/40P01 nem demonstram convergência após retry.
- Impacto: operações estruturalmente válidas falham de forma transitória e o contrato de convergência concorrente não é cumprido.
- Correção recomendada: retry interno limitado apenas para SQLSTATE aprovados, com nova transação/client limpo e exatamente o mesmo comando/key/digest; não repetir erros funcionais.
- Prova que deve falhar sem correção: primeira tentativa retorna 40001 ou 40P01, segunda converge; key/digest permanecem idênticos e F7/effect aparecem uma só vez.

**Reconciliação posterior à revisão (2026-10-10):** o serviço standalone limita agora cada comando a três tentativas e repete exclusivamente `40001`/`40P01`, sempre com nova ligação/transação e o mesmo objeto de comando. Retry só ocorre depois de rollback e release seguros; incerteza de cleanup conserva o agregado sanitizado e impede repetição. As regressões cobrem ambos os SQLSTATE, igualdade da intenção, convergência, esgotamento e rollback falhado. Evidência executada: testes F13-P1 15/15, gate PostgreSQL F13-P1 e suite backend 553/553 verdes, além de `node --check` e `git diff --check`. Esta reconciliação não altera os findings R2-005/R2-006 nem constitui nova revisão humana integral.

### F13P1-R2-005 — MEDIUM — `CORRIGIDO`

**Título:** Intention digest depende da ordem de propriedades JavaScript.

- Ficheiro/linha: `backend/src/organizationalScopes/repository.js:6,54-55,63-64,71-72,82-83`.
- AC afetados: F13-P1-AC-14.
- Comportamento: `digest()` usa `JSON.stringify()` diretamente. Actor e provenance são validados por conjunto de chaves, mas o contrato não fixa a ordem de inserção das propriedades.
- Caminho alcançável: duas entregas semanticamente idênticas com a mesma idempotency key e propriedades actor/provenance inseridas em ordem diferente produzem digests diferentes; a segunda é recusada como intenção divergente.
- Evidência: o projeto já possui canonicalizadores que ordenam chaves (`audit/canonicalJson.js` e `security/tenantRepositorySupport.js`), mas o repository F13-P1 não os usa. Os testes só repetem a mesma instância/ordem.
- Impacto: false conflict em retries/reconciliação e perda de idempotência sem alteração semântica.
- Correção recomendada: usar canonicalização fechada e estável antes de SHA-256, validando round-trip e tipos permitidos.
- Prova que deve falhar sem correção: dois comandos semanticamente iguais, com nested key order diferente, devem produzir o mesmo digest e replay; alteração material deve continuar a conflitar.

**Reconciliação posterior à revisão (2026-10-10):** o repository F13-P1 reutiliza agora `intentDigest`/`canonicalize` do tenant directory, eliminando dependência da ordem das propriedades e preservando distinção de tipos e recusa de valores fora do domínio canónico. A regressão unitária cobre ordens nested diferentes, mudança de tipo e `undefined`; o gate PostgreSQL repete uma criação com a mesma key e actor/provenance reordenados, obtém o mesmo scope e prova um único evento funcional. Evidência executada: testes F13-P1 16/16, gate PostgreSQL F13-P1 com `canonicalIdempotency: true` e suite backend 554/554 verdes, além de `node --check` e `git diff --check`. Esta reconciliação não altera o finding R2-006 nem constitui nova revisão humana integral.

### F13P1-R2-006 — MEDIUM — `CORRIGIDO`

**Título:** Participant registry confia numa lista de capabilities fornecida pela composição.

- Ficheiro/linhas: `backend/src/organizationalScopes/participantRegistry.js:4-16`.
- AC afetados: F13-P1-AC-22, AC-23, AC-29.
- Comportamento: o registry decide se F13 está instalada apenas pela array `capabilities` recebida no construtor. Não liga essa decisão ao preflight/manifest persistido nem a uma release tuple; omitir a capability torna o participant `NOT_APPLICABLE`.
- Caminho alcançável: numa instalação futura com capability F13 persistida, uma composição stale ou incorreta pode construir o registry com `[]`; archive prossegue sem desativar o overlay.
- Evidência: o gate fornece a capability manualmente (`gate.js:194`); não existe composição produtiva/startup que compare registry com as capabilities observadas.
- Impacto: quando F13 for instalada, scope e overlay podem divergir, violando atomicidade aprovada.
- Correção recomendada: construir/validar o registry a partir das capabilities verificadas e da compatibility tuple, recusando startup/operação quando capability e participant não coincidirem.
- Prova que deve falhar sem correção: capability F13 persistida + registry vazio deve falhar startup e archive antes de qualquer efeito; capability ausente deve continuar legitimamente sem participant.

**Reconciliação posterior à revisão (2026-10-10):** o preflight tenant produz agora evidência internamente marcada e compatível apenas com uma tuple exata do manifest canónico. A composição produtiva exige essa evidência, valida tenant/capability/write-version e constrói internamente o registry; deixou de aceitar lista de capabilities ou registry do caller. Participant e capability divergentes falham durante o binding. O double que simula a integração F13 futura passou a fixture explícita e não é aceite no caminho produtivo. Evidência executada: 23/23 testes focados, gate PostgreSQL F13-P1 com `verifiedCapabilityEvidence: true`, gate cumulativo F12 e suite backend 554/554 verdes, além de `node --check` e `git diff --check`. Esta reconciliação encerra o ledger de findings conhecido, mas não substitui uma nova revisão humana formal.

## 5. Observações sem finding

- Migration 006 não contém `BEGIN/COMMIT/ROLLBACK` e permanece sob o runner.
- Stable code tem grammar equivalente em JS/SQL, collation `C`, índice org-wide incluindo archived, múltiplos NULL e trigger de imutabilidade.
- FK composta, trigger e RLS impedem parent cross-organization; TEAM não pode ser parent; self-parent/cycle são recusados.
- Archive é leaf-first, sem cascade/delete/restore, e o participant/F7 usam o mesmo client dentro da transação do repository.
- Queries do repository são parametrizadas; o único identifier interpolado pelo service é uma role validada por grammar fechada e fornecida pela composição.
- F7 funcional não inclui label/stable code/árvore/PII; F10 usa apenas operação e result class fechados.
- Migration/gate não importam schema F13 nem fazem mapping UBI/legacy.
- O gate usa targets locais sintéticos e cleanup em `finally`; nenhum secret, endpoint real ou tenant real foi encontrado no âmbito.
- O down é conservador perante dados funcionais; eventos F7 existentes também impediriam a contração das constraints, em vez de serem apagados silenciosamente.

## 6. Matriz F13-P1-AC-01–33

| AC | Estado | Implementação/evidência inspecionada | Finding | Risco residual |
|---|---|---|---|---|
| AC-01 | PASS | Schema 006 contém apenas UNIT/TEAM tenant-local. | — | nenhum local |
| AC-02 | FAIL | organization_id/RLS existem, mas drift e cleanup de ligação não estão fechados. | R2-001, R2-002 | isolamento pode degradar |
| AC-03 | PASS | UUID PK e campos identitários imutáveis por trigger. | — | nenhum local |
| AC-04 | PASS | Grammar JS/SQL, C collation, unique org-wide e imutabilidade. | — | runtime anterior, não reexecutado |
| AC-05 | PASS | Rename altera apenas label com CAS; stable code protegido. | — | NFC só no boundary JS |
| AC-06 | PASS | Tipo/parent matrix e TEAM leaf protegidos no SQL. | — | nenhum local |
| AC-07 | PASS | Self, cycle e cross-organization recusados; prova direta presente. | — | runtime anterior |
| AC-08 | FAIL | Locks/cycle guard existem; retry de 40001/40P01 falta. | R2-004 | falha transitória não converge |
| AC-09 | PASS | Scopes exatos; catálogo F13-P1 não usa UNIT_SUBTREE. | — | nenhum local |
| AC-10 | PASS | ACTIVE→ARCHIVED terminal; delete/restore recusados. | — | nenhum local |
| AC-11 | PASS | Loader distingue histórico de operacional; archived recusa mutação. | — | grants futuros dependem da composição |
| AC-12 | PASS | Leaf-first profundo e serialização estão no SQL/repository e probes. | — | retry coberto em AC-08 |
| AC-13 | PASS | Revision positiva, +1 trigger e expected revision nas mutações. | — | nenhum local |
| AC-14 | FAIL | Persistência idempotente existe, mas digest não é canónico e retry falta. | R2-004, R2-005 | false conflict/transient failure |
| AC-15 | FAIL | ENABLE/FORCE/RLS existem; preflight e cleanup não asseguram o contrato corrente. | R2-001, R2-002 | isolamento fail-open após drift/cleanup |
| AC-16 | PASS | Loader/RLS e erro público uniforme escondem cross-tenant/not-found. | — | timing produtivo fora do âmbito |
| AC-17 | FAIL | Catálogos fechados existem, mas não estão instalados na composição produtiva. | R2-003 | capacidade inacessível |
| AC-18 | FAIL | Loader está correto no harness, sem boundary produtivo instalado. | R2-003 | não exercido pela aplicação |
| AC-19 | PASS | Quatro eventos F7 são append no mesmo client antes do commit. | — | runtime anterior |
| AC-20 | FAIL | Deny/F7 rollback estão cobertos; cleanup failure e composição produtiva faltam. | R2-002, R2-003 | efeito/ligação não fechados em falha |
| AC-21 | PASS | Sem FK/import/query F13 na migration ou repository. | — | nenhum local |
| AC-22 | FAIL | Registry recusa mismatch apenas contra array fornecida pelo caller interno. | R2-006 | capability instalada pode ser omitida |
| AC-23 | FAIL | Mesmo client e rollback estão provados por fixture; ligação à capability real não está fechada. | R2-006 | futura divergência scope/overlay |
| AC-24 | PASS | Ordinal 006, manifest e ausência de transaction control confirmados. | — | nenhum local |
| AC-25 | FAIL | Checksum/fingerprint existem, mas não representam integralmente security state. | R2-001 | drift aceito |
| AC-26 | PASS | Gate cumulativo contém vazio/003/004/005→006 via runner; resultado é evidência anterior. | — | não reexecutado |
| AC-27 | PASS | Runner implementa rollback/reconcile/retry e gate contém fault injection. | — | não cobre retry funcional AC-08 |
| AC-28 | UNVERIFIED | Read 005/006 e write 006 estão declarados; não há prova independente nesta revisão. | — | tuple física simplificada |
| AC-29 | FAIL | Startup não valida security state F13-P1 nem participant contra capability real. | R2-001, R2-003, R2-006 | incompatibilidade pode servir |
| AC-30 | PASS | Guards/migration não contêm mapping UBI/legacy. | — | nenhum local |
| AC-31 | UNVERIFIED | Gate inspecionado cobre PG17/hierarchy/RLS/cleanup; não foi executado nesta revisão. | R2-001, R2-002 | gaps não exercitados |
| AC-32 | UNVERIFIED | Suite 545/545 e gates estão registados, mas não foram reexecutados; composição produtiva falta. | R2-003 | regressão não verificada independentemente |
| AC-33 | PASS | Gate mede baseline local e não define SLO. | — | amostra pequena declarada |

Resumo: **19 PASS, 11 FAIL, 3 UNVERIFIED**.

## 7. Avaliação da evidência previamente executada

- Os resultados `545/545`, gate F13-P1 e gate F12 são coerentes com os comandos/testes inspecionados e não há skips/TODO visíveis na evidência registada.
- O gate F13-P1 usa migration runner canónico, runtime role, RLS, SQL direto, concurrency, participant/F7 failures e cleanup.
- A evidência original não cobria mutation probes de policy/FORCE/ACL/feature roles, rollback failure/client discard, retry 40001/40P01, property-order do digest, composição produtiva ou capability persistida versus registry. As reconciliações posteriores registam provas executadas para R2-001 a R2-006.
- Por restrição desta revisão, nenhum resultado foi reproduzido independentemente.

## 8. Riscos residuais

- A principal exposição é aceitar startup após drift de isolamento/privilege, seguida do risco de reutilizar ligação contaminada após rollback failure.
- A ausência de composição produtiva significa que a capacidade ainda não está realmente disponível no produto, apesar do harness completo.
- O ledger R2 não conserva riscos materiais locais conhecidos; a confirmação independente pertence à nova revisão humana.
- Provisioning/rollout produtivo continuam corretamente fora do âmbito e não contam como finding.

## 9. Veredicto

`Needs changes — material findings`

As correções de integridade SQL, integração F5 e `F13P1-R2-001` a `F13P1-R2-006` estão registadas. O veredicto original permanece histórico até nova revisão humana; F13-P1 pode regressar a `Review`, mas não está fechada. F13 permanece bloqueada.

## 10. Ledger resumido

| ID | Severidade | Estado | Título |
|---|---|---|---|
| F13P1-R2-001 | HIGH | CORRIGIDO | Startup/fingerprint não protegem policies RLS, FORCE RLS, roles nem grants F13-P1 |
| F13P1-R2-002 | HIGH | CORRIGIDO | Falha de rollback devolve ao pool um client potencialmente contaminado |
| F13P1-R2-003 | HIGH | CORRIGIDO | A composição produtiva não instala a fundação F13-P1 nem as cinco operações |
| F13P1-R2-004 | MEDIUM | CORRIGIDO | Serialization/deadlock não é repetido com a mesma intenção |
| F13P1-R2-005 | MEDIUM | CORRIGIDO | Intention digest depende da ordem de propriedades JavaScript |
| F13P1-R2-006 | MEDIUM | CORRIGIDO | Participant registry confia numa lista de capabilities fornecida pela composição |

Next step: realizar uma nova revisão humana formal e read-only da F13-P1 sobre o snapshot corrigido.
