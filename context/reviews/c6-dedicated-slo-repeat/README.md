# Margem de admissão C6 — série equilibrada válida

**PASS do SLO experimental nas duas variantes**, em janela local reservada pelo utilizador. Série de 27/10/2026, 21:27:55–21:41:09 UTC, após corrigir e testar o contador Windows. Ordem **AB, BA, AB, BA, AB, BA**, com fixtures novas: **72/72 pedidos, 12 aquecimentos e 216 admissões**, sem erros. A é a implementação anterior aos três agrupamentos; B é a atual. [Comparação completa](comparison.json), [análise executada](analysis.log) e [protocolo aprovado](protocol.json).

## SLO aprovado antes da carga

O p95 usa nearest rank sobre **108 admissões lógicas medidas por variante**, incluindo tentativas falhadas se existissem; aquecimentos separados. O máximo é verificado em cada burst e no conjunto. Margem observada = timeout inalterado de 5000 ms menos a maior espera. São seis bursts por variante, não 108 experiências independentes.

| Métrica | Limite | A — antes | B — atual |
|---|---:|---:|---:|
| p95 de admissão | ≤3000 ms | **2479,51 ms** | **2505,77 ms** |
| Máximo de admissão | ≤4000 ms | **3137,52 ms** | **2845,84 ms** |
| Margem mínima para timeout | ≥1000 ms | **1862,48 ms** | **2154,16 ms** |
| Erros de admissão / HTTP | 0 | **0 / 0** | **0 / 0** |
| Veredicto numérico e ambiente | ambos válidos | **PASS** | **PASS** |

B tem máximo 291,68 ms menor e margem mínima 291,68 ms maior. O p95 de admissão aumenta ligeiramente, 26,26 ms; não houve melhoria uniforme de todas as métricas. Os dois resultados cumprem o SLO acordado. Na variante atual, todas as esperas também ficaram abaixo de 3000 ms, embora o critério aprovado de máximo fosse 4000 ms.

## Resultados completos por burst

Milissegundos. Seis pedidos e 18 admissões por linha; todos os pedidos devolveram 200 e total 1000. A ordem temporal corresponde à numeração.

| Execução | Par/ordem | Variante | p50 HTTP | p95 HTTP | Máximo admissão | Margem mínima |
|---|---|---|---:|---:|---:|---:|
| [1](../c6-dedr-1-before/results.json) | 1 AB | A | 12097,23 | 13665,19 | 3069,39 | 1930,61 |
| [2](../c6-dedr-2-after/results.json) | 1 AB | B | 10409,03 | 11437,45 | 2834,12 | 2165,88 |
| [3](../c6-dedr-3-after/results.json) | 2 BA | B | 10404,85 | 11532,26 | 2845,84 | 2154,16 |
| [4](../c6-dedr-4-before/results.json) | 2 BA | A | 12538,55 | 13764,78 | 3137,52 | 1862,48 |
| [5](../c6-dedr-5-before/results.json) | 3 AB | A | 11990,41 | 13215,82 | 2790,73 | 2209,27 |
| [6](../c6-dedr-6-after/results.json) | 3 AB | B | 10554,60 | 11686,62 | 2736,06 | 2263,94 |
| [7](../c6-dedr-7-after/results.json) | 4 BA | B | 10168,84 | 11410,18 | 2719,80 | 2280,20 |
| [8](../c6-dedr-8-before/results.json) | 4 BA | A | 11676,22 | 12801,79 | 2890,68 | 2109,32 |
| [9](../c6-dedr-9-before/results.json) | 5 AB | A | 11145,47 | 12573,32 | 2801,57 | 2198,43 |
| [10](../c6-dedr-10-after/results.json) | 5 AB | B | 9761,15 | 10827,96 | 2505,77 | 2494,23 |
| [11](../c6-dedr-11-after/results.json) | 6 BA | B | 9350,94 | 10316,89 | 2597,74 | 2402,26 |
| [12](../c6-dedr-12-before/results.json) | 6 BA | A | 9888,58 | 11192,15 | 2479,51 | 2520,49 |

p95 HTTP de B menor nos seis pares. Mediana das variações por par: **−12,73%**; separadamente **−13,88% em AB** e **−10,87% em BA**. Medianas dos p95 dos bursts: A 13008,81 ms/B 11423,82 ms. A vantagem HTTP não depende apenas de B estar em segundo lugar, mas a sequência determinística e a descida temporal dos tempos impedem inferência causal exclusiva. No último par, o máximo de admissão piora 4,77% em B, embora permaneça dentro do SLO. Quantis agrupados não substituem a análise por burst/par.

## Autoridade, durabilidade e limites

Fontes efetivamente carregadas conferidas contra os hashes anteriores/atuais; o preload só troca os três módulos no processo da prova. Os 12 processos passam os mesmos cinco checks reais: logins/roles e isolamento SQL, FORCE RLS/recusa de writes cruzados, protocolo central fechado, readiness da composição e OIDC/PKCE com seleção da organização. Nenhuma rota ou fonte de runtime foi alterada.

