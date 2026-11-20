# Alertas — desempenho

Estado: Review. Sem medição em ambiente real.

Sétimo bloco da revisão de desempenho página a página (14/11/2026). Bloco anterior: [Parceiros e Matching](partners-and-matching-opening-performance.md). A medição de 06/11 tinha registado 2,2 a 4 s nos pedidos de alertas.

## Alterações

1. **Uma decisão por candidatura em cada operação** (servidor). Cada leitura de alertas autorizava cada alerta, um a um (candidatura, oportunidade e, quando existe, avaliação), com a respetiva evidência de auditoria. Vários alertas da mesma candidatura repetiam as mesmas perguntas. `createAlertsRepository`, que serve uma única operação protegida, decide agora cada pergunta uma vez e reutiliza a resposta para os restantes alertas. Em leituras protegidas, cada reutilização confirma que a guarda continua atual (`onDecisionReuse`, ligado em `composition.js` como no browse de candidaturas). Uma decisão que não pôde ser tomada continua a falhar a operação e nunca é guardada. Abrange a lista, a contagem do sino, a geração e marcar como lido. Consequência: a auditoria passa a ter uma evidência por recurso consultado em cada operação, em vez de uma por alerta; as decisões são as mesmas.
2. **O sino gera alertas de prazo só quando é devido** (frontend). Gerava em todos os carregamentos de página, numa operação de escrita. Passa a gerar no máximo uma vez a cada 15 minutos por utilizador e entidade (`api/alertGeneration.js`, só em memória); nas restantes vezes lê. Uma geração falhada não conta. Os alertas de prazo são por dia, por isso o intervalo não atrasa nada de visível.
3. **A página de Alertas e o sino não geram duas vezes.** A página gera sempre e regista-o; o sino, que arranca depois dos pedidos da página, só lê.
4. **Foco da janela.** O sino relê ao recuperar o foco no máximo uma vez por minuto. Depois de marcar como lido ou de enviar um aviso continua a reler de imediato.

## Validação

- Backend: `applicationAlertDecisions.test.js` (4), RED antes e GREEN depois; suite 3232 aprovados, 9 ignorados, 0 falhas.
- Frontend: `AlertBell.test.jsx` (novo, 4) e `Notifications.test.jsx` (+1); suite 1069 aprovados; build e lint aprovados.
- Sem browser, sem PostgreSQL real e sem medição do ganho. A ligação da confirmação da guarda em `composition.js` não tem teste próprio de composição.

## Por fazer

- A leitura de alertas continua a percorrer todos os alertas do destinatário para calcular a contagem; com muitas candidaturas distintas o custo mantém-se proporcional ao número de candidaturas.
