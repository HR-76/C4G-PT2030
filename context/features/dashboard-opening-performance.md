# Abertura do Dashboard — desempenho

Estado: Review (pontos 1 a 4). Sem medição em ambiente real.

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

## Ponto 2 — pedido único do Técnico (14/11/2026)

Decisão do utilizador: quando as revisões não estão disponíveis (documentos adiados no staging), omite-se só o painel de revisões.

- Nova rota `GET /api/applications/technician-dashboard`, sem parâmetros. Executa, no mesmo pedido HTTP e uma de cada vez, as três leituras protegidas que já existiam: tarefas por concluir (`workMine`), alertas (`alertsList`, 5) e revisões atribuídas (`reviewMine`). Resposta `{tasks,alerts,reviews}`; uma parte recusada ou indisponível vem como `{error:{code}}` e as restantes são devolvidas. Sessão inválida recusa o pedido todo (401).
- **O núcleo de autorização não foi alterado.** Cada parte mantém a sua operação, lease, guarda e auditoria. Uma operação protegida única foi rejeitada: exigia alargar a lista fechada de dependências de autoridade em `authorityCoordinator.js` e a política de auditoria de leituras, e tornava obrigatórias as três permissões em conjunto.
- Ganho esperado, por medir: um pedido em vez de três (sessão e contexto da organização resolvidos uma vez), as verificações de admissão [partilhadas dentro do pedido](request-scoped-central-admission.md) e fim da concorrência entre as três leituras pelo mesmo bloqueio Central, observada na [revisão de 11/11](../reviews/technician-api-navigation-20261111.md). Em contrapartida as três partes correm em série; se a medição mostrar que a série é mais lenta do que o paralelo, rever.
- Frontend: `privateApplicationsApi.technicianDashboard`; cada painel continua a falhar sozinho; «Tentar novamente» repete o pedido único; «Mais revisões» e «Primeira página» usam a rota de revisões existente.
- Regressões: `backend/test/httpTechnicianDashboard.test.js` (4) e `TechnicianDashboard.test.jsx` reescrito (7). Backend 3202 aprovados, 9 ignorados; frontend 1029; build e lint aprovados.
- Limites: sem medição em browser, sem PostgreSQL real e sem sessão real de Técnico. As rotas antigas mantêm-se.

## Restantes pontos da análise (não iniciados)

5. Descarregar o código da página inicial em paralelo com a sessão. 6. Permissões do menu na resposta da sessão. 7. Agrupar verificações de autorização do relatório. 8. Medir a consulta do relatório com `EXPLAIN` em staging. 9. **Medido no staging em 14/11/2026 (pedidos públicos, sem sessão):** compressão Brotli ativa, mas `/assets/*` e o `index.html` são servidos com `Cache-Control: no-store`. O JavaScript principal (112 KB comprimidos, ~0,6 s) e o CSS (22 KB, ~0,6 s) são descarregados de novo em cada carregamento, tal como o código de cada página. Correção no Caddyfile da VPS (fora do repositório): cache longa e `immutable` só para `/assets/*`, que têm hash no nome; `index.html` e `/api` continuam sem cache. Por aplicar. 10. PERF-01.
