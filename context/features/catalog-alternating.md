# GCNI — comparação alternada A/C1/C2
Estado: Complete nesta comparação. Só ensaio isolado; não alterar o serviço nesta comparação.

A=versão anterior a C1/C2;C1=apenas versão local;C2=apenas consulta agrupada. Seleção exclusivamente na ferramenta de ensaio, sem endpoint ou flag do serviço. Mesma base, pools de catálogo/membership2 e autoridade de sessão8, sessão OIDC, geração e cache aquecida. Sem fontes ou promoção.

Seis permutações por cenário, cada variante duas vezes em cada posição.27/10000,tabela/ficha,10 concorrentes;10 aquecimentos e10 medições por bloco:720 medições+720 aquecimentos. Expansão de5 para6 séries permite equilíbrio das posições; p95<=500ms continua obrigatório para capacidade. Aguardar fim das operações e renovações antes de mudar variante, sem prolongar locks.

Decisão pré-fixada: recomendar uma variante só com zero erros, redução mediana emparelhada de pelo menos5% do p95 servidor e vitória em pelo menos5/6 pares em AMBOS os cenários10000, sem aumento mediano superior a5% nos cenários27. Caso contrário manter a referência como recomendação, sem alegar ganho causal. Não confundir decisão relativa com aprovação da meta500ms. Mudanças selecionadas serão documentadas; esta tarefa compara e decide, não promove nem aplica uma reposição ao serviço.

Se ambas forem elegíveis, selecionar a melhor média geométrica das razões emparelhadas dos dois percursos10000; empate dentro de1% favorece C1 por menor alteração estrutural. Não inferir ganho da combinação C1+C2 a partir dos braços individuais.

Testar troca recusada com operação pendente, seleção exata das variantes e conclusão de callbacks. Verificar revogação e drift nas três variantes, fontesQUIESCED e exposiçãoOFF. Recomputar percentis e contagens das amostras, documentar autorrevisão e limpeza.

## Resultado
Escolher a versão anterior como base. Não manter C1 nem C2 como otimizações de desempenho. Capacidade:NOT_ACCEPTED. [Autorrevisão e resultados](../history/catalog-alternating-2026-11-02.md).
Próximo passo: repor a versão anterior no laboratório, preservando os testes de segurança e as evidências, e validar a reposição antes de nova otimização.
