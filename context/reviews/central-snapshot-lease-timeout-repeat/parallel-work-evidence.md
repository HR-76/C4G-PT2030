# Trabalho paralelo durante M e o warmup H falhado

31/10/2026 — inspeção histórica apenas de leitura, ao abrigo do [contrato de repetição](../../features/central-snapshot-lease-timeout-repeat.md). **Há sobreposição temporal documentada; a contribuição causal para o `LEASE_TIMEOUT` permanece por determinar.** Nenhum runtime, limite ou artefacto anterior foi alterado. Não foram executados testes, carga ou infraestrutura nesta inspeção.

O [JSON associado](parallel-work-evidence.json) identifica 13 fontes pelos hashes SHA256 dos bytes, separa timestamps explícitos de estimativas e conserva as hipóteses de cada cálculo. Os logs de validação044 são UTF-16LE; os seus hashes coincidem com os registados em `checks-post-lock.json`. Os timestamps do sistema de ficheiros foram observados separadamente e não são autenticados por esses hashes.

## Cronologia da falha H

O braço A, índice 4/par 2, falhou no primeiro aquecimento de `dashboard-c4-two-tenants`, antes das suas oito medidas. O pedido terminou HTTP 503 após 20 479,234 ms, com `metrics.failures=[{code:'LEASE_TIMEOUT'}]`. As duas admissões tinham sido concluídas sem erro; não houve erro SQL registado. Os 172 pedidos medidos anteriores tinham terminado HTTP 200. O resultado FAIL original permanece preservado.

| Atividade | Evidência temporal | Precisão e limite |
|---|---|---|
| Inputs044 preparados para validação | 18:13:13.917 UTC | `capturedAt` explícito. Não representa o início dos testes. |
| Fase do aquecimento falhado | 18:13:15.812–18:13:36.473 UTC | Primeiro/último sample com essa etiqueta; não são os limites exatos do pedido HTTP. |
| Backend044 | Duração 54,5686 s; última escrita 18:14:13.562 UTC | Início aproximado 18:13:18.993 se a escrita final foi direta. Estimativa dependente de buffering/cópia, não timestamp de execução. 2337 testes: 2330 PASS e 7 SKIP. |
| Frontend044 | `Start at 18:13:24`; duração 11,45 s; última escrita 18:13:35.759 UTC | O log não inclui fuso/data. A associação àquele dia/UTC é corroborada pelos artefactos adjacentes e pelo mtime. |
| Gate044 `f4f33a…` | 18:13:30.564–18:16:38.478 UTC | `startedAt`/`finishedAt` explícitos. Primeiro controlo de preparação PostgreSQL: 5808 ms; não há timestamps individuais desse controlo. |
| Build044 | Duração 2,58 s; última escrita 18:13:39.336 UTC | Próximo do fim da fase; não estabelece um intervalo exato de sobreposição. |
| Resumo dos checks044 | 18:14:48.012 UTC | `createdAt` explícito, posterior aos checks. |

O intervalo declarado do gate044 sobrepõe **5909 ms** da fase amostrada do aquecimento. Isso comprova concorrência de execução, não intensidade contínua de CPU nem exatamente 5909 ms de sobreposição com o pedido. A cronologia dos testes fornece evidência adicional de atividade simultânea.

Os dois backups/restauros044 identificados ocorreram às 18:32:43.561–18:33:20.013 e 18:35:35.040–18:36:08.760 UTC. São posteriores à falha; estes artefactos não sustentam uma hipótese de restauro concorrente às 18:13. Não se infere ausência de qualquer outra atividade não registada.

## Sobreposição com M

M decorreu de **17:47:31.692 a 17:51:59.538 UTC**. O gate044 `7d0456…` esteve em execução de **17:47:12.389 a 17:53:31.699 UTC**. Os 267 846 ms do intervalo reportado de M estão integralmente dentro do intervalo reportado desse gate. Ambos têm timestamps ISO UTC explícitos.

O gate inclui esperas e etapas diferentes: esta interseção não significa carga elevada contínua nem quantifica a perturbação de cada amostra. M mantém o seu resultado funcional PASS e os seus valores observados, com o limite de ter sido recolhido durante trabalho concorrente. Uma repetição posterior de H não transforma M numa medição com host reservado.

## Interpretação e calibragem

O [diagnóstico anterior](../central-security-snapshot-ab-analysis/failure-analysis.json) mostra inflação distribuída dos intervalos SQL e do observer. Os intervalos SQL cobrem 96,32% da duração HTTP e os de metadata 81,56%; estas frações sobrepõem-se e não são somáveis. O observer já demorava 470,254 ms no sample das 18:13:25.669 UTC, antes do arranque do gate044. Esse gate, isoladamente, não explica toda a degradação.

A fase amostrada regista cerca de 18,68% de um núcleo para o processo Node, máximo de fila tenant zero e nenhuma sessão bloqueadora observada. Isso não mede CPU global/PostgreSQL nem exclui esperas curtas. Os intervalos do driver incluem execução, transporte, espera e scheduling; os intervalos entre samples não constituem medição de event-loop lag. A hipótese de contenção provocada pelo trabalho paralelo é plausível, mas os dados não isolam nem quantificam essa contribuição.

A repetição deve conservar o runtime e os prazos, a ordem A/B e todos os pedidos, registando horários e contexto do host. Deve evitar testes/builds/gates/análises próprios durante a carga; qualquer observação externa leve de CPU/processos deve permanecer identificada como contexto e não gerir processos alheios. Comparar o resultado novo com o histórico permite avaliar a estabilidade observada sob outro contexto. Não permite concluir retroativamente que a concorrência foi a causa única, que B corrige o timeout ou que o FAIL anterior deixou de existir.

A identificação do prazo efetivo pertence à prova separada do executor: `LEASE_TIMEOUT` por si só não distingue a allocation de 15 s do prazo operacional de 10 s. Este relatório não escolhe uma dessas causas com base na coincidência de horários.
