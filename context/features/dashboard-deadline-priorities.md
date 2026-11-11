# Prioridades por prazo no Dashboard
Estado: Review — 11/11/2026.

## Âmbito e critérios
Reutilizar os prazos internos autorizados nas vistas Gráficos e Indicadores. Separar Em atraso, Hoje e Próximos, com data civil, título integral e ligação à candidatura. Preservar gráficos, filtros e permissões. Não alterar login.
Backend reportSql.js: candidaturas ativas com prazo <= hoje Lisboa + 30 dias, incluindo atrasos; ordenação prazo/id, máximo 25. Contagens de grupo referem-se apenas à seleção apresentada; lista parcial deve indicar quantidade/total e não declarar inexistência de prazos num grupo vazio. Sem mudanças de API.
Layout inspirado nos grupos e linhas de Projects/Targets Metronic Demo 20: hierarquia textual, cores auxiliares e lista vertical compacta; paleta existente, foco visível e títulos com quebra. Validar grupos, limites, datas, links, vazio e computador/telemóvel.

## Validação
30 testes focados aprovados (DashboardDeadlines, OrganizationDashboard, DashboardCharts). Ajustadas duas expectativas existentes para a nova estrutura e texto de prazo. Build aprovado. Chrome com API simulada validou ambas as vistas a 1440/390/320 px: grupos, títulos longos, foco e ausência de overflow/erros JS. Capturas desktop/mobile inspecionadas. Script: output/playwright/dashboard-deadlines-check.cjs. Sem alterações à API ou autenticação. Não validado com dados reais nem repetida a suite completa.
