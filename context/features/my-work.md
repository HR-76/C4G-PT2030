# O meu trabalho

Estado: Review — 11/11/2026. Pedido explícito do utilizador.

Reunir tarefas atribuídas à membership atual, nas candidaturas acessíveis da organização ativa. Usar a hierarquia visual de listas e cartões Metronic já adotada na APP.

Critérios: entrada no menu; tarefas abertas agrupadas em Em atraso, Hoje e Próximas, por data civil de Lisboa; filtros no servidor por texto de tarefa, título de candidatura, estado e prazo; paginação após autorização e filtros; contagens completas; modal acessível com título, candidatura, prazo e estado e ligação à equipa da candidatura. Concluídas e canceladas têm grupos próprios, nunca indicadas como atrasadas. Não introduzir edição direta nesta vista.

Segurança: identidade e membership exclusivamente da sessão, isolamento por organização, participação do contributor, autorização de candidatura/trabalho e respetivas fontes. Revalidar autoridade a cada página. Limpar dados em erros de autorização e mudança de contexto. Não alterar calendário ou login.

Validação: testes de contrato/autorização/paginação e UI, build, Chrome em computador e telemóvel com dados simulados, foco/modal e ausência de overflow. Não executar migrações nem integração em bases reais sem âmbito autorizado.


## Implementação e validação

- Rota `/meu-trabalho`, menu Trabalho diário e pesquisa de páginas. Lista, totais globais por grupo e modal apenas de consulta, com ligação `#equipa-tarefas`.
- GET `/api/applications/my-work` (`workMine`): q, applicationQ, status (OPEN/COMPLETED/CANCELLED/all), period (all/overdue/today/upcoming), cursor. Consulta de 25 itens, ordem prazo/taskId, filtros anteriores à paginação. Nenhuma identidade é aceite no pedido.
- Usa a lease, guarda, auditoria e snapshot protegido de autorização existentes. Reutiliza seleção SQL autorizada (organização, participação, candidatura, fonte, avaliação), incluindo APPLICATION_WORK_READ; responsável é a membership autenticada. Cursor assinado ligado a utilizador/organização/membership/filtros/dia/autoridade e digest dos resultados; uma alteração invalida continuação e limpa os dados apresentados.
- Frontend: 916/916 testes passaram; após ajuste do cabeçalho móvel, 47 testes focados passaram. Atualizada uma expectativa antiga de ApplicationWork para a mensagem já existente sobre a lista «Todas».
- Backend: 21/21 testes focados passaram, incluindo rota HTTP real com serviço simulado, filtros/identidade, isolamento, cursor e autoridade. Verificação sintática passou. Suite completa: 2839 passaram, 7 ignorados, 1 falhou (SEC-AC-01, regra de sessionStorage que não contempla o logoutResult.js já existente). A falha não foi ocultada nem a regra enfraquecida. A primeira execução restrita também encontrou EACCES nas ligações HTTP locais; repetida com acesso a localhost.
- Build aprovado. Chrome com API simulada a 1440/390/320 px: grupos, 31 tarefas abertas em duas páginas, filtros, estados terminais, vazio/403, modal, teclado/retorno de foco, sem overflow ou erros JS. Capturas inspecionadas visualmente; corrigida sobreposição do breadcrumb com a entidade no cabeçalho móvel desta vista.
- Evidência reproduzível: `output/playwright/my-work-check.cjs`; capturas `meu-trabalho-{1440,390,320}.png` e `meu-trabalho-modal-{1440,390,320}.png` na pasta de visualizações da sessão.
- Limite: consulta SQL inspecionada e testada com cliente simulado; não executada integração PostgreSQL nem migrações ou validação com sessão real. Não foi feito deploy.

Próximo passo: validar a vista com uma sessão real de Técnico e candidaturas da organização, no ambiente autorizado.
