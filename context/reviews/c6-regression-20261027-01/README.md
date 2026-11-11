# Nova série C6 com gate obrigatório — 27/10/2026

Estado: execução concluída; **gate FAIL — INVALID_ENVIRONMENT**. Pedido do utilizador cumprido: série nova executada, gate aplicado automaticamente e resultados anteriores preservados. Reserva deste computador e pausa/retoma temporária de PostgreSQL Dev e Collabora explicitamente confirmadas para esta execução.

[Protocolo fixado antes da carga](protocol.json): seis pares AB/BA, 12 bursts, 72 pedidos e 12 aquecimentos; mesmos dados sintéticos, limites, autoridade e auditoria. SLO `c6-admission-v1`: p95 de admissão ≤3 s, máximo ≤4 s, margem ≥1 s para timeout de 5 s, zero erros e controlos do ambiente aprovados. Nenhum limiar será relaxado nem uma execução apagada para aprovar o gate.

Destino novo `c6-regression-20261027-01`, bursts `c6-reg1-1-before` até `c6-reg1-12-before` na ordem fixada. Manifests próprios conferidos contra as fontes históricas A e atuais B. Não se altera runtime, migrations, grants/permissões, dados Dev ou deploy. O runner limpa apenas fixtures próprias e retoma os dois contentores no finally, antes de analisar e aplicar o gate.

Critérios: gate automático exit 0/PASS ou falha explicitamente registada, todos os resultados preservados, ausência de drift das fontes/políticas, reposição confirmada do ambiente, métricas por variante e limitações documentadas. Não equivale a aprovação produtiva.

## Resultado do gate

[Gate automático](regression-gate.json): **FAIL**, motivo `INVALID_ENVIRONMENT`; [runner](runner-exit.json) terminou com **exit 1**, depois do finally de reposição. Não houve alteração do SLO, descarte de bursts ou repetição para procurar um PASS. O protocolo guarda o estado pré-gate `COMPLETE_PENDING_GATE`; o veredicto final é o artefacto separado, preservando o hash do protocolo usado na análise.

Série entre **22:19:25 e 22:34:46 UTC/Lisboa**, cerca de **15 min 21 s**. [Conferência](verification.json): **72/72 respostas 200, 216 admissões e 12 aquecimentos**, zero erros HTTP, SQL, admissão ou queries concluídas após resposta. A execução terminou integralmente; isto não aprova o SLO.

| Admissão lógica por variante | Antes (A) | Atual (B) | Critério |
| --- | ---: | ---: | ---: |
| p95, 108 observações | 2639,13 ms | 2341,35 ms | ≤3000 ms |
| Máximo | **4724,00 ms** | **4591,39 ms** | ≤4000 ms |
| Margem mínima para timeout 5000 ms | **276,00 ms** | **408,61 ms** | ≥1000 ms |
| Erros HTTP/admissão | 0 | 0 | 0 |

Ambos os p95 passam, mas **ambas as variantes violam o máximo e a margem**. A análise classifica-as `INVALID_ENVIRONMENT` e conserva `observedCriteriaPass:false`; a invalidação ambiental não apaga o incumprimento numérico. Os máximos A/B ocorreram nos bursts **4/3**, cujos controlos declarados passaram. Não é correto atribuir todas as ultrapassagens à interferência observada noutros bursts.

## Controlos do ambiente

O contador `fractional-double-v2` terminou com **872 amostras**. Houve duas violações dos limites fixados antes da carga:

| Burst | Variante | CPU de fundo média | Máximo por amostra | Violação |
| --- | --- | ---: | ---: | --- |
| 9 | A | 4,99546% | **11,18546%** | Amostra >10% |
| 11 | B | **6,03345%** | **17,27671%** | Média >5% e amostra >10% |

O valor médio do burst 9 arredonda a 5,00%, mas está abaixo de 5%; a sua reprovação deve-se ao máximo por amostra. Os outros dez bursts passam os controlos definidos. Não se retiraram os dois bursts inválidos da série para obter aprovação.

