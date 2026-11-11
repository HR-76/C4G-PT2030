# F13-P1 — Fundação de Âmbitos Organizacionais

## Identidade

- **ID:** F13-P1
- **Nome:** Fundação de Âmbitos Organizacionais
- **Tipo:** prerequisite transversal
- **Estado:** `Complete`
- **Decisão normativa:** `context/decisions/organizational-scope-foundation.md`
- **Decisão de archive:** `context/decisions/f13-p1-organizational-scope-archive.md`
- **Decisão de stable code:** `context/decisions/f13-p1-stable-code.md`
- **Arquivo permanente:** `context/history/f13-p1-organizational-scope-foundation.md`
- **Consumidores:** F5, F13, F15 e reporting

## Objetivo

Criar a autoridade tenant-local canónica para unidades e equipas, referenciando a organização Central/F3 e fornecendo identidades estáveis, lifecycle, hierarquia mínima, autorização e auditoria para consumo futuro pela F13 e outras features.

## Âmbito

- entidades `UNIT` e `TEAM` tenant-local;
- `scope_id` UUID interno, `organization_id` canónico e imutável;
- label apresentacional e `stable_code` opcional;
- parent e árvore mínima;
- lifecycle `ACTIVE|ARCHIVED`;
- revision, optimistic locking, idempotência e provenance;
- archive lógico e terminal;
- isolamento tenant, RLS e IDOR;
- operações/grants F5 e resource loaders server-side;
- eventos F7 críticos source-local;
- migration tenant canónica, manifest, ledger, fingerprint, capabilities e postflight;
- compatibilidade N/N-1 aplicável;
- provas em PostgreSQL 17 descartável;
- contrato transacional extensível para integração futura com overlays F13.

## Fora do âmbito

- perfis, versões, overlays ou snapshots F13;
- matching F14, qualificação F15 e pipeline de candidaturas;
- utilizadores, memberships, cargos, pessoal ou reporting lines;
- permissions herdadas pela hierarquia ou profile inheritance;
- `UNIT_SUBTREE`;
- calendários, organogramas visuais ou UI final;
- importação ou mapping automático de estruturas UBI;
- provisioning produtivo, rollout, staging ou produção.

## Contrato funcional

1. Central/F3 continua a autoridade de organizações; F13-P1 não cria, replica nem governa organizações.
2. `UNIT|TEAM` residem exclusivamente na base tenant e pertencem à organização vinculada ao tenant corrente.
3. IDs são UUID internos imutáveis, não derivados de labels, `stable_code` ou códigos legacy.
4. Label é apresentacional, NFC, mutável por CAS e nunca chave de integração ou autorização.
5. `stable_code` é alias institucional opcional, definido apenas no create, imutável e único por organização entre `UNIT|TEAM`, parents e lifecycles. Usa ASCII canónico de 1–64 caracteres, grammar `^[A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)*$`, comparação bytewise sob collation `C`, não transforma input e nunca é atribuído tardiamente, removido ou reutilizado após archive, conforme `context/decisions/f13-p1-stable-code.md`.
6. Tipos são fechados em `UNIT|TEAM`.
7. `UNIT` pode ter como parent a raiz conceptual Organization ou outra `UNIT` da mesma organização.
8. `TEAM` pode ter como parent a raiz conceptual Organization ou uma `UNIT` da mesma organização.
9. `TEAM` não tem filhos e não aceita `TEAM` como parent na v1.
10. A hierarquia é árvore: self-parent, ciclos e parents cross-tenant/cross-organization são recusados.
11. Hierarquia não concede permissions, profile inheritance ou scopes descendentes; autorização usa scope exato e não existe `UNIT_SUBTREE`.
12. Lifecycle é `ACTIVE|ARCHIVED`; archive é lógico, terminal e sem restore ou delete físico.
13. Scope arquivado permanece historicamente referenciável, mas recusa rename, reparent, novos grants e novas operações funcionais.
14. Archive é estritamente leaf-first: qualquer descendente `ACTIVE`, em qualquer profundidade, bloqueia; descendentes `ARCHIVED` não bloqueiam; não existe cascade, reparent automático ou efeito parcial. Create, reparent e archive partilham advisory transaction lock por organização, row-lock order canónica e verificação recursiva na mesma transação, conforme `context/decisions/f13-p1-organizational-scope-archive.md`.
15. Create, rename, reparent e archive usam expected revision/CAS. Idempotency key igual com a mesma intenção converge; digest divergente conflita.
16. Create, rename, reparent e archive persistem F7 crítico na mesma transação tenant do efeito.
17. Repositories exigem contexto tenant preparado e RLS; falta/divergência falha antes de observar ou mutar o recurso.
18. Not-found e forbidden são uniformes e não revelam scopes de outra organização.
19. Dados UBI não são convertidos por label ou semelhança; mapping futuro requer decisão, provenance e workflow próprios.

