# LEASE_TIMEOUT — diagnóstico e repetição integral H

31/10/2026. [Contrato](../features/central-snapshot-lease-timeout-repeat.md). Este incremento preserva a [campanha anterior FAIL](central-security-snapshot-sql-performance.md) e acrescenta uma repetição integral previamente definida no mesmo pacote043/tenant034. Não altera código runtime nem a instalação habitual044.

## Diagnóstico do pedido anterior

O aquecimento A4 de `dashboard-c4-two-tenants` falhou com HTTP503/SERVICE_UNAVAILABLE e código interno `LEASE_TIMEOUT`. Era um pedido sequencial do tenant0: a medição C4 desse cenário ainda não tinha começado. Foram observados2005 comandos SQL sem erros SQL; união de intervalos SQL19,727s (96,32% dos20,479s HTTP), metadados16,702s, fila tenant zero e nenhum bloqueador nas amostras. A própria consulta do observer atingiu515ms; a maior lacuna sem SQL foi58ms. Os valores provêm do [diagnóstico bruto preservado](central-security-snapshot-ab-analysis/failure-analysis.json).

A reconstrução distingue três limites. A allocation dura15s desde a entrega do checkout; a operação `OPPORTUNITY_READ` tem10s desde `execute`, limitada pelo tempo restante da allocation. O mesmo valor `remaining` arma o timer JavaScript e parametriza `SET LOCAL statement_timeout`; este último limita cada comando PostgreSQL, não a operação inteira. O hash do statement da segunda lease corresponde exatamente a `SET LOCAL statement_timeout TO '10000ms'`.

O dashboard executa `report → privateSummary → publicSummary → dashboardContext`; a segunda lease pertence a `OPPORTUNITY_READ` de `privateSummary`. O COMMIT Central da preparação termina em10208,546ms do pedido e a primeira transação de execute começa em10208,990ms. O timer de10s terá sido armado nesse intervalo, com vencimento em20208,546–20208,990ms. O COMMIT tenant conclui em20087,059ms; a ligação é libertada aproximadamente em20209,892ms. A finalização da autoridade (`authorityGuard.complete`) ainda executava trabalho Central nesse intervalo. A resposta é fechada aproximadamente em20474,456ms. A [cronologia com hashes](central-snapshot-lease-timeout-repeat/timeline-corrected.json) corrige quatro referências de linha, preservando o original registado antes de H e todos os dados numéricos.

Esta cronologia e o código sustentam, com elevada confiança, **expiração do prazo operacional de10s durante a finalização da autoridade após COMMIT**, ainda dentro dos15s da allocation. Não existe no trace original o timestamp direto de disparo do timer; essa parte permanece reconstrução. Não foi um cancelamento observado pelo `statement_timeout` PostgreSQL: não houve erro SQL nem ROLLBACK tenant. O COMMIT de uma leitura pode incluir auditoria; não equivale a afirmar uma escrita funcional do utilizador.

O executor rejeita a corrida com `LEASE_TIMEOUT` e inicia `release(discard)`; não contém cancelamento explícito de todas as promises pendentes. Trabalho Central continuou depois do release e antes da resposta. Logo, não descrever a operação como uma transação integralmente abortada. A autoridade continua obrigatória até ao desfecho e o erro não foi convertido em sucesso.

Os [artefactos de trabalho paralelo](central-snapshot-lease-timeout-repeat/parallel-work-evidence.md) documentam testes frontend/backend044 e um gate044 em sobreposição com o warmup. A degradação já aparece antes do início do gate. Há concorrência de execução comprovada, sem telemetria suficiente para atribuir quanto do atraso resulta dela; PostgreSQL, transporte e agendamento não são separáveis por estes traces. M anterior também coincidiu com outro gate044. A repetição H não remove essa limitação histórica de M.

## Prova e repetição

A [prova determinística externa](central-snapshot-lease-timeout-repeat/deterministic-result.json) passou cinco casos e sintaxe, carregando o executor congelado com relógio/scheduler e dependências controladas: prazo de10s vence allocation15s; preparação de6s deixa9s; expiração durante finalização após COMMIT; controlo com revalidações frescas; recusas de membership/guarda sem COMMIT. O erro do caller permanece definitivo mesmo se a finalização pendente terminar mais tarde. Não é medição de desempenho, nem uma substituição das provas SQL/HTTP de autoridade.

H usa o runner comum original, prontidão histórica verificada e nova prontidão HTTP/OIDC por braço. Ordem A/B, B/A, A/B, B/A; seis cenários,288 medidas,56 aquecimentos e136 controlos previstos. Limites de operação, lease, pools, concorrência e fases mantidos. Sem testes/builds/análises pesadas próprios durante a carga; host não reservado e atividade alheia não gerida. Os snapshots prévios do host não demonstram exclusividade durante a campanha.

## Resultado da repetição

Campanha `d985b1ab15814078b80f3a67d72b113a`: **PASS**, exit0, oito braços e quatro pares completos,288/288 medidas HTTP200,56/56 aquecimentos HTTP200 e136 controlos de prontidão. Zero503, timeouts, falhas funcionais ou métricas incompletas. O [relatório bruto](../../output/central-snapshot-ab-5b9e4e70caa94f49a881fc11b39a47bb/evidence/d985b1ab15814078b80f3a67d72b113a/report.json) foi analisado com o mesmo analisador SHA256 `5cc3973d8be7fc800e93b1038233d19a03b7c37b81771a7b2dd0c9a1f0fbf137`, em modo integral de quatro argumentos. [Análise VALID](central-snapshot-lease-timeout-repeat/analysis-c6708a3d5649467fb9acebdcd0d67f9f/summary.json), zero inconsistências, sem pares excluídos ou medidas sem par. Os14 artefactos incluem CSV por pedido, aquecimento, par e cenário.

