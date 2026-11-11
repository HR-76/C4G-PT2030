# C6 antes/depois alternado com observação do host

Validação autorizada em 27/10/2026, concluída e em **Review**. A piora C6 anteriormente observada (p95 12,40→19,37 s em momentos separados, +56,13%) **não se reproduziu nos três pares alternados**: o p95 foi menor com agrupamento nos três pares, entre 1,97% e 6,68%. A comparação histórica não isolava o efeito do agrupamento; esta série não sustenta atribuir-lhe aquela regressão. Não demonstra que o host foi a única causa, nem ausência universal de regressão.

**36/36 pedidos e seis aquecimentos PASS**, com fontes, checks, políticas e invariantes conferidos. Os controlos operacionais do host passaram; isso significa condições observadas dentro dos critérios definidos, não um host dedicado. Sem alteração de runtime, limits, SQL, autoridade ou auditoria.

## Resultados por par

[Comparação completa](comparison.json), [análise executada](analysis.log). Milissegundos. Cada linha corresponde a seis pedidos C6; não há falhas excluídas nem repetição escolhida por latência.

| Par | Variante | p50 | p95 | Variação p95 B/A |
|---|---|---:|---:|---:|
| 1 | [A — antes](../c6-ab-1-before/results.json) | 18447,68 | 20622,70 | — |
| 1 | [B — depois](../c6-ab-2-after/results.json) | 17503,14 | 19246,08 | −6,68% |
| 2 | [A — antes](../c6-ab-3-before/results.json) | 15337,91 | 17394,17 | — |
| 2 | [B — depois](../c6-ab-4-after/results.json) | 15207,16 | 16958,37 | −2,51% |
| 3 | [A — antes](../c6-ab-5-before/results.json) | 17625,04 | 19692,22 | — |
| 3 | [B — depois](../c6-ab-6-after/results.json) | 17633,65 | 19305,09 | −1,97% |

Mediana das variações p95 por par: **−2,51%**. Medianas dos p95 dos bursts: A **19692,22 ms**, B **19246,08 ms**; esta é uma estatística diferente da mediana das razões. p50 do terceiro par varia +0,05%: não houve melhoria em todas as métricas. O p95 da mesma versão A varia 3228,53 ms entre bursts, acima de qualquer ganho observado dentro de um par (387,13–1376,62 ms). Não usar os 18 pedidos de cada versão como 18 réplicas independentes; são três bursts, com dependência entre pedidos.

## O que ficou demonstrado

- Todas as fontes A/B efetivamente carregadas correspondem aos hashes fixados. Mesmos checks reais de roles/RLS, isolamento, readiness e login OIDC; mesmas políticas e deadlines.
- Todos os dashboards devolvem total 1000 e uma seleção de candidaturas. Queries **2619→2421**, transações centrais **42→36**, protocolo **198**, audit prepare **10** e append **10** em todas as respostas; estas contagens são determinísticas nesta fixture.
- Sem erros de admissão, SQL ou cleanup; sem queries concluídas após a resposta. Máximo observado **5 ativos e 1 em fila** nas seis execuções, preservando o limite tenant 5 e timeout de admissão 5000 ms.
- O custo médio somado de metadata diminui nos três pares: **10976,66→10134,68**, **9387,04→9316,28**, **10832,04→10408,12 ms**. A parcela de autoridade também diminui nos três; a parcela tenant varia em ambos os sentidos, apesar de manter as mesmas queries.
- Espera somada média SQL pelo lock central diminui **1783,92→1525,11**, **1453,60→1181,78**, **1667,48→1323,62 ms**. Retenção somada central também diminui nos três pares. Não se reproduziu uma penalização sistemática desse lock pelo agrupamento.
- Retenção somada média do lock de auditoria varia **2470,24→2522,85**, **2442,21→2135,19**, **2281,01→2527,58 ms**: sem direção uniforme. Estes tempos sobrepõem-se a outros spans e não se somam à latência HTTP.

## Host e margem de admissão

