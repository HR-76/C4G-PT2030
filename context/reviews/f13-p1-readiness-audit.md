# F13-P1 — Readiness audit final

- **Data do snapshot:** 2026-10-10
- **Âmbito:** especificação e plano documental da fundação tenant-local de Units e Teams
- **Modo:** revisão documental; aplicação, migrations, testes e infraestrutura read-only
- **Veredicto:** `READY — approved for implementation`
- **Estado recomendado:** `Ready`
- **Evidência runtime nesta revisão:** nenhuma; não foram executados testes, PostgreSQL, containers ou benchmark

## Resumo executivo

Não permanece qualquer item `BLOCKING FOR READY`. As duas decisões que alteravam schema, concorrência e comportamento — archive com descendentes e `stable_code` — estão aprovadas e reconciliadas com os 33 acceptance criteria. A migration tenant 006, o boundary transacional, F5/F7, o upgrade 000–005→006 e o participante F13 futuro são planeáveis sem nova escolha de produto ou arquitetura.

A promoção para `Ready` autoriza iniciar implementação apenas mediante ação explícita. Não marca qualquer AC como `PASS`, não conclui a prerequisite e não desbloqueia a implementação F13. F13 continua `Ready — implementation blocked by F13-P1`.

## Snapshot revisto

- `AGENTS.md`, `context/project-overview.md`, `context/architecture.md` e `context/coding-standards.md`.
- `context/current-work.md` e `context/features/f13-p1-organizational-scope-foundation.md`.
- `context/decisions/organizational-scope-foundation.md`.
- `context/decisions/f13-p1-organizational-scope-archive.md`.
- `context/decisions/f13-p1-stable-code.md`.
- Readiness e decisões F13 aplicáveis a scope, lifecycle, autorização e N/N-1.
- Históricos/contratos F3, F4, F5 e F7.
- `backend/src/security/tenantMigrationManifest.js`, `tenantMigrationRunner.js`, `tenantMigrationPreflight.js`, `tenantSchemaFingerprint.js`, `tenantOperationCatalog.js`, runtime/leases, catálogos F5 e F7.
- Migrations tenant `000`–`005` e testes existentes de manifest, runner, preflight, autorização e audit.

## Findings

### BLOCKING FOR READY

Nenhum.

### IMPLEMENTATION DETAIL

1. **Nomes físicos:** nomes finais de schema, tabelas, constraints, índices, functions/triggers e capability da migration 006. Devem seguir os padrões existentes e entrar em manifest, fingerprint e postflight; não alteram o contrato aprovado.
2. **Catálogos concretos:** confirmar os identificadores finais das cinco operations/permissions e quatro eventos F7 ao materializar os catálogos. A semântica, resources, scopes, sensitivity e eventos já estão determinados.
3. **Erros:** fixar os códigos internos/públicos finais dentro das categorias sanitizadas já especificadas.
4. **Idempotência física:** escolher tabela dedicada ou padrão repository reutilizável, preservando key+intent digest, replay exato e commit-uncertain reconciliation.
5. **Advisory lock:** derivar a chave tenant-bound/collision-safe segundo o padrão de implementação e documentar o algoritmo; o domínio do lock, ordem e transação já estão decididos.
6. **Benchmark:** escolher corpus e thresholds apenas para detetar regressões locais; não criar SLO.
7. **Campos de provenance/F7:** fechar shapes allowlisted e versões concretas sem labels, stable codes, PII ou topologia.

### DEFERRED OUT OF SCOPE

- Implementação concreta do participante F13 e das tabelas de overlay; a registry/capability boundary já permite evolução aditiva.
- Memberships de pessoas, cargos, reporting lines, `UNIT_SUBTREE`, UI, organograma e imports/mappings UBI.
- Provisioning, adapters produtivos, rollout, staging/produção e parâmetros de capacidade produtiva.
- Restore, delete físico e cascade archive.

### EDITORIAL

- `ORGANIZATIONAL_SCOPE_RENAME` designa exclusivamente rename do label. Não existe rename nem late assignment de `stable_code`; a especificação foi clarificada para evitar colisão terminológica.

## Verificações obrigatórias

