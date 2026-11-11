# Otimização SQL do snapshot tenant — revisão A/B

31/10/2026. **Review: ganho M demonstrado; H reprovado.** O SQL reduz a mediana do snapshot tenant completo em 6,7–7,6%, com as mesmas consultas de segurança. H registou todas as 288 tentativas, mas uma terminou com HTTP503/`LEASE_TIMEOUT`; o p95 do dashboard C1 também piorou. A melhoria local não resolve o problema global de latência nem aprova esta campanha HTTP.

## Alteração e proveniência

O [contrato](../features/tenant-snapshot-sql-performance.md) autoriza um incremento mínimo: produzir a definição das constraints PostgreSQL NOT NULL canónicas diretamente a partir do catálogo, com `quote_ident` e as mesmas guardas já usadas no coletor Central. O deparser e as recusas existentes permanecem para os restantes casos. Não foram alterados fingerprints esperados, manifests, migrações, permissões, leases, funções restritas, checkpoints ou contratos HTTP.

O novo A reproduz os bytes da variante B anteriormente validada de `central-snapshot-ab-58f2f8910abee80f`, com source digest `30005d5709224972d241530ff197282a75826ada308f7a3699e07b73002c952c`. B altera apenas um ficheiro de runtime: `backend/src/security/tenantSchemaFingerprint.js`. O candidato tem SHA256 `cca3fb20fd8ce602f5e660caf5756b37bf92abbe53ad371c96bbe01345f35311`; os overlays de testes e o harness têm proveniência separada.

O pacote corrente é [tenant-snapshot-ab-75babcee99ce418a](../../output/tenant-snapshot-ab-6e878cc249d44bf09781c51e856aa711/ab.json). O manifesto tem prefixo SHA256 `f646bd…`; o digest B tem prefixo `fca8ee…`. Os valores completos e os inventários estão no manifesto. A contém 1844 fontes; B contém 1845, incluindo a adição de uma regressão. O workspace conserva o agrupamento paralelo de segurança tenant 25→9; o candidato medido conserva 25 consultas por snapshot, das quais 24 são consultas de segurança. Os resultados deste ensaio dizem respeito a Central043/tenant034, sem extrapolação para o runtime habitual044.

O [registo do patch](../../output/tenant-snapshot-sql-development/implementation-verification.json) preserva RED/GREEN, hashes e diferenças das aplicações separadas ao workspace e ao candidato congelado. A [compatibilidade do observer](../../output/tenant-snapshot-sql-development/observer-verification.json) foi corrigida apenas no helper de diagnóstico e nos seus testes: aceita as duas projeções SQL exatas e reconstrói os sete constituintes da projeção recebida. Os outros seis SELECTs, argumentos de schema e consultas de segurança mantêm-se; SQL desconhecido ou uma guarda enfraquecida continuam recusados.

## Validação e prontidão

A [validação completa do candidato](../../output/tenant-snapshot-ab-f17648b8254449cca9f0039db628b2d0/evidence/local-validation/result.json) terminou com backend **2264 PASS/7 SKIP**, frontend **494 PASS** e build PASS. A árvore de validação contém 1847 inputs, incluindo três overlays de testes Central provenientes do common.zip pai pinado; o runtime é exatamente B. A [validação do workspace](../../output/tenant-snapshot-sql-development/workspace-validation.json) terminou com backend **2359 PASS/7 SKIP**, frontend **496 PASS** e build PASS. Os dois contextos mantêm as suas diferenças de fontes e não são tratados como a mesma versão.

A primeira [prontidão do pacote f17648…](../../output/tenant-snapshot-ab-f17648b8254449cca9f0039db628b2d0/evidence/cceaeeb58642414f9611d8f8ff1a373d/report.json), identidade com prefixo `653849…`, terminou **FAIL** no dashboard do tenant1 do braço B. Os gates Central/tenant e HTTP A tinham passado; B tinha cinco respostas anteriores com HTTP200. A falha ficou como `ERR_ASSERTION`, sem status, duração ou métricas da tentativa falhada. A causa permanece **desconhecida**; não há evidência suficiente para a classificar como `LEASE_TIMEOUT`. O [diagnóstico preservado](../../output/tenant-snapshot-sql-development/failed-readiness-diagnosis.json) documenta os limites dessa evidência. A integridade e o cleanup passaram: oito contentores próprios e quatro processos filhos.

