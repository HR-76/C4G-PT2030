# Margem de admissão C6 em host dedicado — protocolo preparado

**Estado: primeira série concluída com evidência de interferência inválida; repetição com observador corrigido em execução.** O SLO foi aceite e o computador atual reservado pelo utilizador para a janela de teste. PostgreSQL Dev e Collabora são pausados temporariamente pelo runner e retomados no `finally`. Não é uma VPS nova ou uma alegação de isolamento físico: são condições de dedicação operacional local, observadas durante a janela. Nenhum resultado será aprovado se as condições definidas de ambiente falharem.

## Primeira série preservada e motivo da repetição

Os doze bursts terminaram com **72/72 pedidos e doze aquecimentos sem erros**, fontes/políticas/SQL/protocolo/auditoria preservados. Contudo, o [observador Windows tinha um defeito de conversão numérica](observer-defect.md): perdia incrementos fracionários por processo e devolvia zeros incorretos. As [fontes executadas](attempt1-sources/) foram guardadas antes da correção. A primeira série não comprova os critérios de interferência e tem veredicto `INVALID_ENVIRONMENT` em ambas as variantes; os resultados completos estão em [comparison.json](comparison.json).

| Variante da primeira série | Admissões | p95 admissão | Máximo | Margem mínima | Critérios numéricos observados |
|---|---:|---:|---:|---:|---|
| A | 108 | 2585,16 ms | 4163,94 ms | 836,06 ms | FAIL: execução 8 excede máximo de 4000 ms |
| B | 108 | 2505,92 ms | 3389,49 ms | 1610,51 ms | Dentro dos limites, mas ambiente não validado |

Não foi eliminado o resultado desfavorável de A nem aprovado B com telemetria de fundo inválida. A correção tipa explicitamente os dois argumentos de `Math.Max` como double e marca o contador `fractional-double-v2`. [Regressão fracionária e amostragem com atividade real](observer-selftest/result.json) PASS; [seis testes do avaliador SLO](slo-test.log) PASS, incluindo limite máximo oculto por p95 baixo, erros e ambiente/evidência inválidos.

A repetição integral mantém o SLO, sequência, workload, limites e hashes de runtime. Usa [novo diretório](../c6-dedicated-slo-repeat/) e relatórios `c6-dedr-*`, sem sobrescrever a primeira série. Só foram alterados o contador, a identificação da sua versão e os nomes de relatório aceites para permitir a repetição. O analisador exige o contador corrigido para aprovar o ambiente. Os dois contentores foram comprovadamente retomados entre séries e voltaram a ser pausados para a segunda janela.

## Protocolo concreto

[Plano legível por máquina](protocol.json). Seis pares equilibrados: **AB, BA, AB, BA, AB, BA**. Doze fixtures novas, doze aquecimentos excluídos e **72 pedidos medidos**; seis bursts/36 pedidos por variante. Mantêm-se C6, 1000 candidaturas/250 pessoas, autoridade, auditoria, limites e dados sintéticos. Com três admissões por dashboard, esperam-se 108 observações por variante quando todos os pedidos têm sucesso.

A é a implementação anterior aos três agrupamentos; B é a atual. Usar as fontes com hashes já fixados, carregadas só no processo de prova, sem substituir o worktree. Comparar apenas no mesmo host, imagens, versões, dados e recursos; guardar cada execução, incluindo falhas ou contaminação. Não escolher execuções favoráveis nem usar resultados históricos como se fossem medições do host dedicado.

O harness existente é específico de Windows/PowerShell e usa um caminho fixo para Chrome. Foi mantido sem alterações; o [runner novo](../../../test/integration/c6-dedicated/run.ps1) prepara a ordem equilibrada e a pausa/restituição dos dois contentores identificados. Um contentor novo, sozinho, não constitui host dedicado; a reserva explícita da janela e as observações do ambiente são requisitos adicionais. Não houve contratação de recursos ou alteração de deploy.

## SLO aprovado para a prova C6

