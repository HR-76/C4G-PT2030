# Chat da equipa: menos texto e botão mais visível

Estado **Review** — 23/11/2026. Da parte 2 só o destaque visual foi implementado; ver «Decisão» no fim. Complementa [Chat da equipa da candidatura](application-team-chat.md) e [Retenção do chat](application-chat-retention.md).

## Parte 1 — Frases explicativas retiradas (implementada)

Só frontend, em `frontend/src/pages/Applications`. Nenhum contrato HTTP muda.

- Painel do chat: sai «As conversas de candidaturas fechadas são eliminadas 90 dias depois. Exporte uma cópia se precisar dela.». O botão «Exportar conversa» mantém-se. O aviso mostrado depois de uma conversa ter sido eliminada (com a data) mantém-se, porque explica um histórico vazio.
- «Equipa e tarefas»: saem «Os resumos da equipa referem-se à lista «Todas» já carregada.», «A pesquisa abrange todas as tarefas da candidatura. O calendário mostra os resultados apresentados.» e «Tarefas abertas primeiro nas tarefas carregadas.».
- A contagem «N tarefas apresentadas.» era o conteúdo de uma região `role="status"`: é o que anuncia a um leitor de ecrã o resultado de mudar de filtro. Fica na mesma região, apenas para leitores de ecrã (`sr-only`), com «Existem mais resultados deste filtro.» quando aplicável. «A pesquisar tarefas…» continua visível enquanto o filtro carrega.

Aceitação: as quatro frases não aparecem no ecrã; mudar de filtro continua a anunciar a contagem na região de estado; «Exportar conversa» funciona como antes; suite do frontend, build e lint aprovados.

## Parte 2 — Botão «Chat da equipa» com destaque e aviso de mensagens novas (proposta)

Hoje o servidor não sabe o que cada pessoa já leu: `GET …/chat` devolve as últimas 25 mensagens (`messageId`, `own`, `createdAt`) e o painel só consulta o servidor enquanto está aberto (de 15 em 15 s). Não existe contagem de não lidas.

Proposta, só frontend:

- Guardar no navegador (`localStorage`, por utilizador, organização e candidatura) a última mensagem vista quando o painel é aberto ou recebe mensagens.
- Com o painel fechado, consultar a primeira página do chat ao abrir a candidatura e de 60 em 60 s com o separador visível. Há mensagens novas quando existe uma mensagem de outra pessoa posterior à última vista.
- Botão em tamanho normal, com o contorno e o texto na cor de ação. Com mensagens novas: selo com o número (até «25+»), nome acessível «Chat da equipa, N mensagens novas» e anúncio numa região `role="status"`.
- Movimento: um halo que pulsa três vezes (cerca de 5 s) a cada chegada de mensagens novas e depois pára; o selo fica. Com `prefers-reduced-motion` não há animação (política global de `index.css`), fica só o selo.

Limite conhecido: o estado «visto» é por navegador; noutro dispositivo as mensagens voltam a aparecer como novas. Um marcador de leitura no servidor (migração tenant e contagem em `GET …/work`) resolveria isso e fica como evolução posterior.

### Decisão (23/11/2026)

O utilizador recusou a proposta acima: as decisões ficam no servidor e não se acrescenta complexidade nem risco de segurança por causa do aviso. Um estado «visto» guardado no navegador não cumpre isso, e a versão no servidor exige uma migração tenant. Por isso **não há aviso de mensagens novas nem animação**.

Implementado: o botão «Chat da equipa» passa a tamanho normal, com contorno de 2 px, texto a negrito e ícone de 18 px. Mantém a variante de contorno, para não competir com a ação principal «Adicionar membro». Nome acessível e comportamento inalterados.

Aceitação: o botão abre o painel e recebe o foco ao fechar, como antes; não há pedidos novos ao servidor.

Aceitação da proposta recusada (não aplicável): mensagem de outro membro faz aparecer o selo e o nome acessível com a contagem; abrir o painel limpa-os; mensagens próprias não contam; sem acesso ao chat não há consultas; com movimento reduzido não há animação.
