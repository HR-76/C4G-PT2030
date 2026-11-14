# Abertura de Interesses — desempenho

Estado: Review. Sem medição em ambiente real.

Quarto bloco da revisão de desempenho página a página (14/11/2026), depois do [Dashboard](dashboard-opening-performance.md), das [Oportunidades e Candidaturas](opportunities-table-opening-performance.md) e do [detalhe da candidatura](application-detail-opening-performance.md).

## Alterações (só frontend)

1. **Ficha sem esperar pelas unidades.** A ficha aparece quando o interesse e o histórico chegam; as unidades, que só servem o formulário de análise, carregam a seguir.
2. **Reabertura imediata da ficha.** Registo e primeira página do histórico usam os [dados confirmados](confirmed-reads-page-reuse.md): aparecem de imediato e são lidos de novo; uma leitura recusada retira-os. Uma análise em edição não é substituída quando a resposta confirma a revisão que já está no ecrã.
3. **«Preparar candidatura» entrega o que leu.** Da lista e da ficha, a navegação leva o interesse e a oportunidade acabados de ler; o formulário usa-os em vez de os pedir outra vez quando são o mesmo registo e revisão e têm menos de 60 s. Um interesse só mostrado a partir da memória não é entregue. O servidor continua a validar as duas revisões ao criar.
4. **Filtro de unidades da lista** reabre com as unidades confirmadas.
5. **Candidaturas da organização na ficha** pedidas depois de os pedidos da página terminarem (`OpportunityApplications` com `afterPage`).

## Validação

- `InterestFlow.test.jsx` (+5) e `PrivateApplications.test.jsx` (+1). Frontend 1049 aprovados, build e lint aprovados. Sem browser nem sessão real.

## Ponto 6 — uma decisão por pedido nas leituras (servidor, 14/11/2026)

Na lista de interesses, `capabilities()` repetia por linha quatro autorizações que não dependem da linha (registar interesse, criar candidatura, ler oportunidades, editar equipa), cada uma com a sua evidência de auditoria. `createOpportunityInterestRepository`, que serve uma única operação protegida, aceita agora `reuseDecisions`: cada pergunta é decidida uma vez e a resposta reutilizada. O que depende da linha (ler e gerir cada interesse) continua a ser perguntado por linha. `composition.js` liga-o só nas leituras, e cada reutilização confirma que a guarda continua atual, como no browse de candidaturas e nos alertas. Uma decisão que não pôde ser tomada continua a falhar a operação e nunca é guardada. As escritas perguntam sempre.

Com 25 linhas, passa de cerca de 150 autorizações para cerca de 55 por pedido de lista. Consequência: a auditoria passa a ter uma evidência por pergunta em cada operação de leitura, em vez de uma por linha; as decisões são as mesmas.

Validação: `opportunityInterestDecisions.test.js` (3), RED antes e GREEN depois; 76 testes de interesses aprovados. Suite backend: 3262 aprovados, 9 ignorados e 1 falha em `launcherDrain.test.js`, que não toca em interesses e passa isolado (8 de 8, duas vezes). Lint aprovado. A ligação em `composition.js` não tem teste próprio de composição. Sem PostgreSQL real nem medição.
