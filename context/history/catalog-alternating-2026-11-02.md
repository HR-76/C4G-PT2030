# GCNI — decisão da comparação alternada — 02/11/2026
Estado: comparação concluída. Não equivale a aceitação de capacidade ou promoção.

## Decisão
Escolher a versão anterior como base. Não manter C1 nem C2 como otimizações de desempenho. Seleção:A. C1 elegível:False;C2 elegível:False. Nenhuma decisão foi aplicada ao código do serviço nesta tarefa; o protótipo C1/C2 anterior não foi promovido e a configuração do ambiente habitual não foi alterada.

## Desenho executado
Execução:9d15cf151ee24c2ea9407ee002c9eeda. A reproduz o percurso anterior: leitor congelado e nova consulta da versão em cada coletor; C1 utiliza apenas a versão local; C2 utiliza apenas a consulta de guardas agrupada. A comparação partilha os restantes coletores e validações atuais; não é um checkout binário independente por braço. Seleção apenas na ferramenta de ensaio, sem API ou configuração de produto.

Mesma infraestrutura, sessão OIDC local, geração e dados; pools de catálogo e membership2 ligações, pool de autoridade de sessão8, sem aumento de limites.27 e10000 oportunidades,tabela/ficha,10 concorrentes. Seis ordens, cada variante duas vezes em cada posição. Cada bloco tem10 aquecimentos e10 medições:720 pedidos medidos e720 aquecimentos,zero erros. É um teste com cache aquecida; não certifica arranque a frio.

Antes de cada troca, aguarda-se fim de operações, callbacks de renovação e ligações em uso, com timeout e recusa se não houver quiescência. Janelas de diagnóstico separadas;10 leituras de sessão e10 conclusões de touch por bloco, sem amostras perdidas. O número de renovações efetivas pode variar: escritas+participantes agrupados=10. Contadores confirmam os ramos de versão/guardas realmente executados; não há mistura de braços no bloco. Não se retêm decisões para mudar variante.

## Critério fixado antes da carga
Recomendar variante só com redução mediana emparelhada>=5% e vitória em>=5/6 pares em AMBOS os cenários10000, sem regressão mediana>5% nos cenários27. Se ambas elegíveis, comparar média geométrica das razões dos percursos10000, com empate dentro de1% a favorecer C1. Não inferir benefício de C1+C2 a partir dos braços individuais. Esta é uma regra operacional conservadora, não uma prova de equivalência ou significância estatística.

## Resultados
|Volume|Percurso|Variante|Mediana dos p95 ms|Pior p95 ms|Redução emparelhada %|Vitórias|
|---|---|---|---|---|---|---|
|27|list|A|627.4|680.31|—|—|
|27|list|C1|612.88|656.71|1.14|3/6|
|27|list|C2|613.02|645.79|2.5|4/6|
|27|detail|A|579.44|616.78|—|—|
|27|detail|C1|574.05|628.65|0.02|3/6|
|27|detail|C2|552.46|643.1|4.72|5/6|
|10000|list|A|612.01|644.76|—|—|
|10000|list|C1|626.51|653.69|-1.74|1/6|
|10000|list|C2|623.95|659.75|-1.99|1/6|
|10000|detail|A|569.47|582.79|—|—|
|10000|detail|C1|577.6|603.15|-2.33|1/6|
|10000|detail|C2|580.07|601.23|-1.56|2/6|

Redução positiva favorece a variante; valor negativo significa pior resultado. A redução emparelhada é a mediana de1-p95_variante/p95_A de cada ronda, não o quociente das medianas da tabela. P95 por série de10 corresponde ao maior valor da série, como nos ensaios anteriores. Percentis e contagens recalculados a partir das amostras, sem remover outliers. Tempo do servidor termina nos cabeçalhos; HTTP completo guardado em separado.

Capacidade por braço (todas as séries<=500ms):{"A": false, "C1": false, "C2": false}. Resultado global:NOT_ACCEPTED. A escolha relativa não dá autorização de promoção.

## Segurança, validação e autorrevisão
2505 testes backend PASS,7 SKIP,zero falhas na preparação;2 testes dirigidos da versão final do seletor PASS. As asserções executadas na carga verificam a seleção de cada braço, a ausência de operações pendentes e os contratos completos de tabela/ficha. OIDC real local com contas sintéticas; drift de permissões e membership revogada recusados nas três variantes, sem dados devolvidos ao cliente revogado. Controles de isolamento, reversão e monitorização preservados.

Autorrevisão: a comparação foi restrita a blocos sem sobreposição, incluindo touch que pode terminar depois dos cabeçalhos. Aquecimento repetido em cada bloco e ordens equilibradas evitam favorecer sistematicamente a primeira ou última variante. A regra foi fixada antes de observar a carga. Callback opcional foi preservado na instrumentação. Hashes dos quatro ficheiros de serviço inspecionados confirmados sem alterações; nenhum parâmetro experimental entrou no runtime habitual. A instrumentação tem custo comum aos braços, não subtraído artificialmente.

Limites: uma máquina, primário único, uma execução equilibrada,6 pares por cenário; variação temporal e efeitos residuais de ordem não desaparecem totalmente. Não há prova de federação institucional externa, HA ou SLA. Não houve migrações produtivas, reativação de fontes ou publicação. QUIESCED,zero recolhas e exposiçãoOFF confirmados;contentores próprios removidos.

Próximo passo: repor a versão anterior no laboratório, preservando os testes de segurança e as evidências, e validar a reposição antes de nova otimização.