| Critério | Limite aprovado |
|---|---:|
| p95 da espera por admissão lógica, por variante | ≤3000 ms |
| Máximo em cada burst e em cada variante | ≤4000 ms |
| Margem observada mínima para o timeout existente de 5000 ms | ≥1000 ms |
| Timeouts/erros de admissão e falhas HTTP no cenário positivo C6 | 0 |

Medir a duração de `poolManager.acquire`, incluindo tentativas recusadas ou expiradas. Não confundir admissão lógica com checkout físico do `pg.Pool`, duração de lease, timeout HTTP ou latência total do dashboard. A margem é `5000 − máximo observado`, não uma garantia para pedidos futuros. p95 por nearest rank sobre todas as admissões medidas de cada variante; aquecimentos separados. Manter também distribuição e máximo por burst, posição AB/BA e par. Não considerar as 108 observações réplicas independentes: pertencem a seis bursts.

Um erro/falha de admissão reprova o SLO observado mesmo que a latência relativa melhore. Evidência incompleta ou interferência no host não pode produzir PASS; reportar separadamente as falhas já observadas. O resultado de A e B é avaliado individualmente contra o SLO fixado **antes** de executar. Não mudar o SLO para acomodar os resultados. A aprovação aplica-se a esta prova, não define um compromisso produtivo de disponibilidade nem um SLO de latência HTTP global.

## Condições do host a verificar antes de executar

Identificação e reserva exclusiva durante a série, ausência de outras cargas de utilizador/CI e de contentores estranhos à prova, recursos CPU/memória constantes, energia/frequência/governor registados, imagens fixadas e dependências equivalentes. Num host virtual, registar a classe de recursos e observar CPU steal/throttling quando disponível; ausência de instrumentação limita a alegação de isolamento físico. Não encerrar serviços do utilizador por inferência.

Monitorizar recursos e interferência durante a série, incluindo CPU, memória, event loop, pool, locks e admissão. Preservar autoridade e eventos duráveis; conferir 2619/2421 queries, 42/36 transações, 198 chamadas de protocolo, dez prepares/appends de auditoria e total 1000 por dashboard bem-sucedido. Confirmar ausência de queries depois da resposta e cleanup das fixtures próprias. Uma nova versão do executor exige sintaxe e verificação focada antes da carga.

Controlos fixados antes da execução: admissão do host com três intervalos de CPU global ≤25% e memória livre ≥4 GiB; todos os contentores preexistentes identificados pausados, nenhum contentor estranho em execução entre fixtures; imagens/recursos Docker e plano de energia constantes. Um job PowerShell observa a cada segundo CPU dos processos preexistentes acessíveis, excetuando os processos da plataforma Docker/WSL que alojam a carga, sistema e o próprio runner. Para validar cada burst: média dessa CPU ≤5%, amostra máxima ≤10% (escala normalizada pelos cores), amostras sem lacunas superiores a 5 s. CPU dos processos novos não pertencentes à prova e processos inacessíveis não é individualizada; frequência efetiva e temperatura não estão controladas. Estes limites restringem o veredicto, não são relaxados para obter PASS.

O observador Node é uma cópia da versão anterior, com apenas a allowlist de nomes de relatório adaptada a doze execuções. O [analisador](../../../test/integration/c6-dedicated/analyze.js) conserva a distinção entre A/B, AB/BA, SLO e validade do ambiente. O SLO registado no início tem de coincidir com o protocolo final. Pausa não elimina contentores/volumes e não abre sessões nas bases Dev.

## Entrega prevista

Tabela por burst com ordem/variante, sucesso/erro, p95/máximo de admissão, margem restante, p50/p95 HTTP e veredicto SLO; diferenças pareadas separadas para AB e BA; recursos/interferência do host, políticas/hashes e evidência bruta. Manter a feature aberta se faltar host dedicado comprovado, SLO escolhido ou resultados válidos.

## Estado desta preparação

HEAD/branch e hashes registados em [baseline.json](baseline.json). Fontes de runtime, harness anterior, migrations, grants/permissões, dados Dev e deploy preservados. As únicas intervenções operacionais previstas são pausa e retoma dos dois contentores identificados, dentro da janela reservada. A série está em curso; resultados, SLO e reposição do ambiente serão registados no fecho.
