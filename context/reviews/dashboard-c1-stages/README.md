# Diagnóstico do custo sequencial C1

Investigação autorizada em 27/10/2026, concluída. **36/36 sucessos**, cinco verificações de fixture/roles/OIDC, zero erros de admissão, zero consultas concluídas após resposta. Não houve alteração de runtime; a recomendação está em [dashboard-c1-sequential-cost](../../research/dashboard-c1-sequential-cost.md).

## Evidência

- [Resultados integrais](results.json), [log](profile.log), [resumo do profile](summary.json).
- [Decomposição das etapas e intervalos](stages-summary.json), [análise](analysis.log), [comparação com o profile anterior](control-comparison.json).
- [Observador e reprodução](../../../test/integration/dashboard-c1/README.md).

Execução final: **20:09:32–20:13:13 UTC**, em 27/10/2026, exit 0. Uma primeira tentativa falhou no pré-carregamento Node porque `NODE_OPTIONS` interpretava as barras do caminho Windows; não executou pedidos nem gerou resultados. O caminho do wrapper novo passou a usar barras `/`, o smoke de pré-carregamento passou e a repetição concluiu. [Falha preservada](preload-failure.log). O runner original removeu os contentores exclusivos de ambas as tentativas; a verificação final por labels não encontrou remanescentes.

## C1 por etapa

Quatro amostras, aquecimento separado. Média HTTP **9898,05 ms**, p50 **10143,13 ms**, p95/máximo **10223,32 ms**. A repetição anterior sem o novo observador teve média 9674,32 ms e p95 10642,51 ms. As execuções não isolam o overhead do observador nem a variação ambiental.

| Etapa | Média wall (ms) | Queries | Transações de autoridade |
|---|---:|---:|---:|
| Report | 3817,87 | 979 | 17 |
| Resumo privado | 2698,17 | 722 | 10 |
| Catálogo central | 13,38 | 8 | 0 |
| Contexto final | 2740,45 | 772 | 11 |
| Fora das etapas | 624,32 | 138 | 4 |

As etapas não se sobrepõem. As consultas somam 8665,86 ms, mas a união dos intervalos é 8539,11 ms; a cobertura de metadados é 7355,24 ms, cerca de 74,34% dos 9894,18 ms observados no servidor. Spans inclusivos de metadata não devem ser adicionados aos respetivos pais. O residual fora de queries não é uma medição exclusiva de CPU JavaScript.

Em C1: máximo uma lease ativa/zero em fila; maior admissão 0,21 ms e checkout tenant 0,07 ms. Nenhum frame com espera pelo lock de auditoria; dois frames com espera central. A seleção de candidaturas somou em média 23,59 ms. Mantiveram-se **2619 queries, 42 transações de autoridade e dez prepare+append** por dashboard. Os três holds tenant e todas as validações continuam presentes.

## Restante matriz e validação do observador

| Cenário | Sucessos | p50 / p95 (ms) |
|---|---:|---:|
| Report C1 | 4/4 | 4208,20 / 4464,52 |
| Report C2 | 4/4 | 4342,31 / 4703,77 |
| Report C4 | 8/8 | 5465,63 / 7495,43 |
| Dashboard C1 | 4/4 | 10143,13 / 10223,32 |
| Dashboard C4 | 8/8 | 13146,14 / 14490,39 |
| Dashboard dois tenants C4 | 8/8 | 13112,38 / 13788,36 |

As contagens originais por cenário mantiveram-se: 1117 por report e 2619 por dashboard. Em todos os dashboards, a soma das queries por etapa coincide com o observador original. As quatro C1 passaram as assertions de ordem, ausência de sobreposição das etapas, queries/intervalos completos e transações iguais; a união dos intervalos foi recalculada independentemente. Revisão independente do observador sem bloqueios; JS e parser PowerShell passaram. Não se executaram novamente suites/build ou o gate integral de 108 pedidos, pois não houve alteração da aplicação; a prova integral anterior permanece preservada.

## Conclusão e limites

O maior custo é a repetição das verificações completas ao longo de três operações tenant sequenciais. Paralelizar os 13 ms do catálogo não é a prioridade observada. O primeiro candidato recomendado mantém as chamadas de validação e agrupa só seis pares adjacentes em callbacks centrais curtos: projeção **42→36 transações, 2619→2421 queries**, sem implementar nem prometer ganho de latência. Não agrupar trabalho tenant/prepare/auditoria no callback; manter todas as fronteiras frescas e a durabilidade.

Dados locais sintéticos, 1000 candidaturas/250 pessoas por tenant, quatro C1, sem alternância controlada de versões. O leitor central de fixture usa `pg_read_all_data` e o Keycloak modo desenvolvimento; não existe paridade integral produtiva. A instrumentação adiciona timestamps, ALS, hashes e promises. O ramo com documentos/diretório coordenado não está quantificado. Estes resultados não demonstram desempenho produtivo.

## Preservação

Baseline: HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220`, branch `feat/f13-organizational-profile`, 2217 entradas de estado e 2667 ficheiros com hash. Só os dois ficheiros de contexto ativo foram alterados entre os existentes; os restantes 2665 mantêm os hashes. Nenhuma migration, permissão, fonte runtime/frontend, harness anterior, limite, configuração Dev/deploy ou dado Dev foi alterado. Sem commit, merge, push ou deploy.

[Baseline](baseline.json), [preservação](preservation.json), [validação consolidada](verification.json), [hashes do diagnóstico](diagnostic-hashes.json) e [pesquisa de segredos](artifact-scan.json). A verificação cobre o inventário, não afirma imutabilidade de ficheiros ignorados ou de todo o ambiente.