## Integração futura com F13

- F13 guardará FKs tenant-local compostas por `organization_id + scope_id` e validará `scope_type`/`ACTIVE` através do resource loader canónico.
- A fundação funciona sem tabelas F13: a migration F13-P1 não cria FK, trigger, view nem referência ao schema futuro F13.
- O serviço de archive da fundação será proprietário da transação tenant e aceitará participantes source-local registados que operam sobre o mesmo client preparado.
- O registry de participantes é fechado e validado no startup contra capabilities instaladas. Sem capability F13, o conjunto vazio é válido; com capability F13, ausência ou incompatibilidade do participante F13 falha antes da mutação.
- O participante F13 futuro bloqueará/validará o pointer e desativará atomicamente o overlay ativo antes de o scope passar a `ARCHIVED`. A fundação não conhece tabelas F13 nem fabrica o resultado.
- Upgrades futuros acrescentam a capability, o participante e as migrations F13 sem alterar a migration F13-P1 publicada.
- O gate futuro deve provar que falha do participante ou do F7 reverte archive e pointer, e que commit incerto é reconciliado pelo estado persistido.

## Invariantes de dados

- PK lógica e física inclui `organization_id + scope_id`; `scope_id` possui também unicidade global tenant-local para referências opacas.
- Parent usa FK composta e pertence à mesma organização; raiz Organization é representada por parent nulo, não por row duplicada.
- Checks de tipo/parent restringem a forma local; validação transacional serializada impede ciclos e races de reparent.
- `revision` é positiva e monotónica; archive incrementa revision uma única vez.
- `archived_at`, `archived_by` e reason são nulos em `ACTIVE` e obrigatórios em `ARCHIVED`.
- `stable_code` nullable usa a própria forma ASCII canónica, unique index `(organization_id, stable_code)` sob comparação bytewise e proteção estrutural contra update, remoção ou `NULL → valor`; quando materializado, continua reservado após archive.
- RLS usa `app.organization_id`; nenhum repository depende de filtro caller-supplied como controlo primário.
- Runtime não recebe `DELETE`, `TRUNCATE`, DDL ou acesso a ledger/marker.

## Operações e eventos candidatos

O catálogo é determinável sem nova decisão material, preservando deny-by-default e as decisões de archive e `stable_code` aprovadas:

| Operação F5 | Permission | Resource | Efeito | Evento F7 crítico |
|---|---|---|---|---|
| `ORGANIZATIONAL_SCOPE_READ` | `organizational_scope.read` | `ORGANIZATIONAL_SCOPE` | READ | leitura normal sem evento crítico próprio |
| `ORGANIZATIONAL_SCOPE_CREATE` | `organizational_scope.create` | `ORGANIZATION`/parent carregado | WRITE | `ORGANIZATIONAL_SCOPE_CREATED` |
| `ORGANIZATIONAL_SCOPE_RENAME` | `organizational_scope.rename` | `ORGANIZATIONAL_SCOPE` | WRITE; altera apenas label | `ORGANIZATIONAL_SCOPE_RENAMED` |
| `ORGANIZATIONAL_SCOPE_REPARENT` | `organizational_scope.reparent` | scope + parent | WRITE | `ORGANIZATIONAL_SCOPE_REPARENTED` |
| `ORGANIZATIONAL_SCOPE_ARCHIVE` | `organizational_scope.archive` | scope + dependências | WRITE | `ORGANIZATIONAL_SCOPE_ARCHIVED` |