Por dashboard bem-sucedido: **2619→2421 queries**, **42→36 transações centrais**, mantendo **198 chamadas de protocolo**, **dez prepares e dez appends de auditoria**, uma seleção de candidaturas e total 1000. Não há queries concluídas após resposta. Sem erros SQL, de admissão ou cleanup.

Políticas idênticas em todas as execuções; limite tenant 5, timeout de admissão 5000 ms e lease 15000 ms preservados. Máximo observado **5 ativos/1 em fila** nos 12 bursts. O checkout físico tenant tem máximos por burst entre 21,47 e 62,51 ms, muito inferiores à espera lógica de admissão. Tempos SQL/retensões somados sobrepõem-se a outros spans; não representam CPU PostgreSQL nem são aditivos ao tempo HTTP.

## Reserva e observação do computador

O utilizador reservou este computador sem outras tarefas durante a série. PostgreSQL Dev e Collabora ficaram pausados; o runner confirmou o conjunto de contentores e a pausa entre fixtures. Plano Equilibrado, Docker 29.7.2 com 24 CPUs/33344757760 bytes e IDs de imagens constantes. Não foram alterados afinidade, energia, pools ou timeouts. Cada execução só arrancou após três intervalos de CPU global ≤25% e memória livre ≥4 GiB; tentativas recusadas ficam nos `idle-*.json`.

Contador **fractional-double-v2**, 760 amostras na série e **215 processos preexistentes acessíveis observados em todas as amostras**. Durante C6: médias ponderadas de CPU de fundo **2,38–3,43%**, máximos por amostra até **8,67%**, dentro dos limites fixados de 5%/10%. Maior intervalo das amostras C6 1081,21 ms, inferior ao limite de 5000 ms. Memória livre mínima durante C6 **35,37 GiB**. Todos os bursts passam os controlos definidos do ambiente.

CPU global média durante a carga varia 24,41–39,83%; o limiar de 25% é de admissão **antes** da carga. A plataforma Docker/WSL é excluída da atribuição de CPU de fundo por alojar a fixture medida. Processos novos/inacessíveis, temperatura e frequência efetiva não são integralmente observados/controlados. Trata-se de dedicação operacional local na janela acordada, não prova de isolamento físico, infraestrutura produtiva equivalente ou estabilidade futura.

## Primeira tentativa, testes e reposição

A [primeira série](../c6-dedicated-slo/README.md) foi preservada como `INVALID_ENVIRONMENT`: um overload PowerShell arredondava incrementos fracionários de CPU para inteiros. Não aprovaram o ambiente aqueles zeros; o máximo A de 4163,94 ms, fora do SLO, continua registado. A correção explicita double nos argumentos, acrescenta versão verificável e motivou esta repetição completa, com o SLO intacto. Nenhum burst foi selecionado por ter latência favorável.

[Regressão fracionária e observador com atividade real](../c6-dedicated-slo/observer-selftest/result.json) PASS; [seis testes do avaliador SLO](../c6-dedicated-slo/slo-test.log) PASS. O analisador valida fontes, políticas, dados/contagens, SLO aprovado, ordem, finitude/presença das amostras e critérios de ambiente. Evidência e limites do harness em [README](../../../test/integration/c6-dedicated/README.md).

[Reposição final](host-restoration.json) PASS: PostgreSQL Dev e Collabora ativos, sem pausa e **healthy**; zero contentores de prova HTTP restantes. Collabora apresentou saúde transitoriamente desatualizada após retoma e recuperou no ciclo seguinte de 30 s, sem reinício. Não se executou SQL nem operações de dados nas bases Dev; apenas pausa/retoma dos dois contentores. Não houve deploy, commit, merge ou push.

**Conclusão:** a variante atual cumpre o SLO experimental de admissão nesta série equilibrada e conserva margem mínima observada de 2154,16 ms para o timeout de 5 s. A aprovação limita-se à carga sintética C6 e aos controlos observados nesta janela. Não constitui aprovação produtiva nem garante a mesma margem com outros dados, infraestrutura, concorrência ou processos de fundo.

## Confer?ncia final

[Verifica??o cruzada](verification.json), [sintaxe dos oito ficheiros execut?veis](syntax.json) e [preserva??o](preservation.json): PASS. Dos 2750 ficheiros inventariados antes deste incremento, 2748 mant?m o hash e apenas os dois documentos de contexto planeados mudaram; nenhum desapareceu. HEAD e branch iguais. Foram acrescentados nove ficheiros de harness e evid?ncia. N?o foram alterados runtime, frontend, migrations, grants/permiss?es ou configura??o de deploy. A compara??o n?o ? uma garantia at?mica de imutabilidade de todo o reposit?rio ou dos dados Dev.

N?o se repetiram neste incremento as suites globais, build frontend ou o gate integral de 108 pedidos: a execu??o aqui ? a compara??o C6 de 72 pedidos, precedida de doze aquecimentos, com as verifica??es reais de seguran?a da fixture. As provas anteriores de revoga??o/drift/durabilidade permanecem referenciadas no contexto; n?o s?o apresentadas como novas execu??es. [Inspe??o de padr?es de segredos nos artefactos](artifact-scan.json) documenta o ?mbito e as limita??es.