Foi acrescentado um wrapper comum de observabilidade que guarda a tentativa antes das assertions, com códigos permitidos e métricas existentes identificadas por hash SQL, sem payloads. Não altera a delegação HTTP, critérios de aprovação, limites ou fontes de runtime A/B. Essa mudança originou uma nova identidade de harness. A [prova de reutilização da validação](../../output/tenant-snapshot-ab-6e878cc249d44bf09781c51e856aa711/evidence/validation-reuse.json) liga os resultados anteriores aos mesmos bytes de runtime e aos testes aplicáveis; a falha inicial permanece preservada.

A nova [prontidão 030f83e7…](../../output/tenant-snapshot-ab-6e878cc249d44bf09781c51e856aa711/evidence/030f83e7ef2b4a6ca54f7624fd8763ad/report.json) terminou **PASS**. Abrange Central042/043, 60 casos de deriva tenant, oito provas após a função restrita, oito provas Central/autoridade após lock e 34 verificações HTTP/OIDC. Cada braço HTTP regista 17 tentativas e nove drenagens. Cleanup concluído para oito contentores e quatro processos filhos.

As provas tenant comparam JSON serializado e fingerprints completos dos dois braços, exercitam constraints canónicas e não canónicas, herança/partições, ACL, RLS, owners e roles, e restauram/revalidam cada mutação sintética. A prova após função encaminha a chamada restrita real, introduz a deriva e exige a segunda coleta independente antes de trabalho protegido. As verificações Central após lock continuam ativas. Estas provas funcionais estão fora das populações cronometradas.

## M — coletor tenant completo

O [ensaio M 552a6cec…](../../output/tenant-snapshot-ab-6e878cc249d44bf09781c51e856aa711/evidence/552a6cecd0f849aeb35873adba590b73/report.json) terminou **PASS**, com 2400 medidas e 240 aquecimentos. Cada tenant034 constitui uma população separada: seis pares alternados AB/BA, 100 medidas e dez aquecimentos por braço/bloco, totalizando 600 medidas por braço e tenant. Usa login runtime limitado e transações READ ONLY. Cada chamada recolhe novamente as 25 consultas, incluindo as 24 de segurança; snapshots, fingerprints e sequência dessas consultas permanecem equivalentes. `inspectTenantMetadata` registou zero problemas de validação.

| População | p50 A (ms) | p50 B (ms) | Variação p50 B/A | p95 A (ms) | p95 B (ms) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tenant0 | 101,9790 | 95,1559 | −6,6907% | 114,6339 | 107,0746 |
| Tenant1 | 103,7371 | 95,9010 | −7,5538% | 116,0839 | 109,7541 |

Estes são os quantis das populações medidas por braço e tenant, pelo método nearest rank. Aquecimentos, chamadas funcionais e perfis EXPLAIN ficam separados. B melhora p50 nos 12 pares M e p95 em 11 dos 12. A mediana da consulta base passa de 57,915 para 50,851 ms no tenant0 e de 58,765 para 51,228 ms no tenant1; o custo das 24 consultas de segurança mantém-se próximo de 40 ms. O ganho pertence ao coletor completo nestas duas populações, sem certificação HTTP. A [análise por par](tenant-snapshot-sql-performance/analysis-6853f1cd88024cc1981b126414781fd5/metadata-pairs.csv) conserva a variação e a exceção p95.

## H — população completa, resultado FAIL

