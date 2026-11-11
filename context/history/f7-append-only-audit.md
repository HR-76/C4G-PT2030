# F7 — Auditoria append-only e trilho de segurança

- Tipo: Feature
- Estado: Complete
- Conclusão: 2026-10-08
- Contrato aprovado: `context/research/f7-append-only-audit-decisions.md`

## Resultado

Foi implementada a fundação F7 com catálogo produtivo fechado de 25 eventos, evento v1, UUIDv7 interno, canonicalização JCS-1/NFC, SHA-256, cadeia por organização/stream, sequência monotónica, checkpoints, topologia source-local, adapter F5, intent F9, query/export ports, reconciliação, métricas e health sanitizados. A versão F7 do catálogo F5 acrescenta `audit_event.read`, `audit_event.verify`, `audit_event.export` e `audit_event.read_cross_organization`; os quatro perfis continuam sem grants.

As migrations versionadas são `005_f7_append_only_audit` para Central e `002_f7_append_only_audit` para tenant sintético. Criam o schema `audit`, partições mensais e `DEFAULT`, roles segregadas, RLS, triggers append-only e funções `SECURITY DEFINER` com `search_path` fixo. O writer não recebe acesso direto às tabelas e apenas os 25 event codes aprovados são aceites. Não existe eliminação, drop/detach automático ou DDL de runtime.

## Critérios finais

| Critério | Estado | Evidência principal |
| --- | --- | --- |
| F7-AC-01 | Satisfied | Catálogo v1 exato, imutável e validado integralmente no bootstrap. |
| F7-AC-02 | Satisfied | Código, versão e schema desconhecidos recusados antes da persistência. |
| F7-AC-03 | Satisfied | Evento/payload fechados; extras, prototypes e tipos arbitrários recusados. |
| F7-AC-04 | Satisfied | Allowlist, canários e scans de secrets, PII, stacks, DSNs, SQL e texto livre. |
| F7-AC-05 | Satisfied | Organização, residência, operação e actor derivados de contexto confiável. |
| F7-AC-06 | Satisfied | Actors humano, service e support têm discriminadores exclusivos. |
| F7-AC-07 | Satisfied | Idempotência composta; mesmo digest é duplicate e divergência fecha. |
| F7-AC-08 | Satisfied | Ledger append-only para runtime; correções exigem novo evento. |
| F7-AC-09 | Satisfied | Roles e probes recusam INSERT direto, UPDATE, DELETE, TRUNCATE e DDL. |
| F7-AC-10 | Satisfied | Verifier deteta hash divergente, gaps, reorder e adulteração. |
| F7-AC-11 | Satisfied | JCS-1/NFC/SHA-256, genesis e previous hash determinísticos. |
| F7-AC-12 | Satisfied | Sequência por organização/stream, acceptedAt transacional e skew ±2 s. |
| F7-AC-13 | Satisfied | Correlation/causation preservadas através do evento e intent F9. |
| F7-AC-14 | Satisfied | RLS e testes A/B demonstram isolamento organizacional. |
| F7-AC-15 | Satisfied | Query/export exigem F5; catálogo tem zero grants implícitos. |
| F7-AC-16 | Satisfied | Filtros/cursor/keyset e limites 50/100, 31 dias, 5 s e 1 MiB. |
| F7-AC-17 | Satisfied | Classe crítica exige append co-localizado ou intent durável antes do efeito. |
| F7-AC-18 | Satisfied | Falha de auditoria de deny nunca converte recusa em autorização. |
| F7-AC-19 | Satisfied | Observacionais seguem F9 e reconciliação com deadline de 300 s. |
| F7-AC-20 | Satisfied | Redelivery/idempotência impedem duplicação lógica do evento. |
| F7-AC-21 | Satisfied | Crash/restart e confirmação incerta são reconciliáveis. |
| F7-AC-22 | Satisfied | Retenção é conservadora; não existe eliminação automática. |
| F7-AC-23 | Satisfied | Suspensão/offboarding não alteram o histórico persistido. |
| F7-AC-24 | Satisfied | Métricas têm labels fechadas e sem IDs de alta cardinalidade. |
| F7-AC-25 | Satisfied | PostgreSQL 17 descartável validou migrations, roles, ataques e restore. |
| F7-AC-26 | Satisfied | Limite owner/superuser demonstrado; não se alega tamper-proof/WORM. |

## Validação e benchmark

- Testes F7 focados: 17/17, incluindo Central e tenant em PostgreSQL 17 descartável.
- Suite backend completa e regressões F2–F5/F9: 403/403, sem skipped ou todo.
- Forward, rollback permitido e re-forward: aprovados para Central e tenant sintéticos.
- Backup/restore para base descartável distinta e verificação após restart: aprovados com cinco eventos e um checkpoint.
- Benchmark sintético final, 20 000 eventos: append/hash 83,39 ms; verify 75,49 ms; query de 100 itens 0,27 ms.
- `node --check`, `git diff --check`, scans de secrets/PII/SQL/auto-retention/bases persistentes e revisão adversarial 26/26: aprovados.

## Findings corrigidos

- A função PostgreSQL foi restringida aos 25 event codes aprovados, além da validação de aplicação.
- O pedido de export passou a reutilizar a validação fechada de filtros, janela, cursor e organização.
- A validação de startup passou a comparar cada entrada com o contrato aprovado completo, recusando alterações de código, classe, residência ou schema.
- Foram corrigidos, durante o desenvolvimento, precisão de `acceptedAt`, policy RLS do owner, teste de mutação, espera de rejeição observacional e expectativa da composição produtiva F5/F7.

## Limites preservados

`Tamper-evident` aplica-se apenas ao trust boundary validado. Owner/superuser pode reescrever e recalcular a cadeia; F7 não implementa HMAC, assinatura, âncora externa, WORM, SIEM, retenção jurídica, legal hold operacional, R2, tenants reais, F4.4/F4.5, rollout ou deploy. A composição produtiva não ativa consumer de export nem sink externo. Backups/RPO/RTO, sizing, alert thresholds, fan-out e operação produtiva continuam gates futuros.

Todas as migrations e provas PostgreSQL foram executadas exclusivamente no container descartável F7 em loopback na porta 5547, com dados sintéticos. As bases persistentes em 5432/5433 não foram contactadas nem alteradas.