| # | Verificação | Resultado e evidência | Classificação |
|---:|---|---|---|
| 1 | Objetivo/fronteiras inequívocos | Autoridade tenant-local de `UNIT|TEAM`; perfis, matching, pessoas e produção estão fora. | Satisfeita |
| 2 | Central/F3 única autoridade de organizações | A fundação apenas referencia `organization_id` validado; não cria Organization. | Satisfeita |
| 3 | Apenas Units e Teams | Tipos fechados `UNIT|TEAM`; Organization é raiz conceptual. | Satisfeita |
| 4 | Pessoas fora | Memberships, cargos, RH e reporting lines estão explicitamente excluídos. | Satisfeita |
| 5 | Sem F13 prematura | Migration 006 não referencia tabelas F13; integração futura usa participant capability-gated. | Satisfeita |
| 6 | Sem scope/herança implícita | Scopes exatos; sem `UNIT_SUBTREE`, permission inheritance, profile inheritance ou Team→Unit implícito. | Satisfeita |
| 7 | Modelo definido | UUID, organização, tipo, parent, lifecycle, revision, provenance e metadata de archive estão fechados. | Satisfeita |
| 8 | Parent Unit/Team completo | Unit→Organization/Unit; Team→Organization/Unit; Team não tem children. | Satisfeita |
| 9 | Árvore/ciclos testáveis | Same-organization FK, self/cycle checks, recursive CTE e serialização por organização possuem probes previstos. | Satisfeita |
| 10 | Stable code fechado | Grammar, limite, ausência de transformação, bytewise `C`, namespace e lifecycle aprovados em 97 cláusulas. | Satisfeita |
| 11 | Imutabilidade SQL planeável | CHECK/index mais proteção estrutural contra update, remoção e `NULL→valor`; runtime sem SQL administrativo. | Satisfeita |
| 12 | Uniqueness cobre archived/tipos | `(organization_id, stable_code)` abrange Unit/Team, parents e lifecycle; `NULL` múltiplo permitido. | Satisfeita |
| 13 | Leaf-first coerente | Archive altera apenas a row alvo após provar ausência de qualquer descendant ativo; não exige cascade schema. | Satisfeita |
| 14 | Sem delete/restore | Lifecycle apenas `ACTIVE→ARCHIVED`, terminal e com história preservada. | Satisfeita |
| 15 | Ordem de locks | Advisory transaction lock por organização precede row locks canónicos em create/reparent/archive. | Satisfeita |
| 16 | Phantoms/ciclos | O mesmo lock estrutural, row locks e recursive CTE na transação impedem child/reparent após verificação. | Satisfeita |
| 17 | CAS/idempotência | Expected revision e key+intent digest existem por mutação; replay divergente é conflito. | Satisfeita |
| 18 | Commit incerto/retry | Estado/intenção persistidos reconciliam; runner existente demonstra o padrão de reconciliação. | Satisfeita |
| 19 | F7 source-local | Evento crítico e mutação usam o mesmo client/transação; falha F7 reverte efeito. | Satisfeita |
| 20 | Participant mesmo client | Contrato proíbe ligação/transação independente ou injeção HTTP. | Satisfeita |
| 21 | Capability ausente/incompatível | Ausência é legítima antes de F13; capability declarada exige participant compatível e falha fechado. | Satisfeita |
| 22 | Atomicidade scope/overlay/audit | Participant desativa overlay antes do commit; qualquer falha reverte scope, pointer e F7. | Satisfeita |
| 23 | F5 determinável | Read/create/label-rename/reparent/archive, permissions e resources exatos estão enumerados; IDs finais são detalhe. | IMPLEMENTATION DETAIL |
| 24 | Loaders server-side | Organization, type, lifecycle, revision e parent são obtidos do repository; caller não os afirma. | Satisfeita |
| 25 | RLS/IDOR/A-B | RLS por `app.organization_id`, ausência de contexto fail-closed e matriz A/B estão exigidas por AC-15/16. | Satisfeita |
| 26 | Assurance/reason | Archive exige `RECENT_MFA` e reason fechado; outras operações seguem sensitivity F5 explícita no catálogo. | Satisfeita |
| 27 | Human/service actors | Archive sensível requer assurance humana; service actors só entram por operation catalog explícito e não possuem grant implícito. | Satisfeita |
| 28 | Erros sem enumeração | Not-found/forbidden/collision/descendants são uniformes e não devolvem IDs, counts, paths ou stable code. | Satisfeita |
| 29 | Logs/F7/F10 | Payloads allowlisted e telemetry sem labels/topologia/código; identifiers internos mínimos. | Satisfeita |
| 30 | Sem `UNIT_SUBTREE` | Exclusão normativa, catalog guard e AC-09. | Satisfeita |
| 31 | Migration 006 aditiva | Nova autoridade tenant-local e objetos próprios; não altera legacy nem requer F13. | Satisfeita |
| 32 | Manifest/fingerprint/capabilities | Manifest cumulativo, checksum, resulting fingerprint, preflight/postflight e capability estão no plano. | Satisfeita |
| 33 | Upgrade 000–005 | Runner calcula migrations requeridas e o plano prova empty→006 e 005→006. | Satisfeita |
| 34 | SQL→ledger/commit incerto | Runner atual executa SQL, fingerprint e ledger na mesma transação e reconcilia commit incerto. | Satisfeita |
| 35 | N/N-1 | Tuples exatas, writer N, readers declarados e drift fail-closed; forma física é detalhe. | Satisfeita |
| 36 | Sem dependência F13 | Capability vazia antes de F13 é válida; migration histórica não é alterada. | Satisfeita |
| 37 | Participant futuro aditivo | F13 adiciona schema, FK/capability/participant em migration futura, sem editar 006. | Satisfeita |
| 38 | Startup fail-closed | Manifest, ledger, fingerprint, capability, operations/events e participant registry são validados sem repair. | Satisfeita |
| 39 | 33 AC únicos/sequenciais | `F13-P1-AC-01`–`33`, sem duplicados ou lacunas. | Satisfeita |
| 40 | Decisões cobertas | Scope, árvore, archive, stable code, F5/F7, migrations, N/N-1 e legacy mapeiam para AC específicos. | Satisfeita |
| 41 | AC demonstráveis | Nenhum depende de prova semântica impossível; AC amplos possuem gates e subprovas identificadas. | Satisfeita |
| 42 | Superfícies de teste | Cada AC indica unit/property, structural, startup, duas sessões, fault injection ou PostgreSQL. | Satisfeita |
| 43 | PostgreSQL 17 | Constraints, RLS, locks, races, upgrades, rollback e cleanup pertencem ao gate descartável. | Satisfeita |
| 44 | Regressões F3–F12 | F3/F4/F5/F7/F9/F11/F12 e suite backend estão no gate final. | Satisfeita |
| 45 | Verificações estáticas | Suite backend, `node --check`, guards e `git diff --check` estão previstas. | Satisfeita |
| 46 | Benchmark baseline | AC-33 e decisão de archive proíbem tratá-lo como SLO. | Satisfeita |
| 47 | Zero PASS prematuro | A matriz mantém todos os AC “por provar”; esta revisão não executou evidência runtime. | Satisfeita |