Plano de energia Equilibrado, Docker **29.7.2**, **24 CPUs** e **33344757760 bytes** de memória Docker, mesmos IDs de imagens nas seis execuções. Os dois contentores preexistentes mantiveram-se ativos e inalterados pelo runner; CPU agregada observada durante C6 no máximo **5,46% de um core**, abaixo do critério de 10%. Nenhuma falha de amostragem. Antes de B1 houve uma janela recusada por CPU **25,20%**; o runner aguardou e a segunda tentativa passou. Essa janela não era um burst descartado; está preservada em `c6-ab-2-after/idle-1.json`.

| Par/variante | CPU global média / máximo | Memória livre mínima GiB | CPU Node média, % de um core | Admissão máxima ms |
|---|---:|---:|---:|---:|
| 1 A | 24,07 / 48,03% | 35,25 | 84,90 | 4712,82 |
| 1 B | 25,61 / 40,43% | 35,16 | 81,29 | 4687,59 |
| 2 A | 29,87 / 61,73% | 34,59 | 80,74 | 2639,67 |
| 2 B | 29,35 / 54,03% | 34,69 | 76,52 | 3854,77 |
| 3 A | 24,85 / 54,14% | 34,74 | 79,75 | 4692,71 |
| 3 B | 24,65 / 44,41% | 34,80 | 84,61 | 4649,52 |

CPU ≤25% era condição **antes** do ensaio, não um limite durante a carga. Os picos durante C6 incluem o benchmark e processos Windows não individualizados. Event loop Node: utilização média 0,72–0,77 e atraso máximo por execução 87,49–139,72 ms. Os pares mostram carga global semelhante em média, mas não provam ausência de interferência externa ou estabilidade térmica.

A margem de admissão continua curta: máximo **4712,82 ms em A** e **4687,59 ms em B**, apenas 287,18/312,41 ms abaixo do timeout. No segundo par, a admissão piora 2639,67→3854,77 ms mesmo com p95 HTTP ligeiramente melhor. Checkout físico tenant tem máximos de 15,02–65,88 ms; não se observou espera física de vários segundos ou erro de pool. A pressão está nas operações/leases e na admissão lógica observadas; não há base para aumentar o pool por este resultado.

**Veredicto:** a regressão histórica de +56% não é reproduzível nesta série alternada e não deve ser apresentada como efeito demonstrado do agrupamento. O agrupamento reduz consultas e tem vantagem pequena de p95 nestes três pares; não elimina o custo de metadata, a variabilidade ou a margem reduzida da admissão. Manter o incremento em Review; sem aprovação produtiva e sem alterações adicionais de runtime justificadas só por estes números.

## Protocolo fixado antes da carga

Três pares A/B, ordem **A/B/A/B/A/B**, seis pedidos concorrentes por burst e um aquecimento excluído por execução. A usa os três ficheiros anteriores a `grouped-authority-validation`; B usa os três atuais. Os outros módulos são os mesmos. O preload verifica hashes e compila esses ficheiros sob os nomes originais, apenas no processo de prova, sem substituir o worktree ou alterar resolução/branding. O resultado regista os módulos efetivamente carregados. SQL, autoridade, RLS, auditoria, limites e deadlines mantêm-se.

Cada execução usa o [profile capacity anterior](../../../test/integration/http-contention/profile.ps1) sem alterações, PostgreSQL/Keycloak descartáveis novos, duas bases tenant e dados sintéticos iguais (1000 candidaturas, 250 pessoas por tenant; C6 num tenant). Só os runners existentes criam/limpam os recursos próprios por UUID e label. O [runner novo](../../../test/integration/c6-alternating/run.ps1) não modifica nem para os dois contentores preexistentes.

Antes de cada execução: plano de energia, configuração e imagens Docker e conjunto de contentores anteriores invariantes; três intervalos de um segundo com CPU total ≤25% e memória livre ≥4 GiB; CPU agregada dos contentores anteriores ≤10% de um core. Há no máximo três tentativas de admissão do host, conservadas em `idle-*.json`. Nenhum processo/serviço do utilizador foi parado e não foram alterados energia, afinidade ou recursos Docker.

