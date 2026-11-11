# Benchmark EU Funding Portal para C4G

Data: 01/11/2026. Estado: recomendação para discussão, não decisão de produto nem plano de implementação.

## Decisão e método

Identificar práticas de descoberta e comunicação aplicáveis à C4G, mantendo o catálogo central, os dados privados por organização e o matching determinístico. Critérios: utilidade na descoberta, redução do esforço de decisão, compatibilidade com contratos existentes e dependências de dados/operação.

A homepage devolveu HTTP 403 à consulta web. Foram consultados conteúdos públicos indexados e versões PDF disponibilizadas pelo próprio portal. Não foi testada a área reservada, a navegação interativa, a acessibilidade, o comportamento móvel ou a entrega de newsletters. Os resultados suportam um benchmark funcional/editorial, não uma auditoria visual ou de desempenho. Não se validaram os prazos das oportunidades junto dos financiadores.

## Evidência externa

- Segmentação por destinatário: a página [Funding for businesses](https://eufundingportal.eu/funding-for-businesses/?print=pdf) reúne oportunidades com resumos que identificam objetivos, beneficiários e valores. Em alguns exemplos distingue orçamento total e apoio individual.
- Descoberta por programa: [Grantwatch](https://eufundingportal.eu/de/Grantwatch/?print=pdf) apresenta um diretório de programas, incluindo Horizon Europe, LIFE, Erasmus+ e Interreg.
- Divulgação recorrente: [EU Calls for Applications](https://eufundingportal.eu/eu-calls-for-applications/?print=pdf) anuncia newsletter diária e subscrição para acesso completo. A mesma versão conserva um título com 2025; isto recomenda prudência sobre atualização editorial, sem provar desatualização de cada chamada.
- Descoberta temática: a página [Entrepreneurship](https://eufundingportal.eu/bg/%D0%BF%D1%80%D0%B5%D0%B4%D0%BF%D1%80%D0%B8%D0%B5%D0%BC%D0%B0%D1%87%D0%B5%D1%81%D1%82%D0%B2%D0%BE%D1%82%D0%BE/?print=pdf), encontrada no índice, agrupa oportunidades de empreendedorismo.
- Apoio à compreensão: o conteúdo indexado de [Horizon Europe Application](https://eufundingportal.eu/fr/horizon-d%27application-europe/?print=pdf) descreve etapas da candidatura. É evidência de orientação editorial, não de gestão de candidaturas dentro do portal.

## Contexto C4G verificado

Produto pretendido: descoberta, matching/qualificação, candidaturas e reporting, conforme [visão](../project-overview.md). Arquitetura aprovada: catálogo central e operação privada em bases por organização, membership central como autoridade, API e worker separados, conforme [arquitetura](../architecture.md).

Implementação observada no código, sem ensaio runtime nesta análise:

- `frontend/src/pages/Opportunities/catalogFilters.js` e `CentralOpportunities.jsx`: pesquisa, programa, períodos de fecho e estado temporal, com filtros na URL.
- `frontend/src/pages/Opportunities/CatalogInterestButton.jsx`: registo de interesse e navegação para interesse ativo/arquivado. Portanto, favoritos/interesses não devem ser propostos como funcionalidade inexistente.
- `frontend/src/pages/Opportunities/opportunityFirstAnalysis.js`: apresentação comum, programa, descrição, datas, dotação e ligação oficial. O [contrato de primeira análise](../features/opportunity-first-analysis.md) e o trabalho atual ainda registam validação pendente.
- [Alertas de candidaturas](../features/c4g-pilot-parity-delivery-4-alerts.md): recuperação documentada em Review; alertas na aplicação, com verificação de prazos durante a sessão. Não equivalem a subscrições de novas oportunidades nem a um serviço de email autónomo.

A referência do piloto UBI e algumas secções históricas da arquitetura não descrevem o runtime atual; não foram usadas para declarar ausentes capacidades já presentes no código. A divergência entre documentos de visão e código sobre o estado de interesses deve ser reconciliada no respetivo trabalho, não alterada por este benchmark.

## Melhorias recomendadas

| Prioridade | Proposta C4G | Relação com benchmark e estado atual | Dependências e limites |
| --- | --- | --- | --- |
| Alta | Atalhos por tema, programa e tipo de entidade | Adaptar a segmentação observada; reutilizar filtros existentes | Temas/beneficiários exigem classificação fiável. Navegação temática não certifica elegibilidade. Manter acesso ao catálogo completo. |
| Alta | Resumos curtos e consistentes | Consolidar a primeira análise já em curso, inspirada na clareza editorial | Preservar os cinco grupos aprovados, dotação da call, moeda e ligação oficial; não repor condições ou diagnósticos removidos por decisão do utilizador. Texto editorial exige proveniência/revisão. |
| Alta, após dados e fontes fiáveis | Pesquisas guardadas e alertas de novas oportunidades | Evolução C4G inspirada pela newsletter; pesquisas guardadas não foram confirmadas no portal | Definir preferência pessoal versus organizacional, frequência e destinatários. Começar na aplicação; email exige operação própria, worker/outbox e revogação de acesso. |
| Média | Guias breves por programa | Adaptar diretório e orientação editorial | Mostrar objetivo e percurso típico, ligação oficial e revisão editorial; condições específicas continuam na chamada. Evitar texto permanente redundante na lista. |
| Média | Comparar duas ou três oportunidades | Proposta própria para apoiar triagem; não observada no portal | Usar os mesmos campos da primeira análise. Não somar dotações nem ordenar moedas diferentes como equivalentes. |
| Posterior | Área pública de descoberta C4G | Hipótese comercial inspirada na distribuição pública de conteúdos | Depende de decisão explícita sobre público-alvo, conteúdo público e aquisição. Só catálogo publicável; nunca interesses, candidaturas ou notas dos clientes. |

## Opções e recomendação

1. Consolidar apresentação e atalhos sobre o catálogo existente: menor dependência operacional e benefício imediato de descoberta. Recomendado primeiro.
2. Acrescentar descoberta proativa com pesquisas guardadas e alertas: maior potencial de recorrência, mas depende de fontes atuais e regras de destinatários. Recomendado a seguir.
3. Construir portal público/editorial: pode apoiar aquisição, mas cria trabalho de conteúdo e uma decisão comercial adicional. Adiar até existir objetivo comercial confirmado.

O percurso recomendado é catálogo → interesse privado → qualificação explicável → candidatura. O interesse já tem suporte no código; o objetivo é tornar o percurso mais claro e útil, não criar outro sistema de favoritos. A explicação do matching deve permanecer na qualificação, sem sobrecarregar a ficha inicial.

Não há evidência suficiente para comparar a gestão interna de candidaturas, a qualidade do matching, permissões ou reporting do portal. A C4G deve desenvolver estes pilares próprios sem alegar superioridade comprovada sobre a área reservada do concorrente. Este benchmark também não justifica um novo conector ou a cópia sistemática de conteúdos.

## Validação futura

Medir tempo até encontrar uma oportunidade relevante, percentagem de pesquisas sem resultados, utilização dos atalhos e conversão de consulta em interesse. Para alertas, medir relevância percebida e desativação. Recolher baseline antes de estabelecer metas; estes indicadores são propostas, não resultados medidos.

Alteração realizada nesta análise: apenas este documento. Sem código, SQL, envios, testes de infraestrutura ou publicação. Novas funcionalidades exigem contrato e critérios de aceitação antes da implementação.

Next step: validar a prioridade de atalhos de descoberta e pesquisas guardadas/alertas, articulando-a com a simplificação de primeira análise já em curso.