Todos os resources são carregados server-side, tenant-bound e com scope exato. Os payloads F7 preservam actor, resource, parent anterior/novo por referências seguras, revision, reason code, idempotency key e resultado; não incluem labels, paths completos, PII ou conteúdo legacy.

## Erros públicos

Categorias sanitizadas: `INVALID_INPUT`, `RESOURCE_NOT_AVAILABLE`, `AUTHORIZATION_REQUIRED`, `STATE_CONFLICT`, `STALE_REVISION`, `IDEMPOTENCY_CONFLICT`, `DEPENDENCY_CONFLICT`, `INCOMPATIBLE_VERSION` e `PERSISTENCE_UNAVAILABLE`. Not-found, cross-tenant e scope arquivado não revelam existência ou topologia inacessível.

## Acceptance criteria

O resultado fechado, os 33 critérios, findings, validação e limitações estão preservados em `context/history/f13-p1-organizational-scope-foundation.md`. Estado final: `Complete`; veredicto humano: `Approved — ready to close`.

| ID | Requisito verificável | Evidência esperada |
|---|---|---|
| F13-P1-AC-01 | Apenas `UNIT|TEAM` tenant-local são criados; Organization não é duplicada. | PG schema + structural |
| F13-P1-AC-02 | Toda row e operação ficam vinculadas à organização validada do tenant. | PG A/B + context probes |
| F13-P1-AC-03 | `scope_id` é UUID interno imutável e independente de label/legacy. | unit + PG constraints |
| F13-P1-AC-04 | `stable_code` opcional aceita apenas a grammar ASCII canónica aprovada, compara bytewise, é único por organização entre tipos/parents/lifecycles e nunca é alterado, atribuído tardiamente ou reutilizado. | unit/property + PG constraint/uniqueness/concurrency |
| F13-P1-AC-05 | Rename altera label por CAS sem mudar identidade ou stable code. | unit + PG history |
| F13-P1-AC-06 | Tipos e combinações parent são fechados; TEAM não é parent nem tem filhos. | PG constraint/adversarial |
| F13-P1-AC-07 | Self-parent, ciclos e parent cross-tenant/cross-organization falham fechado. | PG recursive/concurrency probes |
| F13-P1-AC-08 | Reparents concorrentes não criam ciclo, DAG ou lost update. | duas sessões PG + fault injection |
| F13-P1-AC-09 | Hierarquia não cria permission/profile inheritance nem `UNIT_SUBTREE`. | catalog + structural guard |
| F13-P1-AC-10 | Lifecycle admite apenas `ACTIVE→ARCHIVED`; restore/delete físico são recusados. | unit + PG grants/triggers |
| F13-P1-AC-11 | Scope arquivado recusa novas mutações/grants e preserva referências históricas. | PG lifecycle + loader probes |
| F13-P1-AC-12 | Archive é leaf-first: qualquer descendente ativo direto ou profundo bloqueia; descendants arquivados não bloqueiam; races create/reparent/archive são serializadas sem cascade ou estado parcial. | PG hierarchy/archive/concurrency probes |
| F13-P1-AC-13 | CAS/revision recusa stale writes e mantém revision monotónica. | unit + duas sessões PG |
| F13-P1-AC-14 | Idempotency key+digest converge; intenção divergente conflita. | unit + PG retry/commit incerto |
| F13-P1-AC-15 | RLS isola A/B mesmo sem filtro explícito e sem contexto falha fechado. | PostgreSQL A/B |
| F13-P1-AC-16 | IDOR/not-found/forbidden são uniformes e não enumeram scopes. | service + PG spies |
| F13-P1-AC-17 | Catálogo F5 contém apenas operações, permissions, resources e scopes exatos aprovados. | startup/catalog mutation tests |
| F13-P1-AC-18 | Resource loader obtém organization/type/lifecycle/revision server-side. | unit + PG loader probes |
| F13-P1-AC-19 | Create/rename/reparent/archive persistem evento F7 aprovado e efeito na mesma transação. | PG same PID/XID + rollback |
| F13-P1-AC-20 | Falha F5/F7 impede qualquer mutação e logs/eventos ficam sanitizados. | negative integration + scans |
| F13-P1-AC-21 | A fundação funciona sem schema F13 e não contém dependência prematura. | empty-F13 PG + structural guard |
| F13-P1-AC-22 | Capability F13 futura exige participante registado; ausência/incompatibilidade falha antes do archive. | participant registry contract |
| F13-P1-AC-23 | Com participante F13, archive e desativação do overlay são atómicos no mesmo client. | futura composition contract + PG |
| F13-P1-AC-24 | Migration usa exclusivamente runner tenant no próximo ordinal, sem transaction control interno. | manifest/runner structural + PG |
| F13-P1-AC-25 | Ledger, checksum, fingerprint, capabilities e postflight refletem exatamente o schema instalado. | tenant preflight/manifest gate |
| F13-P1-AC-26 | Tenant vazio e instalação 005 atual convergem para a nova versão pelo runner. | PG empty→N e 005→N |
| F13-P1-AC-27 | Falha SQL→ledger reverte integralmente; commit incerto reconcilia e retry converge. | PG fault injection |
| F13-P1-AC-28 | CompatibilityManifest aceita apenas tuples N/N-1 declaradas; N-2/futura/cruzada falham. | compatibility corpus/startup |
| F13-P1-AC-29 | Startup recusa drift, capability/policy/event/operation incompatível e não repara estado. | startup mutation probes |
| F13-P1-AC-30 | Nenhum dado UBI é mapeado por label/código sem decisão e provenance. | structural + legacy fixtures |
| F13-P1-AC-31 | Gate PostgreSQL 17 cobre hierarchy, archive, RLS, roles, upgrades, rollback e cleanup. | disposable PG gate |
| F13-P1-AC-32 | Regressões F3/F4/F5/F7/F9/F11/F12 e verificações estruturais passam sem skips materiais. | backend suite + gates |
| F13-P1-AC-33 | Benchmark local mede apenas baseline de create/read/reparent/archive e não define SLO. | benchmark report |

