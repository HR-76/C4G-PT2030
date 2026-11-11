# F13 — Readiness audit formal

- Data: 2026-10-10
- Natureza: revisão exclusivamente documental; aplicação, testes e infraestrutura em read-only
- Snapshot: worktree documental existente no início do audit, acrescido da decisão aprovada `f13-schema-policy-compatibility`
- Veredicto: **READY — specification approved; implementation blocked by prerequisite**
- Estado recomendado: `Ready`

## Âmbito revisto

Foram confrontados `AGENTS.md`, overview, arquitetura, standards, `current-work`, a especificação F13, todas as decisões F13 e a fundação organizacional aprovadas, as investigações ainda existentes, os contratos históricos F3/F4/F5/F7/F9/F10/F11/F12 e, apenas como evidência de dependências, manifests, runners, catalogs, ledgers e implementação UBI atuais. Não foram executados testes, probes, bases, containers, benchmark ou código funcional.

O contrato revisto mantém uma baseline `ORGANIZATION`, overlays explícitos onde cada domínio os admite, snapshots efetivos imutáveis, taxonomias/assertions governadas, completion e projection separadas e uma fronteira estrita com F14/F15. A implementação UBI permanece evidência legacy, nunca arquitetura normativa.

## Veredicto

Não subsiste decisão humana ou arquitetural `BLOCKING FOR READY`. Os 32 critérios são únicos, sequenciais e possuem superfície de prova concreta; nenhum está `PASS`, porque não existe implementação F13 nem evidência runtime. A fundação organizacional transversal está suficientemente contratada para planear referências, loaders, lifecycle e composição, mas ainda não foi implementada: é um `IMPLEMENTATION PREREQUISITE` e impede o início da implementação F13.

## Findings por classificação e severidade

### BLOCKING FOR READY

Nenhum.

### IMPLEMENTATION PREREQUISITE — HIGH

#### Fundação tenant-local de `UNIT|TEAM` ainda não implementada

- Evidência: `context/decisions/organizational-scope-foundation.md` define UUID, organização, tipos, parentagem, lifecycle, archive, RLS/IDOR, loaders e composição atómica; a spec F13 declara a dependência.
- Impacto: sem a autoridade física não podem existir FKs, resource loaders nem overlays `UNIT|TEAM` executáveis.
- Classificação: não bloqueia a aprovação da especificação porque o contrato da fronteira está fechado; bloqueia implementação e migrations F13.
- Condição: implementar e provar primeiro uma feature própria para a fundação, sem a incorporar em F13.

### IMPLEMENTATION DETAIL — MEDIUM

1. **Catálogos concretos:** seeds temáticos, de competências, territórios, beneficiários e métricas; authorities, jurisdições, cardinalidades, horizons, FTE, coverage/partitions, reason/purpose codes e métodos de verificação. As decisões fecham identidade, governance, estados e falha segura; o conteúdo editorial deve ser publicado em releases testadas.
2. **Operação de reclassificação:** a decisão de autorização conserva 29 operações-base; a decisão posterior de confidencialidade obriga uma operação própria, grant, maker-checker, `RECENT_MFA`, reason e F7. A spec integra essa obrigação em AC-21 sem falsificar o total anterior. O código/nome final, resource e evento entram no catálogo antes da implementação; não existe liberdade para omitir ou fundir implicitamente a operação.
3. **Artefactos físicos N/N-1:** formato do `CompatibilityManifest`, numeração inicial, adapters e duração da janela são detalhes de release. A tuple exata, writer/reader behavior e gates já estão fechados.
4. **Materialização síncrona:** o limite e benchmark local ainda serão definidos. Excedê-los não autoriza F9; exige decisão futura própria.
5. **Schemas finais F7/F10 e erros:** conteúdo permitido, atomicidade e sanitização já estão fechados; nomes/códigos finais permanecem catalogação de implementação.

### DEFERRED OUT OF SCOPE — LOW