## Cobertura dos 33 acceptance criteria

Todos permanecem **por provar**; a coluna abaixo confirma apenas readiness/testabilidade, não execução.

| AC | Contrato fechado | Prova futura prevista |
|---|---|---|
| 01 | Residência `UNIT|TEAM`; sem Organization duplicada | Schema/structural |
| 02 | Organization tenant-bound | PostgreSQL A/B/context |
| 03 | UUID independente de label/legacy/code | Unit + constraints |
| 04 | Stable code grammar/bytewise/unique/immutable | Property + PG concurrency |
| 05 | Rename apenas label | Unit + history/CAS |
| 06 | Tipos/parents fechados | PG adversarial |
| 07 | Self/cycle/cross-organization recusados | Recursive/two-session PG |
| 08 | Reparent concorrente serializado | Two-session/fault injection |
| 09 | Sem inheritance/`UNIT_SUBTREE` | Catalog/structural guard |
| 10 | `ACTIVE→ARCHIVED`, sem restore/delete | Unit + PG grants/guard |
| 11 | Archived histórico e não operacional | Lifecycle/loader probes |
| 12 | Leaf-first profundo e race-safe | Hierarchy/archive concurrency |
| 13 | CAS/revision monotónica | Unit + two-session PG |
| 14 | Idempotência e intenção divergente | Retry/commit-uncertain PG |
| 15 | RLS A/B/no-context | PostgreSQL A/B |
| 16 | IDOR uniforme | Service + PG spies |
| 17 | F5 catalog exato | Startup/catalog mutations |
| 18 | Resource loader server-side | Unit + PG loader |
| 19 | Efeito + F7 source-local | Same PID/XID + rollback |
| 20 | Falha F5/F7 e sanitização | Negative integration/scans |
| 21 | Funciona sem F13 | Empty-F13 PG/guard |
| 22 | Capability exige participant | Registry contract |
| 23 | Participant atómico | Composition fixture + PG |
| 24 | Runner único/migration 006 | Manifest/runner/PG |
| 25 | Ledger/fingerprint/capabilities/postflight | Preflight/manifest gate |
| 26 | Empty e 005→006 | PostgreSQL upgrades |
| 27 | SQL→ledger rollback/commit incerto | Fault injection |
| 28 | Tuple N/N-1 fechada | Compatibility corpus/startup |
| 29 | Drift fail-closed/no repair | Startup mutation probes |
| 30 | Sem mapping UBI inferido | Legacy fixtures/guard |
| 31 | Gate PostgreSQL 17 integral | Disposable PG gate |
| 32 | Regressões F3–F12 | Backend suite/gates |
| 33 | Benchmark apenas baseline | Relatório local |

