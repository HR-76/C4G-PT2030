# Alertas e leitura do calendário
Estado: Review — 11/11/2026.

## Pedido e critérios
Alertas: grupos Hoje, Ontem e Anteriores segundo data civil de Lisboa; datas inválidas/futuras não classificadas como antigas. Ordenar por data decrescente, preservar filtros, paginação/limite de 100, links e ações de leitura. Identificar não lidos em texto; não confundir com tarefa pendente.
Calendário: manter mês, filtros e agenda móvel. Eventos compactos com título abreviado visualmente e nome acessível completo; máximo dois eventos por dia na grelha, ação para consultar os restantes. Abrir detalhes completos em modal também em consulta/concluídas/canceladas. Edição só quando já permitida. Escape e devolução de foco ao evento; sem modais sobrepostos. Detalhes reagem às tarefas atuais e não mantêm dados removidos após mudança de contexto/filtro. Reutilizar FormModal.
Validar datas de Lisboa, filtros, leitura, títulos longos e muitos eventos; permissões, calendário e modal em computador/telemóvel. Testes focados, suite frontend e build.

## Implementação e provas
Alertas agrupados após filtros, por data civil Lisboa, com atualização do agrupamento a cada minuto e ordenação decrescente; preservados links e ações. Identificação textual Não lido. Datas inválidas/futuras em Outras datas. Sem alteração de API ou estado funcional de tarefas.
Calendário mostra dois eventos por dia na grelha e botão +N para modal do dia. Evento abre detalhes em FormModal, incluindo em consulta e estados terminais; editar apenas tarefa aberta com permissão existente, fechando detalhes antes do editor. Agenda mobile preservada. Título completo no modal e no nome acessível, duas linhas na grelha.
56 testes focados aprovados; suite frontend 899/899, 103 ficheiros; build aprovado. Cobertura: data civil Lisboa na mudança de hora, datas inválidas/futuras, máximo de eventos, restantes tarefas acessíveis, consulta, concluídas, edição autorizada, Escape/foco e remoção de tarefa.
Chrome com API simulada a 1440/390/320 px: grupos/read/filtro de alertas; calendário, modal do dia e tarefa, título longo, sem edição em consulta, teclado e ausência de overflow/erros JS. Capturas inspecionadas; animações finitas desativadas nas capturas de modal. Script output/playwright/alerts-calendar-check.cjs. Não validado com dados reais. git diff --check sem erros.
Capturas na pasta de visualizações: alertas-grupos-1440.png, alertas-grupos-390.png, calendario-compacto-1440.png, tarefa-modal-1440.png, tarefa-modal-390.png.
