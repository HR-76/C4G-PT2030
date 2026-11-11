# F12 — Addendum F5/F7/F9 para replay

Estado: **Aprovado** em 2026-10-10. Este addendum acrescenta decisões; não reescreve F5, F7, F9 ou F12 históricos.

## Autorização fechada

Replay é uma ação humana, sensível, explícita, one-shot e com dupla autoridade. O requester usa `ASYNC_JOB_REPLAY` / `async_job.replay`; o approver distinto usa `ASYNC_JOB_REPLAY_APPROVE` / `async_job.replay_approve`. Ambas exigem membership F3 ativa na organização da execução, grant positivo explícito, `RECENT_MFA` até 300 segundos e revalidação das versões de policy, grants e revogação. `SERVICE`, `SUPPORT`, perfis produtivos, wildcards e grants implícitos são recusados.

A aprovação liga `replay_request_id`, organização, execução original/root, job type, content digest, requester/approver e memberships, policy/revocation versions, aprovação e `not_after`. É válida no máximo 300 segundos, nunca além das evidências MFA, e é consumida uma vez. A allowlist inicial contém somente `opportunity.duplicate.scan` → `OPPORTUNITY_DUPLICATE_SCAN_JOB` e `opportunity.catalog.reconcile` → `OPPORTUNITY_CATALOG_RECONCILE_JOB`. O worker reautoriza separadamente a permission service-only do job.

## Auditoria F7 v2

`f12-events-v2` preserva o catálogo anterior e acrescenta exatamente `ASYNC_REPLAY_REQUESTED`, `ASYNC_REPLAY_APPROVED` e `ASYNC_REPLAY_EXECUTION_CREATED`, todos `CRITICAL_PRE_EFFECT`. `ASYNC_REPLAY_AUTHORIZED` continua reconhecido apenas para leitura histórica e não é emissível pelo workflow novo.

Pedido e aprovação residem na Central e são atómicos com o replay request e approval evidence. A criação reside em `SOURCE_LOCAL`: tenant para os dois jobs F12 e Central apenas para jobs Central. O evento de criação é atómico com a outbox `LINEAGE_V1/REPLAY`. Payloads admitem somente códigos/versionamento fechados; dados funcionais, texto livre, assurance/approval raw, PII, secrets, SQL, DSN e stacks são proibidos.

## Coordenação

Central transita o pedido por `REQUESTED → APPROVED → RESERVED → CONSUMED`. A reserva fixa um único execution ID e os bindings aprovados. Crash após reserva reutiliza esse execution ID; crash após outbox reconcilia a existência tenant e converge a `CONSUMED`. Não existe transação distribuída nem libertação automática sem reconciliação.

## Lineage e replayability

Somente execuções `LINEAGE_V1`, terminais e explicitamente replayable pela taxonomia F9 podem ser selecionadas. Legacy v0, sucesso, ativa, retry pendente, cancelada, incompatível/poison, cross-organization ou uncertain não reconciliada são recusadas. O replay cria novo execution/envelope digest, conserva root, content digest e idempotency identity, usa `previous_execution_id` e recomeça `attempt=1`.

## Aprovação humana registada

Ficam aprovados os dois operation/permission codes F5, os três eventos F7 v2, a allowlist dos dois jobs F12, o protocolo Central→source-local e todos os requisitos de startup, idempotência, MFA, SoD, residência, atomicidade e testes enunciados na aprovação de 2026-10-10.