Durante a execução: [observador](../../../test/integration/c6-alternating/preload.js) recolhe CPU/memória global, CPU do processo Node e event loop a cada 500 ms; a cada cinco segundos observa separadamente a CPU dos contentores anteriores. Os dois lados têm esta mesma instrumentação. CPU global é normalizada pelos cores; CPU Node/contentores usa escala por core. A comparação não atribui automaticamente CPU total a interferência externa. Não há observação completa de todos os processos Windows, frequência efetiva ou temperatura.

Critérios funcionais: fontes e configuração admitidas, mesma ordem de checks de roles/RLS/OIDC/readiness, políticas iguais, contagens e auditoria esperadas por resposta bem-sucedida, erros conservados nos totais. Por dashboard: A=2619 queries/42 transações; B=2421/36; ambos 198 chamadas de protocolo, dez prepares/appends de auditoria e uma seleção de candidaturas, total 1000. Observar admissão, espera/retensão do pool, locks, metadata e queries depois da resposta.

## Reprodução e artefactos

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/c6-alternating/run.ps1
node test/integration/c6-alternating/analyze.js
```

O runner recusa pastas existentes, para não sobrescrever ensaios. Uma nova série requer novos nomes de relatório e atualização explícita do contexto admitido no preload. [Baseline](baseline.json), [controlo do host](host-control.json) e [log](run.log). Resultados individuais: `context/reviews/c6-ab-{1..6}-{before|after}/`, com results, summary, host-variant e admissões do host. A [análise](../../../test/integration/c6-alternating/analyze.js) valida fontes/contagens/configuração e conserva hashes dos inputs em `comparison.json`.

## Limites do veredicto

Três bursts por variante, não dezoito experiências independentes. O p95 de seis pedidos é o máximo empírico. Quantis agrupados são descritivos; pares preservam a unidade de execução. Ordem alternada, mas não aleatória nem equilibrada quanto à posição: tendência temporal permanece possível. Host partilhado e observação adicional impedem equivalência com séries históricas sem esse observador. Não eliminar resultados contaminados ou falhados para melhorar o resumo. Esta prova não aprova desempenho produtivo.

## Validação e preservação

[Analisador](../../../test/integration/c6-alternating/analyze.js) executado com assertions de hashes carregados, políticas, sequência dos checks, contagens SQL/protocolo/auditoria, quantis, amostras de host e controlo A/B: PASS. [Sintaxe](syntax.json): três JavaScript e um PowerShell PASS. As seis composições reais passaram o gate de roles/RLS/OIDC/readiness do profile. Não foi repetido o gate integral de 108 pedidos nem as suites/build do produto neste recorte, pois nenhum ficheiro de runtime ou contrato HTTP foi alterado. As provas anteriores de revogação/drift/durabilidade permanecem na evidência do agrupamento; a presente série mede C6, não acrescenta novos cenários de revogação.

[Preservação](preservation.json): **2711/2713 hashes estáveis**, apenas `context/current-work.md` e `context/features/http-flows-performance.md` alterados entre os ficheiros existentes. HEAD `0cf519ea22de929d2e52d0b3edb4d72364aa6220` e branch `feat/f13-organizational-profile` preservados. Todos os 466 ficheiros de runtime, 179 frontend, 136 de base/migrations, 14 harness HTTP/profile e quatro do observador de etapas mantiveram o hash. Os ficheiros novos são o harness C6 e os relatórios; hashes das cinco fontes novas incluídos na preservação.

Nenhuma migration, definição de grant/permissão, configuração de deploy, dado Dev ou limite foi alterado. Bases sintéticas exclusivas, com limpeza pelos runners; o conjunto de contentores antes/depois é o mesmo. Sem commit, merge, push ou deploy. A comparação de hashes é sequencial e limitada ao inventário, não uma afirmação de imutabilidade integral do repositório ou dos dados ignorados.

[Pesquisa de padrões sensíveis](artifact-scan.json): 45 artefactos verificados, sem ocorrências, incluindo logs UTF-8/UTF-16LE. Verificação por padrões, sem garantia universal sobre todas as formas de dados sensíveis.
