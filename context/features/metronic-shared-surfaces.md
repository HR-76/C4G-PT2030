# Superfícies comuns inspiradas no Metronic

Estado: Review. Pedido de revisão transversal da APP em 10/11/2026.

## Âmbito e critérios
- Refinar os componentes partilhados de tabelas, pesquisa e filtros, com superfícies brancas, bordas discretas e foco petróleo. Preservar tabela responsiva e variantes específicas.
- Melhorar cartões partilhados do dashboard e catálogo sem substituir componentes específicos ou alterar dados, ações, permissões e navegação.
- Manter a sidebar e a paleta petróleo aprovada; garantir estados de foco e contraste. Executar suite frontend e build.
- Análise estática transversal; páginas com estilos próprios requerem revisão visual individual posterior.

## Validação e limites
Suite frontend: 101 ficheiros e 867 testes passaram; build passou. Componentes comuns e regras partilhadas atualizados; existem 27 módulos de páginas identificados com uso destas primitivas, além de superfícies específicas. Não foi concluída inspeção visual de todas as páginas ou estados; manter In Progress.

## Continuação: linguagem visual comum
- Paleta, bordas, superfícies e foco definidos em `frontend/src/c4g-surfaces.css`; aplicação ao conteúdo e diálogos, preservando identidade da sidebar.
- Pesquisas do catálogo unificado e faturação passam a usar SearchInput; campos de datas e valores continuam com o seu tipo original.
- Revistos cartões e tabelas de diretórios administrativos, fichas, alertas, segurança e faturação; o catálogo unificado usa tipografia da aplicação e fundo branco.
- A revisão no navegador cobre páginas de consulta da entidade e administração a 1440 e 390 px. Não executa comandos de negócio ou envios de convites. Fichas sem dados suficientes, todas as variantes de permissão e todos os detalhes não ficam implicitamente validados.

## Verificação final da continuação
870 testes / 101 ficheiros PASS; build PASS. Chrome real confirmou 20 páginas principais a 1440 e 390 px, sem erros de leitura nem transbordo horizontal. Pesquisa e formulários de convite confirmados por teclado nas contas de entidade e plataforma. Faturação carregou em estado vazio (sem faturas nesta entidade). Foram corrigidos Escape da pesquisa, regresso de foco do convite e colisão da legenda dos gráficos. [Relatório e limites](../reviews/metronic-shared-surfaces-20261110.md).
