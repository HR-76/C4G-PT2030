# Prioridade 2 — compreensão dos indicadores e matching

Estado: Em implementação, 09/11/2026. Pedido do utilizador para avançar com a prioridade 2 da revisão de UX.

## Âmbito e aceitação
- Explicar no dashboard o âmbito e a distinção entre catálogo central, oportunidades acessíveis, candidaturas e orçamentos, sem alterar métricas ou permissões.
- Na recusa do matching por limite, apresentar ligação para consulta direta do catálogo e esclarecer que esta não é uma lista de correspondências. Não repetir cálculo nem apresentar resultados parciais.
- Manter nomes de navegação enquanto a sua compreensão por perfis não for validada com utilizadores; não inventar conclusões de entrevistas.
- Preservar o contrato de PERF-03: paginação completa e consistente permanece trabalho técnico próprio, sem aumentar limites ou simular completude. Validar testes focados e build.

## Resultado e limites
- Foi acrescentada informação contextual sobre o âmbito dos indicadores e uma ligação para consultar o catálogo quando o matching recusa o cálculo por limite. A ligação não representa resultados do matching.
- 36 testes focados e build frontend PASS. Não foram alterados cálculos, autorizações ou dados.
- A paginação consistente do matching (PERF-03) permanece por implementar e provar. A compreensão dos nomes pelos utilizadores, bem como a verificação visual na sessão real, mantém-se pendente.
