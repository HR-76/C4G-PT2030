# Consistência de datas e erros administrativos

Estado: Em implementação, 10/11/2026. Pedido do utilizador para avançar com as correções identificadas na revisão de convenções.

## Aceitação
- A data de registo da entidade, recebida como instante, é apresentada em Europe/Lisbon independentemente do fuso do navegador. Datas civis não são convertidas por esta alteração.
- Erros tratados pelo router de diretório de plataforma incluem correlationId do contexto de observabilidade, ou um identificador gerado quando não há contexto; preservam códigos, estado HTTP e campos já expostos. Rotas delegadas mantêm os seus contratos próprios.
- Testes de regressão primeiro, suites e build; consolidar CSS apenas com equivalência verificada e preservar trabalho concorrente. Convenção de formatação aplicar incrementalmente, sem reformatação global.

## Resultado e validação
- A data de registo é formatada em Lisboa; regressão reproduzida com fuso America/New_York e confirmada após a correção.
- O router de diretório de plataforma inclui correlationId em erros tratados localmente e 405, preservando códigos e campos de validação; rotas delegadas não foram modificadas. Testes confirmam fallback, contexto e campos.
- Removidas declarações de métricas do dashboard substituídas pelas regras efetivas; revisão isolada em 1440/390 confirmou apresentação e ausência de overflow. Padrões incrementais acrescentados aos standards, sem formatador global.
- Frontend: suite completa e build PASS. Backend: testes de contrato PASS e suite completa PASS com loopback autorizado; a primeira execução no sandbox teve EACCES, e a primeira fora do sandbox revelou teste de envelope exato atualizado para verificar o novo identificador. `node --check` e diff check PASS. Testes de integração com bases externas não foram executados.
