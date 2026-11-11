# Dashboard da organização — compatibilidade com tenant 034

Estado: Review — 31/10/2026. Correção e testes concluídos; confirmação visual na sessão do utilizador pendente.

## Problema e âmbito

O utilizador reportou HTTP 503 em `GET /api/organizations/:organizationId/dashboard/summary`. O resumo executa relatório, oportunidades privadas, catálogo central e validação final de autoridade. A implementação das oportunidades privadas constrói a lista de versões compatíveis a partir do manifesto base, que termina em 033, enquanto a migração aditiva 034 (`application_snapshot_v2`) já está registada e instalada no ambiente habitual. Os consumidores de candidaturas já admitem explicitamente essa versão.

A consulta de diagnóstico apenas de leitura confirmou que o leitor central e o resumo central funcionam. A reprodução com a composição real e a função de admissão rejeita tenant 034 para `OPPORTUNITY_READ`, aceitando 033 com as mesmas capacidades. Corrigir esta incompatibilidade técnica sem alterar definições de indicadores, contratos HTTP ou arquitetura aprovada.

## Critérios de aceitação

1. Regressão executada antes da correção demonstra a recusa de 034 pela composição real de oportunidades privadas.
2. O catálogo admite explicitamente a versão aditiva 034 aprovada e preserva versões anteriores, capacidades obrigatórias, estados de compatibilidade, isolamento, auditoria e validação final.
3. Versões desconhecidas continuam recusadas. Não admitir automaticamente todas as versões futuras nem contornar verificações de esquema.
4. Testes focados, suites completas backend/frontend, build frontend e verificação sintática dos ficheiros JavaScript alterados; falhas externas registadas separadamente.
5. Não executar migrations, grants, seeds, gates de infraestrutura ou operações Git. A validação HTTP habitual depende de uma sessão autenticada disponível; indicar o limite se não for possível reproduzi-la.

## Validação

- RED: duas falhas reproduzidas antes da correção. A composição real não incluía 034 e o resolver real recusava a admissão antes de obter uma ligação tenant.
- GREEN: 42 testes focados PASS; revisão independente repetiu os quatro testes de admissão, sem problemas acionáveis. Cobertura inclui capacidades obrigatórias, versão desconhecida recusada, membership revogada recusada antes da ligação e verificação do binding físico.
- `npm test` backend: **2222 PASS / 0 FAIL / 7 SKIP**, na árvore de trabalho atual. [Log](../../output/dashboard-schema-backend-tests.log).
- `npm test` frontend: **494 PASS**, 63 ficheiros. [Log](../../output/dashboard-schema-frontend-tests.log).
- `npm run build` frontend: **PASS**. [Log](../../output/dashboard-schema-frontend-build.log). `node --check` nos dois ficheiros JavaScript alterados: PASS.
- As tentativas iniciais das suites no sandbox falharam com `spawn EPERM`; as execuções normais fora do sandbox, aprovadas pelo mecanismo de execução, passaram. Não houve alteração das expectativas dos testes para obter sucesso.
- Diagnóstico habitual READ ONLY confirmou `034_application_snapshot_v2` e estado `COMPATIBLE` para a organização reportada. Leitor e resumo centrais responderam corretamente; `/api/local-health` confirmou API, worker e admissões saudáveis após a alteração.
- A ferramenta de controlo do computador interrompeu a verificação no Brave porque não conseguiu determinar o URL atual com confiança. Não foi possível confirmar visualmente o dashboard nem o HTTP autenticado completo; não contornar esse bloqueio. A correção técnica está coberta pelos testes, mas essa prova de ponta a ponta permanece pendente.

## Alteração e preservação

`backend/src/opportunities/httpComposition.js` acrescenta apenas `tenantAddition.version` ao catálogo compatível. A migração 034 altera constraints de snapshots de candidaturas e preserva as estruturas de catálogo privado. `backend/test/opportunityV2ConsumerAdmission.test.js` inclui a composição de oportunidades na matriz e prova a admissão pelo resolver real com infraestrutura controlada.

As alterações já existentes de `asOf` na composição foram preservadas. Não se alteraram definições de indicadores, frontend, contratos HTTP, migrations, permissões ou dados. Não foram executados gates de infraestrutura, commit, push ou deploy.
