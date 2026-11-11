# Repetição HTTP/OIDC integral e dashboard C1

Pedido autorizado em 27/10/2026: repetir o gate de 108 pedidos após as correções de metadados, auditoria e admissão do dashboard, incluindo a regressão C1. Esta etapa valida o código existente; não altera runtime, migrations, grants, dados Dev, limites ou deploy.

## Contrato da prova

1. Executar `test/integration/http-oidc/gate.ps1 -Samples 12 -Scope all -Report http-audit-dashboard-gate`: 25/1000/10000 candidaturas, 25/250/1000 pessoas, browse/report/dashboard, 12 pedidos por percurso/volume, concorrência quatro, nove aquecimentos adicionais. OIDC/PKCE, Axios/AuthProvider, roles/RLS, autoridade e auditoria usam a composição real com dados sintéticos em contentores exclusivos.
2. Repetir `test/integration/http-contention/profile.ps1 -Mode standard -Report http-audit-dashboard-c1` depois do gate e sem cargas de teste simultâneas. O harness existente não seleciona apenas C1: mede 36 pedidos e inclui quatro amostras sequenciais de dashboard C1, além de aquecimento. Conservar também os cenários concorrentes e usar report C1 como referência contextual.
3. Comparar o gate integral com `http-session-epochs/results.json` e C1 com `authority-metadata-contention/results.json` e `audit-dashboard-standard/results.json`. Não misturar instrumentações nem excluir erros dos totais; p50/p95 contam apenas sucessos. O gate não define SLO/p95 máximo: aprovação funcional não significa latência aceitável.
4. Guardar resultados sanitizados, falhas e limites; verificar hashes, limpeza dos contentores próprios e ausência de alterações de runtime/proteções. Não marcar a feature global concluída nem declarar desempenho produtivo por estes ensaios.

## Execução

