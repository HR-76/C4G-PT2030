# Revisão do conteúdo dos tooltips

Pedido autorizado em 29/10/2026: analisar todos os tooltips da aplicação e eliminar informação sem valor para o utilizador.

## Critérios de aceitação

- Eliminar redundâncias com títulos, campos e estados visíveis e detalhes técnicos de implementação.
- Conservar explicações que evitam interpretações erradas de indicadores, âmbito das fontes, elegibilidade e acesso; usar linguagem breve.
- Mostrar datas e limites de histórico apenas quando disponíveis ou relevantes.
- Preservar identificação de ações por ícone e acesso a títulos truncados; estes atributos title têm utilidade distinta dos parágrafos de ajuda.
- Não alterar cálculos, permissões, recolhas ou contratos HTTP.
- Regressões focadas antes da implementação, suites locais e build.

## Decisões da revisão

Eliminar ajudas da apresentação da organização, navegação para matching e hierarquia de unidades: repetem contexto ou opções do formulário. Eliminar o aviso genérico sobre ausência de erros. Retirar linguagem técnica das fontes (API, Excel, paginação, persistência) e descrições que apenas repetem Erasmus/POCTEP. Manter âmbito Horizon/EURATOM e exclusão de chamadas restritas Interreg. Histórico limitado só merece ajuda quando há truncagem.

Simplificar datas dos dashboards/logs; relatório mantém definições necessárias para interpretar agregados e orçamento, sem repetir valores em falta já indicados nas células. Preservar limites funcionais de matching, critérios e análise parcial. Substituir jargão de competências por distinção clara entre declaração e verificação; remover afirmação incondicional de publicação inativa, cujo estado deve ser o apresentado pelo perfil. Descrição da oportunidade mantém apenas aviso de possível excerto quando existe texto.

Manter ajudas de ações apenas por ícone, texto truncado, abreviaturas e origem privada. Retirar title redundante de fonte no matching e explicação interna do estado Identificada em Registar interesse (o fluxo de criação apresenta a candidatura).

## Inventário final

| Área | Resultado |
| --- | --- |
| Dashboard C4G | Atualização preservada; atividade apenas com início conhecido; distinção entre estado do catálogo e prazo preservada. |
| Dashboard operacional | Apenas data de atualização, quando disponível. |
| Logs | Data disponível e exclusão de erros de autenticação; sem explicação redundante do fuso/início. |
| Relatório | Definições de estados, unidade e orçamento simplificadas. |
| Candidaturas | Explicação breve do efeito dos filtros nas contagens. |
| Fontes | Âmbito relevante, atualização manual sem agendamento e limite de resultados quando aplicável; removidos mecanismos técnicos e ressalva sobre zero resultados. |
| Histórico de sincronizações | Ajuda apenas se a lista estiver limitada. |
| Organização | Três ajudas eliminadas; distinção entre pessoa e conta preservada. |
| Matching | Explicação funcional preservada; title da origem eliminado por repetir a célula. |
| Critérios e análise parcial | Limites funcionais conservados com linguagem direta. |
| Competências | Declaração e verificação distinguidas sem jargão editorial. |
| Oportunidade | Aviso sobre prazo/elegibilidade preservado; possível excerto apenas quando há descrição. |
| Registar interesse | Retirado title com estado interno da candidatura. |
| Ícones e tabelas | Mantidos nomes de ações, expansão de abreviaturas e conteúdo truncado em catálogo, parceiros e matching. |

A revisão abrangeu ocorrências de InfoTooltip e atributos title no frontend, distinguindo props de títulos de modais/estados vazios de tooltips reais. Sem alteração do componente acessível partilhado.

## Validação

Estado: Review, implementação local concluída em 29/10/2026.

- Regressões iniciais: 3 FAIL antes da alteração; foco de seis suites 65 PASS após.
- Fontes e relatório: 17 PASS após atualizar as expectativas de conteúdo removido e preservar os limites úteis de atualização manual.
- Suite frontend: 378 PASS; backend: 1632 PASS, 7 SKIP; build Vite PASS.
- Logs: `output/tooltips-review-*.log`. Sem inspeção visual adicional neste ajuste de conteúdo; componente e estilos dos tooltips preservados.
- Sem commit ou deploy.
