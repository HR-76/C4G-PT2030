# Importação central — disponibilidade e experiência inicial

Estado: Review. Data: 2026-11-02.

Incremento focado da [recuperação funcional](ubi-functional-recovery-specification.md), autorizado pelo pedido de avançar componente a componente. C4G/Super Admin gere catálogo e importação central; administradores clientes não acedem a esta operação.

## Âmbito

Separar a página central do formulário privado histórico. Consultar o endpoint administrativo de disponibilidade existente sem converter uma resposta válida de indisponibilidade num erro artificial. Preservar links ao Excel oficial e catálogo. Não ativar uploads, staging, publicação ou serviços; a composição central ainda não está registada no runtime. Decisões de publicação/reimportação continuam no contrato geral e não bloqueiam esta correção de apresentação.

## Aceitação

1. C4G sem entidade consulta disponibilidade; clientes não fazem a consulta.
2. `available:false` é um estado informativo, sem formulário de upload nem histórico fictício/erro de histórico.
3. Falhas HTTP são erros recuperáveis; nova consulta não reutiliza um estado obsoleto. Resposta inválida não é interpretada como disponibilidade.
4. Links oficiais e catálogo ficam disponíveis nos estados de consulta, indisponibilidade e erro.
5. Nunca chamar APIs privadas. `available:true` não ativa o formulário privado: até integração central completa, apresentar estado explícito de percurso ainda indisponível.
6. Respostas tardias após desmontagem/troca de utilizador são descartadas. Testes direcionados, suite frontend e build; sem alterações backend.

## Próximo incremento

Ligar documento central verificado e pré-visualização ao runtime administrativo, reutilizando `portugal2030/composition.js` e o parser V2; reconciliar publicação/reimportação antes de permitir efeitos no catálogo.

## Implementação e validação

- `platformImportsApi.availability` consulta a disponibilidade administrativa real; removido o erro artificial do antigo método `list`.
- A página central tem apresentação própria e não monta o formulário privado. Mantém link ao Excel oficial, catálogo, carregamento, indisponibilidade, erro recuperável e proteção contra respostas tardias. Resposta `available:true` não autoriza encaminhamento para endpoints privados.
- Regressões executadas antes da alteração: quatro falhas esperadas e 11 testes anteriores aprovados. Depois da alteração: 15/15 testes de importação aprovados; suite frontend 80 ficheiros/635 testes aprovados; build Vite aprovado; diff check sem erros de whitespace.
- A suite emite mensagens de simulação de falha de chunk e limitação de navegação jsdom, sem testes falhados. Não foi feito ensaio visual em browser autenticado nem importação real; estado Review, sem declarar operação central concluída.