P50/p95 agrupados de todos os quatro pares, em segundos; a variação é `(B/A−1)×100`, calculada sem arredondamento prévio. Os24 pares de cenário têm p50 e p95 inferiores em B.

| Cenário | n por braço | p50 A → B | Variação p50 | p95 A → B | Máximo A → B |
|---|---:|---:|---:|---:|---:|
| Relatório C1 | 16 | 3,918 → 3,468 | −11,48% | 4,017 → 3,558 | 4,017 → 3,558 |
| Relatório C2 | 16 | 4,204 → 3,630 | −13,65% | 4,744 → 4,188 | 4,744 → 4,188 |
| Relatório C4 | 32 | 4,905 → 4,080 | −16,83% | 6,684 → 5,821 | 6,755 → 6,141 |
| Dashboard C1 | 16 | 9,564 → 8,153 | −14,76% | 9,706 → 8,335 | 9,706 → 8,335 |
| Dashboard C4 | 32 | 10,719 → 9,619 | −10,26% | 12,642 → 11,429 | 12,976 → 11,575 |
| Dashboard C4, dois tenants | 32 | 10,881 → 9,579 | −11,96% | 11,975 → 10,334 | 12,013 → 10,347 |

O aquecimento equivalente do índice4/A respondeu200 em9,200s, contra o503 anterior em20,479s. Completou as três leases e2841 comandos/113 transações; o pedido interrompido tinha apenas duas leases e2005/82. O maior SQL Central observado passou de1,443s no pedido falhado para54,990ms na nova observação. É uma comparação descritiva de dois pedidos, sem inferência causal ou exclusão do erro anterior.

## Custos restantes e preservação da autoridade

O [derivado com método e hashes](central-snapshot-lease-timeout-repeat/derived-costs-repeat.json) usa todos os quatro pares. Em B/C1, mediana da fração de metadados por pedido: **75,11% no relatório e76,23% no dashboard**; uniões medianas2,606s/6,213s. Os dois SQL alterados representam1,549s/3,326s, ou44,71%/40,88%. A consulta base Central custa0,949s/2,057s e a de segurança0,599s/1,279s. Não somar medianas ou spans sobrepostos; estes tempos incluem execução, transporte e esperas, não CPU PostgreSQL.

As12 combinações cenário/braço mantêm exatamente as contagens: relatório1195 comandos/52 transações/25 checkpoints Central/50 SQL de autoridade/3 observações tenant; dashboard2841/113/53/106/9. Zero consultas terminadas após resposta nas288 medidas. Fontes dos guardas, coordenador e limites continuam idênticas em A/B. Os hashes da evidência original de paridade042/043 e das oito provas reais de deriva após lock foram conferidos como pré-condição; essas provas SQL não foram reexecutadas neste incremento. Os checkpoints continuam ativos em todos os pedidos, sem substituição ou redução.

Em B/C4, p50 da aquisição de lock153ms no relatório,299ms no dashboard e269ms com dois tenants. Fila tenant observada zero; p95 da soma de espera de checkout por pedido31/73/48ms, e da aquisição do manager13/16/10ms. A auditoria mantém uma cauda relevante: união `audit-prepare` p95 de1,538s/1,523s/0,528s, contra medianas39/52/11ms. A evidência não justifica aumentar pools ou timeouts; continua a apontar para reduzir o custo das consultas de metadados preservando a autoridade.

## Verificação e limites do fecho

A [conferência independente](central-snapshot-lease-timeout-repeat/final-verification.json) confirmou oito hashes de relatórios filho e igualdade com o parent,1844 fontes por braço/18 comuns, arquivos e38 versões de dependências por braço, nove inputs registados intactos e os FAIL históricos preservados. **16 contentores próprios ausentes**, oito processos com saída verificada, nenhuma terminação forçada. Nenhuma alteração runtime, migration, configuração, serviço habitual, commit ou deploy neste incremento.

Os cinco testes de diagnóstico e a verificação de sintaxe correram antes de H. As suites/backend/frontend/build do pacote são as provas originais verificadas; não se repetiram sem alterações runtime. A revisão independente dos resultados encontra-se em [independent-review.json](central-snapshot-lease-timeout-repeat/independent-review.json). O [descritor novo](../references/performance/central-snapshot-lease-timeout-repeat.json) liga inputs, diagnóstico, execução, análise e fecho; o descritor histórico permanece inalterado.

Esta repetição satisfaz a aceitação integral H deste pacote043/tenant034. A campanha anterior continua FAIL/incompleta. M continua a sua medição original, com a sobreposição de trabalho044 agora documentada; não foi repetido nem reclassificado como host reservado. O sucesso novo não demonstra resolução permanente de lentidão externa, certificação de capacidade/C6 ou comportamento habitual044. Quantis nearest-rank; p95 por par com4/8 observações coincide com o máximo. A amostra permite diagnóstico e comparação, não estimar uma taxa rara de falhas em produção.

Estado: diagnóstico concluído e repetição H integral PASS, com limites de causalidade explícitos.

Próximo passo: reduzir o custo repetido dos metadados num novo A/B, mantendo a autoridade fresca e todos os limites.