- Retenção/legal hold produtivos, eliminação física, provisioning, secret manager, rollout, staging/produção e serviços externos.
- Scheduling automático, materialização assíncrona sem necessidade demonstrada e jobs F13 ainda inexistentes.
- Matching, scoring, elegibilidade F14, qualificação F15, candidatura e UI final.
- Mapping/backfill automático de F12/UBI, grupos empresariais, câmbio, `CUSTOM_AREA`, `UNIT_SUBTREE`, restore da fundação e `TEAM` nos domínios excluídos.

### EDITORIAL — LOW

1. A decisão inicial de scope contém a frase histórica “`UNIT_SUBTREE` pode autorizar operações F5”. As decisões posteriores `organizational-scope-foundation` e `f13-authorization-and-segregation`, e a spec canónica, fecham `UNIT_SUBTREE` fora da v1. A precedência é inequívoca; a frase antiga não é contrato corrente.
2. Várias decisões antigas conservam secções “pendentes” já resolvidas por decisões posteriores. São registo temporal, não blockers; `current-work` e a spec consolidada são a vista corrente.

## Matriz das decisões

| Decisão | Estado | Contrato fechado | Resultado do audit |
|---|---|---|---|
| Scope e inheritance | Aprovada | baseline, overlay explícito, sem herança implícita | coerente com foundation/lifecycle |
| Organizational scope foundation | Aprovada | autoridade `UNIT|TEAM`, árvore, archive terminal | prerequisite de implementação |
| Thematic taxonomy | Aprovada | schemes, DAG, releases, mappings | detalhe editorial apenas |
| Competencies/experience | Aprovada | conceitos separados, evidence, verification | detalhe de seeds/métodos |
| Financial capacity | Aprovada | ORG-only, métricas, decimal, estados | detalhe de métricas/policies |
| Operational capacity | Aprovada | ORG/UNIT, agregados, rollup fechado | detalhe de catálogo/coverage |
| Knowledge state policy | Aprovada | dimensões independentes e sem defaults | coerente com completion/projection |
| Versioning/activation | Aprovada | revisions, versions, cohort, READY/cutover | coerente e testável |
| Authorization/SoD | Aprovada | grants, resources, scopes, MFA, 29 operações-base | reclassification posterior integrada |
| Territory vocabulary | Aprovada | schemes, mappings, relations ORG/UNIT | coerente |
| Beneficiary vocabulary | Aprovada | cinco schemes ORG e served populations | coerente |
| Exclusions versus F14 | Aprovada | `PROHIBITED|UNAVAILABLE`, sem evaluator | fronteira fechada |
| Completion policy | Aprovada | policies/slots, COMPLETE/INCOMPLETE, gates | coerente com READY |
| Confidentiality/projection | Aprovada | classes, modes, purpose/reason, side channels | coerente; operation addendum obrigatório |
| Schema/policy N/N-1 | Aprovada | exact tuples, bundles, jobs, startup, upgrade | último blocker resolvido |

Nenhuma investigação remanescente contém recomendação não aprovada que altere o schema, autorização ou comportamento corrente. Seeds e códigos concretos permanecem conteúdo fechado por release, não uma escolha arquitetural livre.

## Verificações obrigatórias