Total: **33 critérios**, únicos e `PASS` no âmbito local autorizado; a matriz final e os riscos residuais estão no arquivo permanente.

## Readiness

Estado: `Complete` — revisão humana final aprovada e arquivo permanente registado em `context/history/f13-p1-organizational-scope-foundation.md`. O fecho não constitui rollout nem prontidão produtiva.

### Audit final

`context/reviews/f13-p1-readiness-audit.md` concluiu `READY — approved for implementation`. Depois da implementação, R5-001, R5-002, R5-003 e R6-001 foram corrigidos; a revisão humana final confirmou AC-14 e emitiu `Approved — ready to close`.

### Não bloqueante

- Os nomes finais dos cinco operation codes/event codes podem ser confirmados no plano sem alterar o comportamento fechado.
- O contrato de participante source-local permite instalar F13 posteriormente sem referência física prematura.
- A política leaf-first, locks, CAS/idempotência, F5/F7 e participante F13 do archive estão fechados em `context/decisions/f13-p1-organizational-scope-archive.md`.
- Grammar, comparação, uniqueness, imutabilidade, lifecycle e compatibilidade de `stable_code` estão fechados em `context/decisions/f13-p1-stable-code.md`.
- Seeds, UI, imports e operação produtiva estão fora do âmbito.