Baseline: HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`, branch `feat/f13-organizational-profile`, 2203 entradas de estado e 2653 ficheiros com hash. O worktree já estava alterado. [Inventário inicial](baseline.json).

A primeira tentativa terminou antes da fixture por indisponibilidade do motor Linux do Docker Desktop (`ISOLATED_POSTGRES_START_FAILED`). [Log preservado](startup-failure.log). O Docker Desktop foi iniciado em segundo plano; nenhum dado de aplicação foi criado nessa tentativa.

## Gate integral: PASS

Execução entre **19:51:27 e 19:58:24 UTC**, em 27/10/2026, exit 0. [Resultado integral](results.json), [log](gate.log) e [comparação estruturada](comparison.json). **33 verificações funcionais PASS, 108/108 respostas 200**, nove aquecimentos sem falha. A baseline `http-session-epochs` tinha 101/108 sucessos, seis `LEASE_TIMEOUT` e um `POOL_EXHAUSTED`.

| Percurso | Candidaturas | Sucessos antes → agora | p50 antes → agora (ms) | p95 antes → agora (ms) |
|---|---:|---:|---:|---:|
| Browse | 25 | 12/12 → 12/12 | 6384,92 → 5214,70 | 10744,88 → 6865,97 |
| Report | 25 | 11/12 → 12/12 | 8971,80 → 5669,62 | 11110,26 → 7808,30 |
| Dashboard | 25 | 12/12 → 12/12 | 17411,26 → 13430,11 | 21374,77 → 14605,30 |
| Browse | 1000 | 12/12 → 12/12 | 6136,52 → 5322,92 | 10382,15 → 7330,73 |
| Report | 1000 | 11/12 → 12/12 | 8865,01 → 4186,11 | 10851,96 → 7471,35 |
| Dashboard | 1000 | 10/12 → 12/12 | 17098,39 → 13154,56 | 18617,82 → 15084,25 |
| Browse | 10000 | 12/12 → 12/12 | 6869,65 → 5051,65 | 11205,30 → 6918,65 |
| Report | 10000 | 11/12 → 12/12 | 9469,66 → 5517,81 | 9922,12 → 7095,53 |
| Dashboard | 10000 | 10/12 → 12/12 | 15072,58 → 12600,18 | 20700,74 → 14605,92 |

Quantis apenas de sucessos; com 12 amostras, o p95 por nearest-rank é o máximo. Os payloads mínimo/máximo são exatamente iguais à baseline em cada cenário. Todos os sucessos conservaram total igual ao volume, 25 itens e uma seleção SQL de candidaturas. Chamadas `pg` constantes nos três volumes: **1036 browse, 1117 report, 2619 dashboard**; antes eram 1074/1159/2703 por sucesso. A redução de chamadas inclui a deduplicação do incremento anterior. Statements internos das funções SQL não são contados.

As 32 verificações anteriores permanecem; a adicional confirma recusa da renovação quando o prazo idle termina durante a consulta central. Foram exercitados login PKCE, cookies, CSRF/retry, cancelamento do GET na rotação/logout, aplicação da resposta POST, renovação de sessão/epochs, roles/RLS, recusa de acesso cruzado, POST com auditoria e revogação central. Os três registos em `failures` são recusas funcionais deliberadas: `RESOURCE_NOT_AVAILABLE` duas vezes e `ORGANIZATION_MISMATCH` uma vez. Não há falhas de carga, `AUTHORITY_STALE` ou `AUTHORITY_WRITE_PENDING`.

A revogação concorrente foi observada em **tenant-admission**, com commit antes de libertar o lock; a leitura respondeu 503. O dashboard seguinte foi recusado com `409 ORGANIZATION_SELECTION_REQUIRED`. Isto não prova todas as fronteiras finais de revogação. A duração total do gate passou de 563,197 para 417,298 segundos, incluindo fixture/provas/login; não é uma medida de throughput HTTP.

## Repetição C1

Perfil standard separado concluído, exit 0: **36/36 sucessos**, cinco verificações de fixture/roles/OIDC, seis aquecimentos válidos, zero erros de admissão e zero consultas concluídas após resposta. `COMPLETE` foi confrontado com as contagens de erros, não tratado isoladamente como PASS. [Resultados](../http-audit-dashboard-c1/results.json), [resumo instrumentado](../http-audit-dashboard-c1/summary.json), [log](../http-audit-dashboard-c1/profile.log) e [comparação dos três ensaios](c1-comparison.json).

| Dashboard C1, n=4 por ensaio | Antes da alteração | Primeiro ensaio após alteração | Repetição |
|---|---:|---:|---:|
| p50 (ms) | 6344,50 | 8548,92 | **9935,42** |
| p95/máximo (ms) | 7401,16 | 9733,63 | **10642,51** |
| Média (ms) | 6567,63 | 8915,15 | **9674,32** |
| Aquecimento separado (ms) | 7668,36 | 9733,40 | 9693,68 |

Valores individuais da repetição: **10284,65; 9935,42; 10642,51; 7834,68 ms**. Todos os oito valores pós-alteração, nos dois ensaios, excedem o máximo das quatro amostras anteriores. A regressão observada persiste; não é apenas efeito de um máximo isolado. O p50 usado pelo harness com n=4 é a segunda observação ordenada, não a média dos dois valores centrais.

Dashboard C1 conservou **2619 consultas, 42 transações de autoridade, dez prepare+append e três retenções do lock** por pedido. Aquecimentos usam 2641 consultas nos três ensaios. Na repetição, o gestor teve no máximo uma lease ativa e zero em fila, admissão máxima **0,25 ms** e checkout tenant máximo **0,09 ms**. A soma média `audit-held` foi **1482,80 ms**, abaixo dos 2852,61 ms anteriores à alteração; `audit-prepare` somou 11,74 ms por HTTP e as consultas de lock central 49,54 ms. Não há evidência de que fila tenant explique os segundos adicionais em C1.

O tempo SQL somado médio de C1 passou de 8088,28 para 8488,85 ms; estas durações podem sobrepor-se e não são parcelas exclusivas da duração HTTP. Report C1 também variou, com média **4244,54 → 4015,81 → 4486,23 ms**. A perda de sobreposição entre fontes é uma explicação coerente com a implementação e as medições, mas o desenho deste ensaio não fornece uma estimativa causal isolada.

| Outros cenários da repetição | Sucessos | p50 (ms) | p95 (ms) |
|---|---:|---:|---:|
| Report C1 | 4/4 | 4519,12 | 4668,11 |
| Report C2 | 4/4 | 4122,42 | 4764,37 |
| Report C4 | 8/8 | 5343,42 | 7453,20 |
| Dashboard C4 | 8/8 | 12908,78 | 14647,39 |
| Dashboard dois tenants C4 | 8/8 | 12196,73 | 13366,57 |

O dashboard C4 também variou: p95 **18375,89 ms antes → 9835,05 ms no primeiro ensaio → 14647,39 ms agora**. Não se omite esta pioria entre as duas execuções do mesmo runtime. O gate integral e este profile têm instrumentação diferente; as comparações usam apenas a respetiva baseline.

## Limites

Dados sintéticos, amostras pequenas e execuções locais sequenciais, sem alternância controlada de versões nem topologia/SLO produtivos. A comparação integral inclui vários incrementos anteriores; não isola o efeito do buffer de auditoria ou da sequência do dashboard. O leitor central não coordenado da fixture mantém `pg_read_all_data` e o Keycloak usa modo desenvolvimento com TLS; não há paridade integral de privilégios/topologia produtivos. R2, Resend, antivírus, worker de importação e MFA por OTP ficam fora destas provas. As injeções deliberadas de GET/CSRF e relógio controlado de sessões conservam os limites documentados no [harness](../../../test/integration/http-oidc/README.md).

Não foram repetidos testes unitários, suites ou build: não houve alteração de código nesta etapa. Os resultados anteriores continuam documentados no [incremento de auditoria/dashboard](../audit-dashboard-contention/README.md), incluindo três falhas históricas da suite backend. Um gate funcional PASS não elimina a latência observada nem demonstra desempenho produtivo.

## Preservação e conclusão

HEAD e branch preservados. Dos 2653 ficheiros inventariados, só foram atualizados `context/current-work.md` e `context/features/http-flows-performance.md`; os outros 2651 mantêm os hashes. Nenhum ficheiro desapareceu. Runtime, frontend, harnesses, migrations, grants/permissões, limites e configuração Dev/deploy não foram alterados. Os testes usaram exclusivamente dados sintéticos em contentores próprios, removidos após execução; a verificação por labels não encontrou contentores remanescentes. Não houve commit, merge, push ou deploy.

[Preservação](preservation.json), [verificação consolidada](verification.json) e [pesquisa de segredos nos artefactos](artifact-scan.json). A comparação cobre o inventário guardado, não a imutabilidade de todo o ambiente. Logs e artefactos foram pesquisados por padrões de credenciais, sem correspondências.

**Conclusão:** gate integral e profile standard PASS nos critérios exercitados; regressão de latência C1 confirmada. Validação em Review, feature global ainda aberta e sem aprovação produtiva.

Próximo passo: investigar o custo sequencial do dashboard C1, preservando a admissão limitada, as verificações frescas de autoridade e a durabilidade da auditoria.