| # | Verificação | Classificação/conclusão |
|---:|---|---|
| 1 | Objetivo, utilizadores, residência e fronteira | Fechados; tenant-local e sem F14/F15. |
| 2 | Fronteiras foundation/F13/F14/F15/pipeline | Fechadas e referenciadas. |
| 3 | Baseline, overlays, scopes e snapshots | Semântica explícita e imutável. |
| 4 | Uso de ORG/UNIT/TEAM por domínio | Coerente na spec; TEAM é restrito por domínio. |
| 5 | Blockers de decisão | Nenhum remanescente. |
| 6 | Recomendações não aprovadas materiais | Nenhuma; restantes itens são details/deferred. |
| 7 | Contradições | Sem contradição normativa corrente; `UNIT_SUBTREE` antigo é editorial e superado explicitamente. |
| 8 | Termos homónimos | Knowledge, verification, lifecycle, conflict e projection estão separados. |
| 9 | Operações F5 ausentes | Nenhuma capacidade material omitida da spec; reclassification é obrigação posterior explícita. |
| 10 | Reclassification versus 29 operações | 29 são operations-base; reclassification é operação adicional obrigatória, ainda sem código final. |
| 11 | 32 AC únicos/sequenciais | Confirmado `01–32`, sem gaps ou duplicados. |
| 12 | Cobertura normativa por AC | Confirmada pela matriz abaixo. |
| 13 | Superfície de prova | Unit, structural, PostgreSQL, security e vertical gates identificados. |
| 14 | AC dependentes de escolhas abertas | Nenhum depende de decisão arquitetural; seeds/policies concretas são fixtures/releases de implementação. |
| 15 | Spec/implementation/evidence | Separadas; nenhum AC está PASS. |
| 16 | Entidades/IDs/versions/states/digests/pointers | Suficientes para planear migrations após a foundation. |
| 17 | Constraints expressáveis | Baseline, overlays, completion, classification e compatibility têm contratos fechados. |
| 18 | Archive/rollback/dispute/revoke/history | Append-only/versioned, sem delete físico ou rewrite. |
| 19 | Upgrade existente | Runner canónico, provenance e sem backfill inferido. |
| 20 | Mutação retroativa | Proibida em todas as decisões relevantes. |
| 21 | F5/SoD/MFA/service actors | Fechados; detalhe de códigos não altera comportamento. |
| 22 | F7 source-local e payload | Atomicidade e minimização fechadas. |
| 23 | Classification/projection/purpose/reason/export | Dimensões independentes e fail-closed. |
| 24 | Caminhos fail-open | Defaults, unknowns, catalogs/policies incompatíveis e projections livres são recusados. |
| 25 | RLS/IDOR/A-B | Provas futuras são explícitas em AC-01/02/25/28. |
| 26 | Minimização sensível | Financeiro, populações e F11 têm projection/autorização próprias. |
| 27 | Necessidade F9 | Lifecycle v1 é síncrono; F9 apenas se surgir assincronia real. |
| 28 | Tuple de jobs | Exact tuple obrigatória; registry F9 atual não é copiado. |
| 29 | N/N-1/startup testáveis | Manifest, bundles, readers/writers, probes e recusas estão especificados. |
| 30 | Limite síncrono | Implementation detail/benchmark; mudança para async exige decisão futura. |
| 31 | Rollout produtivo | Fora do âmbito e não alegado. |
| 32 | Benchmark | Baseline local, nunca SLO. |
| 33 | Foundation especificável como feature | Sim; entidade, invariantes, hierarchy, lifecycle e fronteiras estão fechados. |
| 34 | Efeito da ausência da foundation | Impede implementação, não o estado Ready da especificação. |
| 35 | FKs/loaders/archive | Podem ser planeados contra o contrato; execução depende da foundation entregue. |
| 36 | Natureza da dependência | Feature anterior formal e `IMPLEMENTATION PREREQUISITE`. |

## Cobertura dos 32 critérios

Estado de readiness abaixo significa apenas que o critério está especificado e testável. **Nenhum critério está `PASS` ou foi executado.**

