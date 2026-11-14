# Abertura do Dashboard — desempenho

Estado: Review (pontos 1, 3 e 4). Ponto 2 por decidir.

Primeiro bloco da revisão de desempenho página a página pedida pelo utilizador em 14/11/2026, nos três perfis: Administrador e Gestor de candidaturas (dashboard da entidade), Técnico e Admin C4G.

## Alterações

1. **Resumo do catálogo central reutilizado** (dashboard da entidade). O resumo do catálogo é igual para todas as entidades e utilizadores e era recalculado em cada abertura, percorrendo o catálogo todo. A rota guarda agora uma resposta por dia de referência durante 30 s e os pedidos simultâneos partilham a mesma leitura. Uma leitura falhada nunca é guardada. Os dados da entidade continuam a ser lidos em todos os pedidos, com as mesmas verificações de autoridade e auditoria. Consequência aceite: uma alteração ao catálogo central pode demorar até 30 s a refletir-se nas contagens do Dashboard. Ativado em `productionComposition.js` (`centralSummaryReuseMs:30000`); a fábrica da rota mantém-no desligado por omissão.
3. **Reabertura imediata** no dashboard do Técnico (tarefas, alertas e primeira página de revisões) e no Dashboard C4G, com o mecanismo já existente de [dados confirmados](confirmed-reads-page-reuse.md): mostra a última resposta do mesmo utilizador e organização e volta a lê-la; uma leitura recusada retira-a; «Atualizar» no Dashboard C4G espera pelo servidor sem mostrar dados antigos.
4. **Alertas do Técnico**: pede os 5 que apresenta (`limit=5`) em vez de 100. O servidor já devolve os mais recentes primeiro. As tarefas ficam como estavam: a rota não tem limite configurável (página fixa de 25) e o ganho seria marginal.

## Critérios de aceitação

- Duas aberturas do dashboard da entidade dentro de 30 s fazem uma só leitura do catálogo central e duas leituras da entidade; depois de 30 s ou num novo dia de referência o catálogo é lido de novo.
- Falha do catálogo central devolve 503 sem totais parciais e não fica guardada.
- Dados confirmados nunca são mostrados a outro utilizador ou organização.

## Validação

- Regressões novas: `backend/test/httpDashboardCentralCache.test.js` (4), `TechnicianDashboard.test.jsx` (+3), `PlatformDashboard.test.jsx` (+1); RED antes, GREEN depois.
- Backend 3198 aprovados, 9 ignorados, 0 falhas. Frontend 1028 aprovados. Build e lint aprovados.
- **Não medido em browser nem em PostgreSQL real**: o ambiente local não estava a correr. O ganho do ponto 1 depende do tamanho do catálogo e está por medir.

## Ponto 2 — pedido único do Técnico (por decidir)

O dashboard do Técnico faz três pedidos protegidos em paralelo (tarefas, alertas, revisões). Juntá-los numa só operação protegida, como foi feito no dashboard da entidade, cruza três operações de autorização distintas (`APPLICATION_WORK_READ`, `NOTIFICATION_READ`, `APPLICATION_DOCUMENT_READ`) com versões de schema e capacidades diferentes. Perguntas em aberto antes de implementar:

- As revisões exigem as capacidades de documentos, adiadas no staging. Numa operação única, a falta delas deve omitir só o painel de revisões ou recusar o dashboard todo? Hoje cada painel falha sozinho.
- A alteração exige o gate isolado de segurança e concorrência (Docker, PostgreSQL e Keycloak descartáveis), que precisa de autorização própria.

## Restantes pontos da análise (não iniciados)

5. Descarregar o código da página inicial em paralelo com a sessão. 6. Permissões do menu na resposta da sessão. 7. Agrupar verificações de autorização do relatório. 8. Medir a consulta do relatório com `EXPLAIN` em staging. 9. Verificar compressão e cache de `/assets` no proxy da VPS. 10. PERF-01.
