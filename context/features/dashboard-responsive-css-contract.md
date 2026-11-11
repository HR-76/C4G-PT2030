# Contrato CSS responsivo do Dashboard

## Estado

Review — 26/10/2026.

## Objetivo

Repor a hierarquia visual do Dashboard da organização depois da substituição dos componentes do piloto, garantindo que o markup atual e o CSS usam o mesmo contrato e que a apresentação continua legível em desktop e móvel.

## Âmbito

- Estilizar os elementos atuais `stat-item`, `metric-row`, `metric-bar` e `dashboard-list`.
- Preservar a identidade visual C4G, os dados, a navegação e o comportamento funcional existentes.
- Manter os cabeçalhos dos cartões operacionais compactos em ecrãs estreitos.
- Reforçar a validação automatizada da geometria e dos estilos computados em 1440 px e 390 px.

## Fora do âmbito

- Alterar métricas, fórmulas, permissões, endpoints ou dados.
- Redesenhar o relatório da organização.
- Alterar filtros ou destinos dos indicadores.
- Reestruturar a navegação global.

## Critérios de aceitação

1. Os quatro indicadores são blocos separados, com valor, rótulo e detalhe em linhas legíveis.
2. Em desktop, os indicadores ocupam uma linha; em 390 px, formam uma coluna sem sobreposição nem overflow horizontal.
3. Linhas do pipeline apresentam rótulo, total e barra preenchida visível quando o total é positivo.
4. Listas do Dashboard não usam marcadores ou recuos nativos e mantêm separação entre registos.
5. No móvel, ícone, título e ação dos cartões operacionais permanecem associados no mesmo cabeçalho.
6. O teste funcional direcionado e o build do frontend passam.
7. A validação Chrome em 1440 px e 390 px comprova geometria, estilos computados e ausência de overflow horizontal.

## Assunções

- O screenshot fornecido representa o estado atual a corrigir.
- A linguagem visual anterior do Dashboard é evidência de intenção, não um pedido de recuperar conteúdo ou estruturas específicas do piloto UBI.

## Resultado e validação

- Contrato CSS reposto para indicadores, pipeline, listas e cabeçalhos operacionais.
- Teste frontend direcionado: 7/7 PASS.
- Sintaxe dos dois verificadores Chrome e do ensaio isolado: PASS.
- Ensaio Chrome isolado em 1440 px e 390 px: PASS, sem overflow; quatro KPIs na mesma linha em desktop e empilhados com separadores no móvel; barras visíveis; listas sem estilo nativo; cabeçalho operacional horizontal.
- Capturas e medições: `output/playwright/dashboard-responsive-css-contract/`.
- O build frontend não concluiu por erro sintático anterior e fora deste recorte em `frontend/src/pages/Organization/EntityAdmission.jsx:44` (`finally` inesperado).
- O gate PostgreSQL/HTTP não chegou ao browser porque o fixture central ainda não inclui a migration ativa `032_single_organization_membership`.
- A prova habitual OIDC autenticou, mas o Dashboard não renderizou enquanto o frontend esteve afetado pelo mesmo erro sintático externo.