O [ensaio H b59bc7c3…](../../output/tenant-snapshot-ab-6e878cc249d44bf09781c51e856aa711/evidence/b59bc7c381f5464b9c1f1d478db83bca/report.json) executou os oito braços com fixtures novas, em quatro pares AB/BA/AB/BA: **288 tentativas medidas, 287 HTTP200 e um HTTP503**, 56 aquecimentos HTTP200 e 136 controlos de prontidão aprovados. Não faltam tentativas. Os sete primeiros braços passaram; o último A terminou FAIL. O executor conservou a falha e concluiu os cenários já previstos, sem repetição da carga.

A [análise congelada](tenant-snapshot-sql-performance/analysis-6853f1cd88024cc1981b126414781fd5/summary.json), executada depois da carga numa cópia pinada, devolveu **INVALID_OR_INCOMPLETE**, com 17 avisos. Eles incluem a falha funcional, a diferença de resposta e contagens do percurso interrompido, e campos finais ausentes porque o ramo de erro não atribui `httpCounts`/`drainMs`. Não se alterou o analisador para aprovar o ensaio. O pedido falhado conserva os seus 1195 eventos SQL fechados; a etiqueta de métricas incompletas também exige ausência de falhas e não significa que esses eventos se perderam.

Os valores seguintes são descritivos, sem aprovação do protocolo H. No dashboard C4, o quarto par contém a falha e permanece integralmente nos brutos/exports, classificado como 16 observações não emparelhadas; a comparação emparelhada desse cenário usa os três pares elegíveis. Os restantes cinco cenários têm quatro pares. Não se substituem os resultados globais FAIL pelos subconjuntos com sucesso.

| Cenário | Pares elegíveis | n por braço | p50 A/B (s) | Δ p50 B/A | p95 A/B (s) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Relatório C1 | 4 | 16 | 3,372 / 3,333 | −1,17% | 3,492 / 3,454 |
| Relatório C2 | 4 | 16 | 3,586 / 3,519 | −1,86% | 4,119 / 4,212 |
| Relatório C4 | 4 | 32 | 4,422 / 4,235 | −4,23% | 6,090 / 6,021 |
| Dashboard C1 | 4 | 16 | 8,150 / 7,942 | −2,54% | 8,765 / 12,770 |
| Dashboard C4 | 3 | 24 | 10,056 / 9,768 | −2,87% | 11,375 / 11,494 |
| Dashboard C4, dois tenants | 4 | 32 | 9,456 / 9,401 | −0,58% | 10,206 / 10,073 |

O ganho mediano HTTP é pequeno e não uniforme entre pares: em C1, B melhora p50 em três dos quatro pares de cada rota. O p95 agregado do dashboard C1 aumenta **45,69%**, com um máximo B de 12,770 s, mantido na análise. A amostra é pequena; não atribuir causalmente a variação ao patch ou ao host sem uma prova própria. Os [exports por pedido](tenant-snapshot-sql-performance/analysis-6853f1cd88024cc1981b126414781fd5/http-requests.csv), [por par](tenant-snapshot-sql-performance/analysis-6853f1cd88024cc1981b126414781fd5/http-pairs.csv) e [por população](tenant-snapshot-sql-performance/analysis-6853f1cd88024cc1981b126414781fd5/http-populations.csv) conservam sucessos, falha e valores extremos.

## Falha e custos que permanecem

O [diagnóstico do HTTP503](tenant-snapshot-sql-performance/http-failure-diagnosis.json) confirma `metrics.failures=[LEASE_TIMEOUT]` no último A, `dashboard-c4`, tentativa2: duração HTTP 11,879 s. O dashboard parou no relatório inicial, após um único lease tenant. A reconstrução situa o limite operacional de 10 s durante a conclusão da autoridade, após COMMIT tenant; o instante literal do callback não foi registado, pelo que essa localização temporal é uma inferência de elevada confiança. O limite de alocação de 15 s ainda tinha cerca de 4,28 s disponíveis. Não se alteraram esses limites.

