# F13-P1 — Fundação de Âmbitos Organizacionais

## Identificação

- **ID:** F13-P1
- **Nome:** Fundação de Âmbitos Organizacionais
- **Tipo:** prerequisite transversal
- **Estado:** `Complete`
- **Fecho documental:** 2026-10-10
- **Relação com F13:** prerequisite concluída; F13 fica documentalmente `Ready`, mas não foi iniciada e exige ação explícita e plano reconciliado.
- **Especificação:** `context/features/f13-p1-organizational-scope-foundation.md`
- **Contexto Git no fecho:** branch `feat/f12-opportunity-catalog`, HEAD `64b657be954548233cc79ce797feab86af92d99d`; isto não afirma stage, commit, merge, push ou integração Git da F13-P1.

## Resultado entregue

- Autoridade tenant-local canónica para `UNIT|TEAM`, ligada à organização Central/F3 sem a duplicar.
- UUID interno como identidade canónica; label apresentacional e `stable_code` ASCII opcional, imutável, bytewise, único por organização e reservado depois de archive.
- Árvore fechada: Unit sob Organization/Unit, Team sob Organization/Unit, Team sem filhos, sem ciclos, self-parent, DAG ou `UNIT_SUBTREE`.
- Lifecycle `ACTIVE|ARCHIVED`, sem restore/delete e archive estritamente leaf-first, transacional e concorrente-safe.
- CAS por revision, idempotency key e digest canónico; replay converge e intenção divergente falha fechado.
- RLS/FORCE RLS, contexto tenant obrigatório, isolamento A/B, IDOR uniforme e runtime não privilegiado.
- Cinco operações F5 fechadas, resource loading server-side, grants exatos, `RECENT_MFA` no archive e zero grants implícitos para service actors.
- Quatro eventos funcionais F7 source-local na mesma transação e telemetria F10 fechada e de baixa cardinalidade.
- Boundary capability-gated para o participant F13 futuro, usando o mesmo client/transação e sem dependência física prematura em tabelas F13.
- Migration tenant `006_f13_p1_organizational_scope`, manifest, checksum, fingerprint, capability, postflight e preflight do contrato de segurança.
- Upgrades vazio/003/004/005→006 através do runner canónico; leitura N/N-1 fechada e escrita apenas na versão corrente.
- Commit uncertainty reconciliável: falha pós-COMMIT nunca é repetida automaticamente, client incerto é descartado e retry explícito converge por idempotência sem duplicar efeito, revision, participant ou F7.

## Decisões aplicáveis

- `context/decisions/organizational-scope-foundation.md`
- `context/decisions/f13-p1-organizational-scope-archive.md`
- `context/decisions/f13-p1-stable-code.md`
- `context/decisions/f13-organizational-profile-scope-and-inheritance.md`
- `context/decisions/f13-versioning-and-activation.md`
- `context/decisions/f13-authorization-and-segregation.md`
- `context/decisions/f13-schema-policy-compatibility.md`

As decisões são referenciadas, não reproduzidas. Investigações e reviews permanecem preservados nos respetivos diretórios.

## Acceptance criteria finais