Imagens, recursos Docker, plano de energia e políticas permaneceram iguais dentro da série. Preflights admitidos, memória livre durante C6 ≥33,63 GiB, nenhum erro de amostragem. O observador mede processos preexistentes acessíveis e exclui a plataforma Docker/WSL que aloja a prova; não atribui integralmente processos novos/inacessíveis nem controla temperatura/frequência. A reserva operacional pelo utilizador não elimina processos Windows em segundo plano. Os dados não identificam uma causa exclusiva para a variação de latência.

## Bursts preservados

| # | Variante | Pedidos | p95 HTTP (ms) | Máximo admissão (ms) | Ambiente |
| --- | --- | ---: | ---: | ---: | --- |
| 1 | A | 6/6 | 20116,30 | 4526,51 | PASS |
| 2 | B | 6/6 | 18294,97 | 4366,59 | PASS |
| 3 | B | 6/6 | 18725,56 | 4591,39 | PASS |
| 4 | A | 6/6 | 20184,63 | 4724,00 | PASS |
| 5 | A | 6/6 | 19706,07 | 4615,74 | PASS |
| 6 | B | 6/6 | 9835,84 | 2347,99 | PASS |
| 7 | B | 6/6 | 9902,52 | 2341,35 | PASS |
| 8 | A | 6/6 | 12116,33 | 3007,59 | PASS |
| 9 | A | 6/6 | 11725,18 | 2639,13 | FAIL |
| 10 | B | 6/6 | 10831,54 | 2727,47 | PASS |
| 11 | B | 6/6 | 17292,83 | 4518,78 | FAIL |
| 12 | A | 6/6 | 19407,54 | 4468,63 | PASS |

[Comparação completa](comparison.json): mediana da diferença pareada do p95 HTTP B/A −9,98%; AB −9,05%, BA −10,90%. São estatísticas descritivas de uma série ambientalmente inválida, não um efeito causal demonstrado nem recuperação aprovada. Seis bursts por variante não equivalem a 36 experiências independentes. Não comparar diretamente esta série com a anterior como se as condições não tivessem variado.

## Autoridade, preservação e reposição

As cinco verificações reais da fixture passaram nos 12 processos: roles/logins SQL, FORCE RLS e recusa de operações cruzadas, protocolo central fechado, readiness da composição e OIDC/PKCE. **198 chamadas de protocolo, dez prepares e dez appends** por pedido; queries/transações **2619/42 em A e 2421/36 em B**. Limites/pools iguais à política aprovada; nenhum relaxamento de autoridade ou durabilidade. Esta execução não repete todas as provas independentes de revogação/drift nem o gate global de 108 pedidos.

Os [15 testes focados antes da carga](tests-before.log) passaram. Alterações do harness limitadas aos novos destinos/manifests e ao estado de execução final antes do gate; [snapshot dos executáveis](harness/) e [hashes](source-verification.json) preservados. [Sintaxe](syntax.json) aprovada. Nenhuma alteração de runtime, frontend, migrations, grants/permissões ou deploy; sem SQL/operações de dados nas bases Dev. Apenas pausa/retoma dos dois contentores, sem reinício. [Baseline e preservação](preservation.json) conferem ficheiros existentes; não constituem snapshot atómico dos dados Dev.

[Reposição](host-restoration.json) **PASS**: ambos os serviços running, unpaused e healthy, zero contentores de prova restantes. O Collabora recuperou a verificação de saúde no ciclo posterior à retoma, sem intervenção adicional. A janela reservada terminou e o utilizador foi informado. Sem commit, merge ou push.

Conferência final: dos 2898 ficheiros existentes inventariados, **2892 mantêm o hash** e apenas seis ficheiros previstos de harness/contexto mudaram; nenhum desapareceu. HEAD/branch iguais, executáveis mantêm os hashes usados na prova e resultados históricos intactos. [Inspeção de padrões de segredos](artifact-scan.json): 103 ficheiros em 13 diretórios, sem ocorrências; ver limitações do scanner no artefacto.

O gate funcionou como critério obrigatório e impediu aprovação desta série. O SLO permanece incumprido nos máximos observados; investigação posterior deve tratar a variação de admissão e a interferência do host sem aumentar limites nem reduzir validações. Não se executou uma nova repetição após o FAIL.
