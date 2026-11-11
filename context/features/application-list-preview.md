# Lista e resumo lateral de candidaturas

Estado: Review. Solicitado em 10/11/2026.

## Critérios
- Alternar lista e tabela com mesmos resultados autorizados, filtros, ordenação e paginação.
- Lista mostra título, oportunidade, estado, responsável, unidades e valores disponíveis; painel lateral apresenta apenas dados do resultado autorizado e ligação ao detalhe.
- Manter tabela e transições existentes; não introduzir permissões ou dados novos. Fechar painel ao mudar filtro/página/contexto.
- Navegação por teclado, foco, apresentação móvel, estados vazios e carregamento. Testes focados e build.

## Validação
15 testes focados e build frontend passaram. Painel usa exclusivamente dados já devolvidos pela listagem autorizada; não mostra prazo interno por não constar dessa projeção. Teste visual em navegador e responsividade reais pendentes.

## Alteração de âmbito
10/11/2026: vista em lista e painel removidos das candidaturas a pedido do utilizador; a funcionalidade do Catálogo mantém-se.