| ID | Resultado | Evidência principal | Risco residual |
|---|---|---|---|
| F13-P1-AC-01 | PASS | Schema tenant cria apenas `UNIT|TEAM`; prova estrutural e PG17 | Nenhum local |
| F13-P1-AC-02 | PASS | `organization_id` derivado e RLS A/B real | Provisioning produtivo fora do âmbito |
| F13-P1-AC-03 | PASS | UUID PK imutável, independente de label/legacy | Nenhum local |
| F13-P1-AC-04 | PASS | Grammar ASCII, collation `C`, unicidade e imutabilidade; unit+PG concorrente/archive | Nenhum local |
| F13-P1-AC-05 | PASS | Rename por CAS preserva UUID e stable code | Nenhum local |
| F13-P1-AC-06 | PASS | Parent matrix fechada e Team sem filhos; trigger/FK+PG | Nenhum local |
| F13-P1-AC-07 | PASS | Self/cycle/cross-organization recusados; CTE/RLS+PG | Nenhum local |
| F13-P1-AC-08 | PASS | Advisory lock organizacional, row locks e reparents concorrentes PG | Contenção medida apenas como baseline |
| F13-P1-AC-09 | PASS | Scopes exatos, sem inheritance ou `UNIT_SUBTREE` | Nenhum local |
| F13-P1-AC-10 | PASS | `ACTIVE→ARCHIVED`, sem restore/delete | Nenhum local |
| F13-P1-AC-11 | PASS | Uso operacional recusa archived; leitura histórica preservada | Nenhum local |
| F13-P1-AC-12 | PASS | Archive leaf-first profundo e races create/reparent/archive em PG | Nenhum local |
| F13-P1-AC-13 | PASS | Expected revision, monotonia e stale revision em PG | Nenhum local |
| F13-P1-AC-14 | PASS | Digest/replay/divergência; create+archive PG pós-COMMIT com `40001|40P01` | Nenhum local; resultado aprovado em revisão read-only final |
| F13-P1-AC-15 | PASS | RLS/FORCE RLS, contexto obrigatório e isolamento A/B | Nenhum local |
| F13-P1-AC-16 | PASS | IDOR/not-found/collision sanitizados e PG cross-org | Timing produtivo fora do âmbito |
| F13-P1-AC-17 | PASS | Cinco operações/grants fechados; testes F5 | Grants produtivos fora do âmbito |
| F13-P1-AC-18 | PASS | Resource loader server-side por UUID/organização | Nenhum local |
| F13-P1-AC-19 | PASS | Quatro eventos F7 no mesmo client/transação; ledger PG | Nenhum local |
| F13-P1-AC-20 | PASS | Falha F5/F7 sem mutação e payload sanitizado | Nenhum local |
| F13-P1-AC-21 | PASS | Migration sem FK/import/schema F13 | Integração F13 continua futura |
| F13-P1-AC-22 | PASS | Registry capability-gated e evidence ligada à pool exata | Participant F13 real continua futuro |
| F13-P1-AC-23 | PASS | Participant usa client preparado e falha reverte archive | Participant real pertence à F13 |
| F13-P1-AC-24 | PASS | Ordinal 006 aplicado apenas pelo runner, sem transaction control próprio | Nenhum local |
| F13-P1-AC-25 | PASS | Checksum, fingerprint, capability e postflight exatos | Nenhum local |
| F13-P1-AC-26 | PASS | Vazio/003/004/005 convergem para 006 pelo runner | Nenhum local |
| F13-P1-AC-27 | PASS | SQL→ledger rollback, retry e commit incerto no gate PG | Nenhum local |
| F13-P1-AC-28 | PASS | Leitura 005/006, escrita 006 e tuples fechadas | Remoção futura de N-1 exige decisão |
| F13-P1-AC-29 | PASS | Drift/gap/capability/catalog incompatível falha fechado | Nenhum local |
| F13-P1-AC-30 | PASS | Zero mapping/backfill UBI/legacy | Mapping futuro fora do âmbito |
| F13-P1-AC-31 | PASS | Gate PG17 cobre schema, RLS, locks, faults, participant e cleanup | Prova local não equivale a produção |
| F13-P1-AC-32 | PASS | Backend 560/560, gate cumulativo F12 e verificações estruturais | Nenhuma prontidão produtiva inferida |
| F13-P1-AC-33 | PASS | Baseline local create/read/reparent/archive | Baseline pequena; não é SLO |

## Findings e revisão

- Integridade estrutural SQL e archive leaf-first: corrigidos e revalidados.
- Integração F5, resource loading e `RECENT_MFA`: corrigidos e revalidados.
- `F13P1-R2-001`–`F13P1-R2-006`: corrigidos.
- `F13P1-R3-001` e `F13P1-R3-002`: corrigidos.
- Rondas R4–R6 encerradas sem finding aberto; os IDs duráveis `F13P1-R5-001`, `F13P1-R5-002`, `F13P1-R5-003` e `F13P1-R6-001` estão corrigidos.
- Nenhum finding permanece `OPEN` no contrato corrente.
- Veredicto humano final: `Approved — ready to close`.

## Validação

Evidência executada antes da revisão final:

- Testes focados F13-P1: `22/22 PASS`.
- Suite backend: `560/560 PASS`, zero fail/skip/todo.
- Gate PostgreSQL 17 F13-P1: PASS, incluindo `exactParentDestinationAuthorization`, `poolBoundCapabilityEvidence` e `functionalCommitUncertaintyReconciled`.
- Gate cumulativo F12: PASS.
- `node --check`: PASS nos JavaScript alterados pela correção final.
- `git diff --check`: PASS; apenas avisos locais LF/CRLF.
- Cleanup: zero containers e volumes F13-P1 remanescentes.

A revisão humana final foi exclusivamente read-only: não reexecutou os gates, confirmou `F13P1-R5-001`, `R5-002`, `R5-003` e `R6-001` como corrigidos, classificou `F13-P1-AC-14` como PASS e emitiu `Approved — ready to close`.

O benchmark registado é somente baseline PostgreSQL 17 local; não constitui SLO, sizing ou garantia de capacidade produtiva.

## Limitações e fora do âmbito

- Implementação de perfis, overlays e snapshots F13.
- Participant F13 real; foi entregue apenas o boundary capability-gated e uma fixture de prova.
- F14, F15, matching, scoring, elegibilidade e qualificação.
- UI final, organograma visual, utilizadores, memberships, cargos ou RH.
- Imports ou mapping automático de dados UBI/legacy.
- Provisioning e secret manager produtivos.
- Rollout, staging, produção e serviços externos reais.
- SLO ou demonstração de capacidade produtiva.

O fecho é metodológico e local. Não autoriza Git, deploy ou início automático da F13.
