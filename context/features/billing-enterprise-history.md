# Faturação: apresentação Enterprise e histórico

Estado: Review. A proposta visual Enterprise e a vista de histórico foram aprovadas pelo utilizador em 10/11/2026.

## Âmbito e critérios
- Reorganizar a faturação do cliente em resumo por moeda, fatura apresentada na lista e acesso ao histórico, com cores mais vivas limitadas a esta área.
- Disponibilizar histórico com os filtros, paginação, estados e ligação ao detalhe existentes; preservar URLs de detalhe e acesso financeiro.
- Não inventar planos, pagamentos, datas ou documentos. O resumo abrange todos os períodos; a fatura apresentada é identificada como primeiro resultado da lista, sem afirmar ser a mais recente.
- Manter carregamento, erros, lista vazia, múltiplas moedas, detalhe e PDF existentes. Layout responsivo e foco visível.
- Validar testes de faturação e build frontend. Paleta global é trabalho posterior.

## Validação
10/11/2026: 5 testes focados de faturação e build frontend passaram. A validação visual em navegador e a revisão global da paleta permanecem pendentes. O histórico reutiliza os filtros e paginação existentes; o resumo não é filtrado.

10/11/2026: corrigido erro 400 na listagem causado pelo objeto de parâmetros sem protótipo do Express 5. Nove testes backend direcionados passaram; teste HTTP por loopback bloqueado pelo sandbox (EACCES). Correção ainda não verificada na instância habitual; poderá exigir reinício da API.
