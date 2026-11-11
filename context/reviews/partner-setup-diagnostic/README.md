# Diagnóstico seguro do setup PostgreSQL

**Review — 28/10/2026.** Correção do diagnóstico do harness; sem nova tentativa PostgreSQL. [Contrato](../../features/partner-postgres-gate.md), [runbook](../../../test/integration/partner-portal/README.md), [verificação](verification.json). A [primeira tentativa FAIL](../partner-portal-pg-f8ca4c45e35a826640ac25d2f8fa97ef/README.md) permanece intacta.

## Problema e alteração

P2: o setup falhou antes de devolver o environment e o runner conservou apenas `GATE_FAILED`, sem fase ou classificação segura. A causa funcional da falha original continua desconhecida; não foi inferida nem corrigida neste incremento.

`environment.js` regista a fase antes de cada operação importante, o tenant sintético A/B quando aplicável, o estado e uma classificação por lista permitida. Só códigos SQLSTATE/conexão/dependência/asserção explicitamente previstos são copiados; restantes ficam `UNKNOWN` com código nulo. TypeError/RangeError têm categoria fixa. Nenhuma mensagem, stack, SQL, nome de recurso, URL ou credencial é exportada. O erro original é relançado; uma falha secundária de fecho não o substitui.

`gate.js` recolhe o campo aditivo `setupDiagnostic`. O código exterior passa intencionalmente a `ENVIRONMENT_SETUP_FAILED` para falhas diagnosticadas, sem reproduzir códigos arbitrários. `ENVIRONMENT_SETUP_TIMEOUT` mantém precedência, mesmo quando o erro primário já ocorreu e o fecho ainda está em curso. Os critérios de PASS e os contratos públicos da aplicação não mudaram.

`localCleanup` indica apenas o estado/retorno da rotina de fecho. Não prova a inexistência de todas as ligações, não altera `cleanup.environmentClosed` e não substitui o cleanup físico do contentor ou os testes de cursores. O progresso é mantido em memória e persistido pelo runner nos checkpoints/final; morte abrupta do processo continua sem garantia de diagnóstico persistido.

## Regressões e validação

Quatro testes iniciais executados antes da implementação: **0 PASS/4 FAIL**, por diagnóstico ausente, mantendo o erro original e o fecho observáveis. Acrescentados controlos de fase tenant, código exterior e timeout durante cleanup; a regressão do timeout falhou antes da respetiva correção. Sete testes finais aprovados, com canários sintéticos para verificar ausência de fuga de conteúdo. Os testes compilam o environment real com apenas as dependências de infraestrutura substituídas; nenhum socket ou SQL é usado.

| Verificação | Resultado |
| --- | --- |
| Novas regressões | 7 PASS |
| Testes focados de parceiros | 159 PASS / 0 FAIL / 0 SKIP |
| Backend `npm test` | 1497 PASS / 0 FAIL / 7 SKIP; baseline 1490/0/7 |
| Frontend `npm test` | 346 PASS, 55 ficheiros |
| Frontend `npm run build` | PASS |
| `node --check` | PASS nos três ficheiros JavaScript alterados/adicionados |
| Manifest | 1011 fontes; apenas `environment.js` e `gate.js` com hashes revistos |

Os sete SKIP PostgreSQL e mensagens esperadas jsdom/chunk sintético são preexistentes. Não há novas falhas nas suites. Sem medições de desempenho antes/depois: a alteração é de diagnóstico do harness, fora do runtime, e não houve carga real.

## Ficheiros e preservação

- `test/integration/partner-portal/environment.js`: fases, classificação e fecho local.
- `test/integration/partner-portal/gate.js`: recolha do diagnóstico e código exterior seguro.
- `backend/test/partnerSetupDiagnostic.test.js`: sete regressões.
- `test/integration/partner-portal/sources.json`: manifest revisto conscientemente após os testes, mantendo o arquivo anterior.
- `test/integration/partner-portal/README.md`, `context/features/partner-postgres-gate.md`, `context/current-work.md`: contrato, estado e instruções.
- `context/reviews/partner-setup-diagnostic/README.md` e `verification.json`: resultados deste incremento.

Branch `feat/f13-organizational-profile`, HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`; baseline 2593 entradas no worktree e 30967 ficheiros. Conferência por inventário de metadados e manifest de fontes; build/cache frontend regenerados pela validação. Sem alterações inesperadas ou remoções. A evidência da primeira tentativa não foi alterada.

**Runtime, protótipo, migrations, grants/permissões e dados Dev preservados.** Sem Docker, SQL, commit, merge, push, deploy ou integração neste incremento. As provas reais de snapshot, RLS, revogação, cleanup e capacidade continuam pendentes. Os códigos desconhecidos são deliberadamente pouco detalhados; poderão exigir nova classificação segura depois de observar a fase real, nunca exposição do erro bruto.

**Próximo passo:** executar nova tentativa no âmbito isolado já autorizado, com este diagnóstico e novo diretório de evidência, preservando a primeira falha.
