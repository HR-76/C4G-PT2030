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

## Não feito

6. **Servidor: verificações repetidas por linha.** Na lista de interesses e nos resumos, `capabilities()` repete por linha quatro autorizações que não dependem da linha (registar interesse, criar candidatura, ler oportunidades, editar equipa), cada uma com o seu registo de auditoria; `opportunityInterests/composition.js` não reutiliza decisões dentro do pedido, ao contrário de `applications/composition.js`. Mexe em autorização e auditoria: exige testes e medição em PostgreSQL real.
