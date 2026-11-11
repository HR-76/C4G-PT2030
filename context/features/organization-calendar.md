# Calendário da entidade

O Admin Cliente consulta, numa página de leitura, os prazos internos e as tarefas abertas das candidaturas identificadas, em preparação ou submetidas. A página abre no mês atual de Lisboa. Permite mudar de mês, escolher uma candidatura e consultar os próximos prazos por ordem de data. Cada prazo identifica a candidatura e o seu estado. Selecionar um dia permite consultar todos os seus prazos, com acesso à ficha de origem.

A consulta usa a organização e a membership atuais do servidor. Exige perfil `ORG_ADMIN`, aplica as guardas de leitura de candidaturas e das suas fontes e aplica a autorização de leitura de tarefas antes de as incluir. Tarefas concluídas, canceladas ou eliminadas e candidaturas encerradas ficam fora da vista. A lista de próximos prazos parte de hoje, independentemente do mês em consulta.

O filtro por estado da candidatura oferece Todos os estados, Identificada, Em preparação e Submetida. Combina com o filtro por candidatura e aplica-se à grelha mensal, aos próximos prazos e ao detalhe de um dia. Ao alterar o filtro, mantém o mês e volta à primeira página dos próximos prazos.

## Aceitação

- O Admin Cliente tem acesso pelo menu e pela pesquisa de páginas. Outros perfis recebem recusa na API e no acesso direto.
- A grelha mensal funciona em computador e telemóvel. Filtrar uma candidatura atualiza a grelha e a lista e mantém o mês. Dias com vários prazos permitem consultar os restantes.
- A grelha e a lista incluem apenas prazos internos e tarefas de candidaturas no estado selecionado. Combinar filtros sem correspondência apresenta o estado vazio, e regressar da ficha preserva ambos os filtros.
- A lista distingue prazo interno de tarefa e apresenta o estado da candidatura. A navegação para a ficha permite regressar ao calendário com o mesmo mês e filtro.
- Validar a pesquisa de candidaturas, as fronteiras do mês, os estados vazios, a paginação, a recusa entre organizações e as tarefas eliminadas.

## Validação

No ambiente habitual, o Admin Cliente autenticado consultou quatro candidaturas em curso e quatro próximos prazos. Foram verificados o filtro, a mudança de mês, o atalho Hoje, a pesquisa de páginas e o regresso da ficha com o filtro preservado, a 1440, 390 e 320 px. A verificação decorreu em leitura. Com API simulada, o Chrome confirmou um dia com três prazos, a consulta de todos os eventos desse dia e o redirecionamento de um perfil sem acesso. Build e 956 testes frontend aprovados. A suite backend aprovou 2934 testes, com 7 ignorados.

Filtro por estado. No ambiente habitual, a seleção de um estado reduziu a grelha de três para dois dias com prazos e a lista de quatro para três prazos. Confirmadas a combinação com uma candidatura, a rejeição de estados fora do calendário e a apresentação a 1440, 390 e 320 px. Build, 958 testes frontend e 27 testes backend focados aprovados.
