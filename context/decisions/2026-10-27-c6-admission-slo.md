# Critério de regressão C6

Estado: aceite pelo utilizador em 27/10/2026; implementação validada, em Review.

O utilizador confirmou que o SLO da prova C6 passa a ser critério explícito nas futuras regressões C6. Aplica-se à admissão lógica de leases, não à latência HTTP nem a um compromisso produtivo.

| Critério | Limite inclusivo |
| --- | --- |
| p95 de admissão, nearest rank por variante | ≤3000 ms |
| Máximo de qualquer admissão | ≤4000 ms |
| Margem mínima para timeout fixo de 5000 ms | ≥1000 ms |
| Erros HTTP e de admissão | Zero |

Usar seis pares AB/BA alternados, doze bursts de seis pedidos concorrentes e um aquecimento separado por burst; 72 pedidos medidos e 108 admissões por variante. Incluir todas as tentativas medidas e excluir apenas os aquecimentos. Comparar limites com valores disponíveis sem arredondamento adicional; arredondar apenas para apresentação. Aplicar o SLO separadamente a A e B; bons tempos relativos não compensam falha absoluta.

Aceitação do incremento: política versionada sem overrides na CLI; gate read-only que recalcula o SLO, confere fontes e completude, controlos de ambiente, políticas, autoridade/auditoria e sai zero apenas com PASS. O runner deve chamar análise e gate depois de repor o ambiente. Evidência inválida/incompleta e falhas de SLO devolvem código diferente de zero. O estado COMPLETE de um diagnóstico não aprova uma regressão.

Manter admissão/pools/timeouts e validações de autoridade e durabilidade. Preservar todas as execuções, incluindo inválidas; uma repetição deve ter destino novo e razão documentada. Host reservado e controlos observados continuam obrigatórios, com limitações de isolamento físico explícitas. Um burst isolado de diagnóstico não substitui esta série equilibrada.

Validar com testes focados de fronteiras, erros, dados ausentes, políticas/telemetria alteradas e integridade; avaliar as duas séries preservadas sem nova carga. Não alterar runtime, migrations, grants/permissões, dados Dev, deploy ou evidência histórica. Futuras variantes exigem fontes/hashes fixados antes da execução e adaptação explícita dos nomes permitidos pelo harness; não reutilizar destinos existentes.

Referência: [prova válida](../reviews/c6-dedicated-slo-repeat/README.md). Esta decisão não aprova desempenho produtivo nem encerra a feature GET/POST global.

Implementação: [gate e utilização](../../test/integration/c6-dedicated/README.md), política `c6-admission-v1`. [Validação do incremento](../reviews/c6-regression-gate/README.md): 15 testes PASS, sintaxe PASS, CLI aceita a série válida e recusa a primeira inválida sem reescrever as provas. Nenhum workload ou serviço foi iniciado para esta alteração.