A preparação de auditoria observada demorou **4,615 s**, e a última observação de metadados tenant **2,334 s**. Não houve erros SQL, queries pendentes, rollback ou cancelamento SQL observados nesse pedido. O sampler detetou sessões bloqueadas na janela C4 e fila tenant zero, mas não associa cada amostra ao pedido; contenção é compatível com a evidência, não uma causa exclusiva demonstrada. A ausência de 503 em B não demonstra que o candidato resolveu o timeout. A falha inicial de prontidão continua separada e de causa desconhecida.

No C1, os custos por pedido continuam dominados pelos metadados:

| Mediana por pedido C1 | Relatório A/B | Dashboard A/B |
| --- | ---: | ---: |
| União de intervalos de metadados (s) | 2,618 / 2,545 | 6,299 / 6,104 |
| Fração de metadados no HTTP | 77,68% / 77,31% | 78,22% / 77,62% |
| Metadados Central (s) | 1,894 / 1,896 | 4,131 / 4,091 |
| Metadados tenant (s) | 0,714 / 0,654 | 2,196 / 1,996 |
| SQL base tenant (s) | 0,349 / 0,300 | 1,065 / 0,918 |

São medianas calculadas por pedido; medianas de componentes e percentagens não são aditivas. No dashboard C1 de B, o SQL base Central consome mediana **2,094 s/53 chamadas**, a consulta de segurança de autoridade **1,282 s/106 chamadas** e o SQL base tenant **0,918 s/18 chamadas**. Central representa cerca de 51,85% do HTTP e tenant 25,27%. O [custo por hash SQL](tenant-snapshot-sql-performance/analysis-6853f1cd88024cc1981b126414781fd5/http-query-costs.csv) identifica os componentes. Os 75–76% históricos não são uma baseline temporal diretamente comparável: o A/B atual observa 77–78% e mede a pequena redução dentro da mesma campanha.

Nos 287 pedidos com sucesso, as [contagens](tenant-snapshot-sql-performance/analysis-6853f1cd88024cc1981b126414781fd5/http-checkpoint-counts.csv) mantêm 1195/2841 queries, 52/113 transações, 25/53 checkpoints Central, 50/106 consultas de segurança de autoridade e 6/18 snapshots tenant por relatório/dashboard. A falha não é usada para exigir a contagem de um percurso completo que não terminou. As provas funcionais independentes verificaram a autoridade após lock e após a função restrita; nenhum cache foi introduzido.

## Fecho e limites

A [verificação de fontes e recursos](tenant-snapshot-sql-performance/resource-source-verification.json) confirmou os dois pacotes íntegros, as 38 versões de dependências por braço, hashes dos relatórios filhos, ausência dos **34 contentores próprios** e saída dos **17 processos filhos**, contando a primeira prontidão falhada, a corrigida, M e H. A [conferência do workspace](tenant-snapshot-sql-performance/workspace-task-verification.json) mantém o patch runtime e os 20 ficheiros comuns desta tarefa; preserva trabalho paralelo. Os bytes instalados das dependências não foram arquivados. Cleanup e integridade PASS não convertem H em PASS.

O incremento reduz o custo local do snapshot tenant e conserva as garantias testadas. O problema global de desempenho permanece aberto: o custo Central continua dominante e a campanha H reprovou. Próximo passo: investigar os tempos de auditoria e finalização Central, incluindo a hipótese de contenção, e reduzir esses custos com as mesmas verificações e limites antes de uma nova H integral.

O [descritor da campanha](../references/performance/tenant-snapshot-sql-ab.json) liga os brutos, regressões, análise e verificações finais. A [revisão independente](tenant-snapshot-sql-performance/independent-review.json) confere cálculos e proveniência sem substituir a reprovação do protocolo H.

O host não é reservado e a carga externa não é controlada. Os intervalos incluem driver, transporte, execução e esperas; não medem CPU SQL. A amostragem pode perder eventos breves e não estabelece a causa da falha inicial. Este ensaio não certifica capacidade, C6, SLO de produção, desempenho do writer ativo ou ganho no ambiente habitual044. Não houve commit ou deploy associado a esta campanha.