## Matriz de decisões

| Decisão | Estado | Efeito na readiness |
|---|---|---|
| `organizational-scope-foundation` | Aprovada | Fecha ownership, entidade, árvore, lifecycle e integração transversal. |
| `f13-p1-organizational-scope-archive` | Aprovada | Fecha leaf-first, locks, CAS/idempotência, F5/F7 e participant F13. |
| `f13-p1-stable-code` | Aprovada | Fecha grammar, comparação, uniqueness, imutabilidade, legacy e compatibilidade. |
| Scope/inheritance F13 | Aprovada | Confirma referências exatas e ausência de herança Team→Unit. |
| Authorization/SoD F13 e F5 | Aprovadas/aplicáveis | Fornecem deny-by-default, resource loading, assurance e audit boundaries. |
| Compatibilidade N/N-1 F13 | Aprovada/aplicável | Fornece tuple fechada e upgrade aditivo; F13-P1 materializa apenas o subconjunto necessário. |

Não existe recomendação de investigação ainda não aprovada que altere o schema ou comportamento F13-P1.

## Evidência do repositório e limites

- `tenantMigrationManifest.js` mantém ordinais 000–005, checksums, fingerprints, capabilities e validação cumulativa; 006 é o próximo ordinal.
- `tenantMigrationRunner.js` controla `BEGIN`, advisory transaction lock, SQL, fingerprint, ledger, postflight, `COMMIT/ROLLBACK` e reconciliação de resultado incerto.
- `tenantMigrationPreflight.js` valida PostgreSQL 17 e database contract; `tenantSchemaFingerprint.js` observa estado físico.
- F5 possui operation/permission/resource catalogs, resource loader server-side, denial uniforme e testes A/B/IDOR.
- F7 possui evento fechado, canonicalização, writer com transaction client e provas PostgreSQL existentes de atomicidade/sanitização.
- Migrations tenant atuais mostram RLS por `app.organization_id`, roles NOLOGIN funcionais e grants mínimos, padrões a estender — não arquitetura a copiar cegamente.

Esta evidência demonstra que o plano é exequível e coerente; não demonstra que a F13-P1 já está implementada ou que qualquer AC passou.

## Estado recomendado

`Ready` — contrato e plano aprovados para início explícito de implementação. F13-P1 ainda não está `In Progress`, nenhum AC está `PASS`, e F13 continua bloqueada até a prerequisite ficar concluída.

## Próximo passo único

Iniciar a implementação da F13-P1 segundo o plano aprovado, mantendo a F13 bloqueada até a fundação ser concluída.
