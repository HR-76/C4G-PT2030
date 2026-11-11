# Barra superior e pesquisa de páginas

Estado: Review. Pedido de 10/11/2026: barra inspirada no Metronic, com menu pessoal, alertas, pesquisa de páginas e cores mais vivas.

## Critérios
- Preservar contexto da entidade, controlo do menu e alertas existentes.
- Menu de perfil apresenta identidade e ligações de conta existentes, mais saída.
- Pesquisa local de páginas de navegação disponíveis no contexto; não pesquisa dados de negócio nem revela faturação sem confirmação de acesso.
- Diálogo acessível por teclado, fecho e reposição de foco; layout adaptado a ecrãs pequenos.
- Verificar testes focados e build. Não alterar paleta global ou autorizações.

## Validação
5 testes focados de cabeçalho e perfil lateral e build frontend passaram em 10/11/2026. Validação visual em navegador e teclado real pendente. A pesquisa não inclui faturação de cliente, cuja visibilidade depende de uma verificação de acesso própria.

10/11/2026 — Revisão transversal: Pesquisa centrada, fecho por Escape, regresso ao botão com foco visível e menu pessoal confirmados em Chrome. Administração de fontes fica disponível apenas na pesquisa da Administração C4G. Ver [relatório](../reviews/metronic-shared-surfaces-20261110.md).