| AC | Cobertura normativa | Superfície futura | Readiness |
|---|---|---|---|
| AC-01 | residência tenant-local | PG integration/RLS | TESTABLE |
| AC-02 | isolamento A/B completo | PG security probes | TESTABLE |
| AC-03 | núcleo sem UBI | structural guard | TESTABLE |
| AC-04 | revisions imutáveis | unit + PG | TESTABLE |
| AC-05 | contratos/catálogos fechados | adversarial unit/startup | TESTABLE |
| AC-06 | version/digest imutáveis | PG constraints | TESTABLE |
| AC-07 | publish/cutover READY | PG vertical | TESTABLE |
| AC-08 | unicidade de pointers | PG concurrency | TESTABLE |
| AC-09 | história preservada | PG history | TESTABLE |
| AC-10 | CAS/locks | sessões PG | TESTABLE |
| AC-11 | retry/commit incerto/digests | fault injection | TESTABLE |
| AC-12 | autoria/provenance/context | PG + F7 | TESTABLE |
| AC-13 | taxonomy schemes/DAG/releases | graph + PG | TESTABLE |
| AC-14 | competency/evidence/verification | unit + PG + F11 negative | TESTABLE |
| AC-15 | territory/beneficiary vocabularies | contract + PG | TESTABLE |
| AC-16 | financeiro ORG-only | unit + PG security | TESTABLE |
| AC-17 | operacional ORG/UNIT e rollup | unit + PG | TESTABLE |
| AC-18 | scopes canónicos/ativos | loaders + FK/RLS | TESTABLE AFTER PREREQUISITE |
| AC-19 | constraints fechadas sem F14 | contract + PG + guard | TESTABLE |
| AC-20 | epistemologia/completion | state matrix + property + PG | TESTABLE |
| AC-21 | F5/SoD/MFA/reclassification | catalog/startup | TESTABLE |
| AC-22 | efeito + F7 atómicos | PG rollback + payload scan | TESTABLE |
| AC-23 | F9 só quando necessário/exact tuple | structural + contract | TESTABLE |
| AC-24 | F10 baixa cardinalidade | telemetry tests | TESTABLE |
| AC-25 | IDOR/RLS sem enumeração | PG A/B + spies | TESTABLE |
| AC-26 | runner/manifest/fingerprint/capability | structural + PG | TESTABLE |
| AC-27 | upgrade sem inference/SQL direto | PG prefixes | TESTABLE |
| AC-28 | PG17 real para invariantes | canonical gate | TESTABLE |
| AC-29 | rollback SQL/ledger e snapshot/cutover | PG fault injection | TESTABLE |
| AC-30 | ausência de matching/scoring | source guard | TESTABLE |
| AC-31 | regressões e gates | canonical commands | TESTABLE |
| AC-32 | READY + exact bundle/digests para F14 | PG vertical/replay | TESTABLE |

## Dependências

- **Anterior obrigatória:** fundação organizacional tenant-local; deve possuir feature própria, migrations, F5/F7/RLS e provas antes de F13.
- **Contratos reutilizados:** F3 membership/context, F4 tenant/schema/runtime, F5 authorization, F7 audit, F10 telemetry, F11 documents e F12 opportunity facts.
- **Condicional:** F9 só entra se uma operação F13 realmente se tornar assíncrona; qualquer job usa exact compatibility tuple.
- **Consumidores posteriores:** F14/F15 não são pré-requisitos e não são iniciados por esta readiness.

## Compatibilidade e integridade

O código atual confirma padrões reutilizáveis de runner, manifest, ledger, fingerprint, capabilities, workload e fence. Confirma também a limitação concreta do registry F9, que aceita job/payload versions por verificações independentes; a decisão F13 proíbe copiar esse comportamento. A implementação atual não contém entidades F13 nem autoridade canónica `UNIT|TEAM`, o que é consistente com o prerequisite e não constitui prova runtime.

## Validação documental

- A decisão N/N-1 contém 100 pontos normativos e estado `Aprovada`.
- A spec contém exatamente 32 IDs `F13-AC-01` a `F13-AC-32`, todos declarados por provar.
- Referências documentais usadas pelo contrato existem no worktree.
- Não foram executados testes, infraestrutura ou benchmark; nenhuma evidência runtime é declarada.
- `.vscode/settings.json` permaneceu fora das alterações F13 desta ação.

## Estado recomendado

**READY — specification approved; implementation blocked by prerequisite**

A mudança para `Ready` aprova a especificação para planeamento posterior; não aprova implementação, não marca ACs `PASS`, não cria a feature da fundação, não inicia F14 e não representa prontidão produtiva.

Next step: implementar primeiro a fundação organizacional tenant-local aprovada e só depois planear o início da F13.
