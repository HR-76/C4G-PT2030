# Timeout do preflight exterior

**Review — 28/10/2026.** Correção isolada no harness; nenhuma nova execução PostgreSQL. [Contrato](../../features/partner-postgres-gate.md), [runbook](../../../test/integration/partner-portal/README.md), [verificação](verification.json).

## Problema e correção

P2 — `test/integration/partner-portal/environment.js:145`: a chamada exterior de `preflightTenant` omitia `timeoutMs`, obrigatório em `backend/src/security/tenantMigrationPreflight.js:568`. A biblioteca recusava a chamada com TypeError antes de adquirir ligação. A causa era a utilização incompleta do contrato da função no harness; não era ausência de permissões ou falha de RLS.

Alteração de uma linha: passar `undefined` no terceiro argumento para manter o manifest por omissão e `{ timeoutMs: 15000 }` no quarto. O mesmo orçamento já é usado nos preflights do provisionador. Configura `statement_timeout` por statement; não é um timeout total de aquisição/preflight e não altera o deadline global de setup, o runtime, autoridade ou contratos HTTP.

A omissão foi descoberta separadamente e não explica a segunda tentativa, que terminou antes, em `TENANT_ENSURE`. Essa causa continua por identificar.

## Regressão e validação

O novo teste falhou antes da correção porque recebeu `undefined` em vez de `{ timeoutMs: 15000 }`. Após a correção, executa o environment e o preflight reais com driver/fixtures controlados: confirma uma aquisição, BEGIN READ ONLY, `set_config` com `15000ms`, falha branded injetada na verificação seguinte, ROLLBACK e release antes do fecho dos três pools. Central é fechada e a identidade do erro primário/diagnóstico seguro é preservada. Não se abrem sockets nem se executa SQL real.

| Validação | Resultado |
| --- | --- |
| Regressão nova | 1 PASS, após RED funcional |
| Foco de parceiros | 187 PASS / 0 FAIL / 0 SKIP |
| Backend `npm test` | 1525 PASS / 0 FAIL / 7 SKIP; baseline 1524/0/7 |
| Frontend `npm test` | 346 PASS, 55 ficheiros |
| Frontend `npm run build` | PASS |
| Sintaxe | PASS nos dois ficheiros JavaScript alterado/adicionado |
| Revisão independente | PASS, sem achados materiais pendentes nesta alteração |
| Manifest | 1013 fontes; revisto apenas o hash de `environment.js` |

Sete SKIP PostgreSQL e mensagens esperadas de navegação jsdom/chunk sintético são preexistentes. Sem falhas novas nas suites. Sem medições de desempenho antes/depois: a correção apenas completa o argumento obrigatório no harness, fora do runtime.

## Ficheiros e preservação

- `test/integration/partner-portal/environment.js`: argumento em falta.
- `backend/test/partnerPreflightTimeout.test.js`: regressão nova.
- `test/integration/partner-portal/sources.json` e `README.md`: manifest revisto e instruções.
- `context/features/partner-postgres-gate.md`, `context/current-work.md`: estado do incremento.
- `context/reviews/partner-preflight-timeout/README.md` e `verification.json`: registo.

Branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`; baseline 2606 entradas no worktree e 30980 ficheiros. Inventário de metadados e fontes conferidos; build/cache frontend regenerados pela validação. Sem remoções ou alterações inesperadas. As [primeira](../partner-portal-pg-f8ca4c45e35a826640ac25d2f8fa97ef/README.md) e [segunda](../partner-portal-pg-a7dc74a8441914bb00646b077a009ce9/README.md) tentativas e respetivos manifests permanecem intactos.

**Runtime, protótipo, migrations, grants/permissões e dados Dev preservados.** Sem Docker/SQL real, commit, merge, push, deploy ou integração. As provas PostgreSQL de snapshot, RLS, revogação, cleanup e capacidade permanecem pendentes; esta regressão não as substitui.

**Próximo passo:** executar nova tentativa no âmbito isolado já autorizado, preservando as duas falhas anteriores.
