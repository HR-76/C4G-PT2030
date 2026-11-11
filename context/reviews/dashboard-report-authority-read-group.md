# Dashboard — agrupamento das leituras de autoridade

31/10/2026 — implementação e comparação real concluídas, em Review. Redução de trabalho e da mediana observadas; a média HTTP não melhorou.

## Alteração e fronteiras

`backend/src/applications/composition.js` ativa o mecanismo existente `withAuthorityReads` em `report`, conservando `partnersBrowse`. Cada decisão preliminar lê membership e política na mesma transação coordenada. O callback termina antes de política tenant e auditoria; não há cache entre decisões ou alteração dos checkpoints. As duas decisões permitidas passam de quatro para duas admissões/transações coordenadas. `reportExport` e restantes métodos não recebem o novo agrupamento.

A medição distingue estas transações das transações READ ONLY que cada admissão abre para inspecionar o esquema. Ambas devem ser contadas; a diminuição esperada no resumo é duas coordenadas e duas de inspeção, quatro transações físicas no total. Não alterar a instrumentação para ignorar verificações reais.

## Regressões e revisão

O teste da composição real reproduziu quatro falhas antes da alteração (6 PASS / 4 FAIL). Foram acrescentados 12 casos de composição/F5/coordenador/protocolo com infraestrutura controlada: ativação restrita, quatro para duas admissões preliminares, consultas/eventos equivalentes, permissões opcionais, revogação, falhas de leitura/commit/deadline/auditoria, concorrência e reentrância.

Foco inicial: 53 PASS. Suite backend final, após a instrumentação: **2256 PASS / 0 FAIL / 7 SKIP**; frontend **495 PASS**, build PASS. Os sete SKIP não representam prova PostgreSQL. Revisão independente: 38 PASS antes do ajuste do contador, incluindo a leitura de responsáveis partilhada; depois, **9 testes do observador PASS**, com regressão do preflight reproduzida antes da correção. Sintaxe, guard de fontes e whitespace passaram. O incremento acrescenta 21 testes, 12 da composição e nove do observador.

Logs: [RED](../../output/dashboard-report-authority/regression-red.log), [foco](../../output/dashboard-report-authority/focused.log), [backend final](../../output/dashboard-report-authority/backend-suite-completed.log), [frontend](../../output/dashboard-report-authority/frontend-suite.log), [build](../../output/dashboard-report-authority/frontend-build.log). [Verificação consolidada](../../output/dashboard-report-authority/verification.json), [hashes finais](../../output/dashboard-report-authority/final-hashes.json).

## Comparação e proveniência

O host próprio usa a composição de produção, sessão OIDC real, roles e dados locais existentes numa porta loopback efémera. A aplicação habitual, identidade e workers permanecem em execução. Um aquecimento por variante e dez pares alternados AB/BA; nenhuma carga concorrente introduzida pelo ensaio. O tempo HTTP é medido pelo cliente; os contadores e spans começam no router e excluem o middleware global de sessão anterior. A resposta só ignora `generatedAt`, `nextCursor` e `previousCursor` na comparação, sem alegar igualdade de bytes dos cursores.

Baseline original `cec6036997941ebf27a1f4cdef370e7699eda7eed401b6f7cb083bbaa66bf0ca` preservada. Uma alteração paralela introduziu `readResponsibleDirectory`; foi conservada nos dois braços. Baseline derivada `2796dd3fe64ef4482c265f39886331cdd37a5d86c5d3038111aa6da6e8270f4a`; candidato `013800a63552e5112a16ff8af43edcb2dc876049dbc9ef3b3630603f0a2094aa`. Um guard exige que a única diferença seja a condição de agrupamento. [Proveniência](../../test/integration/dashboard-report-authority/fixtures/provenance.json).

Tentativas interrompidas preservadas:

- [Primeira](../../output/dashboard-report-authority/run-2026-10-31T16-22-07-168Z/results.json): sem amostras; o login abre agora o catálogo e o runner aguardava o dashboard. Corrigida a navegação explícita, sem mudar a aplicação.
- [Segunda](../../output/dashboard-report-authority/run-2026-10-31T16-24-16-406Z/results.json): primeiro aquecimento HTTP 200, mas o observador contava apenas `BEGIN` exato e todos os `COMMIT`. A transação READ ONLY de inspeção era omitida na abertura. O ensaio interrompeu antes das amostras e o contador recebeu uma regressão específica. Não houve falha funcional ou redução de verificações de produção.

## Resultado de latência

[Ensaio final e fontes](../../output/dashboard-report-authority/run-2026-10-31T16-26-48-260Z/results.json), [log](../../output/dashboard-report-authority/measurement-counts-corrected.log). **PASS: 22/22 pedidos HTTP 200**, incluindo dois aquecimentos separados e 20 amostras. Dez pares AB/BA; nenhuma amostra medida foi excluída.

| Medida | Antes | Depois | Variação |
| --- | ---: | ---: | ---: |
| Mediana HTTP do dashboard | 5105,49 ms | 4886,73 ms | −218,76 ms / −4,28% |
| Média HTTP do dashboard | 5115,89 ms | 5177,75 ms | +61,86 ms / +1,21% |
| Intervalo HTTP | 4995,85–5256,40 ms | 4788,11–7867,05 ms | — |
| Mediana da etapa relatório | 1890,59 ms | 1700,12 ms | −190,47 ms / −10,07% |
| Média da etapa relatório | 1888,26 ms | 1703,94 ms | −184,32 ms / −9,76% |
| Transações de autoridade observadas / resumo | 35 | 33 | −2 |
| Transações físicas centrais observadas / resumo | 70 | 66 | −4 |
| Comandos centrais observados / resumo | 1142 | 1088 | −54 |

O candidato foi mais rápido em **nove dos dez pares**. O par 2 candidato demorou 7867,05 ms: o relatório ficou em 1673,69 ms, mas o resumo privado demorou 4443,52 ms. Esta é a localização observada do aumento, não uma causa identificada. A amostra foi conservada e elevou a média global. Não declarar melhoria geral de latência nem a demora resolvida com base apenas na mediana.

Todas as respostas funcionais e fingerprints coincidiram. Mantiveram-se **18 snapshots frescos** por pedido, sem falhas, rollbacks ou snapshots pendentes. As transações do relatório passaram de 15 para 13 (30 para 26 físicas); os contadores das restantes três etapas ficaram iguais. As **553 fontes** inventariadas permaneceram estáveis, sem drift de configuração/ledger; cleanup passou. Houve quatro tentativas automáticas de escrita de negócio bloqueadas no browser durante o pré-carregamento, zero erros JavaScript e nenhuma tentativa de medição falhada no ensaio final.

A revisão independente recalculou os resultados, confirmou ordem AB/BA, paridade, populações e contagens. O resultado sustenta uma redução de custo do relatório e um ganho modesto da mediana local; o tempo total continua perto de cinco segundos.

Reprodução explícita, mantendo os pré-requisitos locais e o guard de fontes: `node test/integration/dashboard-report-authority/measure-native.cjs`. O runner não é carregado pelos entrypoints de produção e recusa alterações posteriores incompatíveis com a baseline fixada.

## Preservação e limites

Sem migrations, grants, seed, importações, alteração de configuração, gestão de serviços existentes ou operações Git de publicação. Login/sessão e auditoria normal das leituras são os efeitos esperados. O servidor de ensaio só admite GET do resumo da organização configurada; smoke sem sessão recusado com 401. Todas as tentativas fecharam os recursos próprios. São dados locais, uma organização, pools aquecidos e host partilhado: não constituem capacidade ou SLO produtivos.

Uma consulta posterior de saúde à aplicação habitual encontrou a porta 3000 indisponível, já depois do ensaio e cleanup concluídos. Não se iniciou/parou/reconfigurou esse serviço; a execução operacional 043 é trabalho paralelo. A causa da indisponibilidade posterior não foi investigada neste incremento, e não invalida nem amplia a janela medida.

Próximo passo: reduzir o custo dos três percursos tenant sequenciais, preservando autoridade e auditoria, num incremento separado e novamente medido.
