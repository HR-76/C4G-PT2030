# Classificações oficiais e estabilidade da paginação Funding & Tenders

Verificação: 18/10/2026, 12:21–12:24 (Lisboa). Investigação concluída; correções recomendadas ainda não implementadas. A fatia da entrega 4 não deve ser fechada neste estado.

Atualização posterior, 12:35: as recomendações foram autorizadas, implementadas e validadas, incluindo reconciliação explícita e novas importações. [Resultados e limites](../reviews/c4g-pilot-parity-delivery-4-programmes.md). O texto seguinte conserva a evidência e o estado no momento da investigação.

## Pergunta e contexto

Confirmar os programas das chamadas `ESC-HUMAID-2021-QUAL-LABEL-FP` e `CERV-2024-CITIZENS-VALUES`, e distinguir variação da paginação de duplicados reais. O adaptador atual pede quatro páginas de 25, ordenadas apenas por `deadlineDate DESC`, filtra datas atuais e reúne resultados por `metadata.identifier`. O catálogo tem 110 identidades, dez execuções e zero ativas. Preservar limites, dados, histórico e correções manuais; não confundir a implementação recuperada do piloto com um contrato universal de identidade.

## Classificações confirmadas

A [documentação oficial da API](https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis) indica FACET para traduzir os códigos de referência. O POST mínimo com `query` devolveu HTTP 200, versão 2.157, com estes valores em `frameworkProgramme`:

| Código | Designação oficial recebida | Situação na aplicação |
| --- | --- | --- |
| `43251589` | Citizens, Equality, Rights and Values programme (CERV) | Convertido incorretamente para LIFE |
| `43254037` | European Solidarity Corps (ESC) | Sem conversão; apresenta o código numérico |

[Resposta FACET guardada](../../output/funding-programmes/facet-queryOnly.json). A associação de `43251589` a CERV também consta de uma [resposta da Comissão publicada pelo Parlamento Europeu](https://www.europarl.europa.eu/doceo/document/P-10-2026-000238-ASW_EN.pdf), no endereço da ficha do projeto. O [Portal Europeu da Juventude](https://youth.europa.eu/solidarity/organisations/calls-for-proposals_en) enquadra o Quality Label e a ajuda humanitária no Corpo Europeu de Solidariedade.

A pesquisa oficial filtrada pelos dois identificadores devolveu os códigos esperados. Portanto, o caso CERV/LIFE é um erro de conversão local, não uma inconsistência demonstrada na classificação da fonte. Recomenda-se `43251589 → CERV` e `43254037 → ESC`, incluindo regressões e reconciliação auditada dos registos já importados. A pesquisa ESC também mostra prazos antigos: a classificação do programa não equivale à confirmação de oportunidade atualmente aberta.

Um primeiro pedido FACET reutilizando todo o formulário SEARCH devolveu 500; o formulário mínimo `query` funcionou. Isto não exige mudar o adaptador SEARCH. O guia ESC 2026 encontrado na pesquisa contém uma ligação com `43254019`; esse código foi traduzido pelo próprio FACET como European Social Fund. Para os dois casos analisados, prevalece a combinação dos metadados da chamada com a tradução direta do código; não copiar links de guias sem conferência.

## Paginação: resultados controlados

Repetidos três percursos por seleção e variante, sem importação, com `language=en`, mesmos filtros, até quatro páginas e 100 resultados. As respostas confirmam a ordenação aplicada em `sort`, sem warnings. Os totais permaneceram constantes nas três repetições de cada seleção com a ordenação atual; os conjuntos e a ordem variaram.

| Ordenação | Funding & Tenders: identidades distintas por repetição | CORDIS: identidades distintas por repetição | Resultado |
| --- | --- | --- | --- |
| Prazo DESC, atual | 93 / 99 / 100 | 93 / 100 / 99 | Instável; até sete repetições da mesma identidade entre páginas |
| Identificador ASC | 100 / 100 / 100 | 100 / 100 / 100 | Conjunto estável neste ensaio; ordem de chamadas em cascata ainda varia; altera a prioridade de recolha |
| Prazo DESC + identificador ASC + callccm2Id ASC | 100 / 100 / 100 | 100 / 100 / 100 | Mesmo conjunto e mesma ordem nas três repetições; sem repetição da mesma identidade |

O terceiro pedido usa uma lista de objetos `sort`; a API respondeu HTTP 200 e confirmou `[deadlineDate:DESC, identifier:ASC, callccm2Id:ASC]`. Esta capacidade foi verificada experimentalmente no endpoint oficial; a documentação textual consultada não estabelece garantia de snapshot ou de estabilidade sob atualizações concorrentes. A hipótese de empates no prazo como causa é fortemente sustentada pelo resultado do desempate, mas o ensaio não prova o comportamento interno do motor.

Erasmus também manteve conjunto e ordem nas três repetições com desempate: três documentos, duas referências de tópico. Uma referência aparece em duas versões, uma sem prazo atual; o outro tópico também tem prazo passado. A filtragem temporal conserva uma oportunidade atual. Não contar todas as repetições de referência como chamadas distintas.

[Ensaio atual e alternativa alfabética](../../output/funding-programmes/pagination-research.json), [ensaio com desempate](../../output/funding-programmes/pagination-composite.json), [script de investigação sem escritas de negócio](../../output/funding-programmes/pagination-research.cjs).

## Problema adicional: identidade das chamadas em cascata

A pesquisa oficial retornou **sete chamadas distintas de tipo 8** com `identifier=CERV-2024-CITIZENS-VALUES`, títulos diferentes e `callccm2Id` distintos: `11702`, `11674`, `12743`, `15921`, `15545`, `14602`, `11781`. A referência identifica o tópico de origem, não a chamada em cascata individual. [Metadados oficiais guardados](../../output/funding-programmes/classification-raw-records.json).

O adaptador usa esse `identifier` como chave do Map e da identidade central. Assim, chamadas distintas podem ser reduzidas a uma, independentemente da paginação. Na amostra geral com desempate há 100 identidades distintas por tipo/chamada, mas apenas 95 valores de `identifier`; em CORDIS, 100 contra 99. A afirmação anterior «zero identificadores duplicados no catálogo» continua verdadeira como consulta SQL, mas é insuficiente para validar identidade e cobertura: não deteta fusões indevidas.

Recomendação: manter a referência de tópico para chamadas diretas e usar uma identidade própria com namespace para chamadas em cascata, baseada em `callccm2Id`, preservando a referência do tópico como informação. Não reidentificar automaticamente o catálogo existente: identificar o `callccm2Id` efetivamente representado pelo URL/observação atual, conservar o opportunity_id, relações e histórico, e tratar ambiguidades explicitamente antes de separar as restantes chamadas. A regra atual de escolher o prazo menor entre referências repetidas não resolve esta distinção.

## Recomendação e condições para fechar

Corrigir as duas conversões, adotar o desempate composto mantendo prioridade por prazo e corrigir a identidade por tipo. Documentar primeiro o contrato da identidade e a reconciliação dos dados já existentes; testar colisões de chamadas em cascata, preservação de relações/correções/histórico e idempotência entre as três seleções. Só depois repetir importações e conferir dados reais.

Não aumentar limites para compensar repetições nem substituir silenciosamente a prioridade por uma ordenação alfabética. A lista composta elimina a instabilidade observada nesta amostra, mas não garante catálogo completo ou snapshot imutável. A entrega 4 permanece em curso.

Nesta investigação não foram alterados código da aplicação, configuração, bases ou infraestrutura, nem feitas novas importações. Apenas consultas públicas, leitura local e artefactos/documentação. Contagens finais: **110 identidades, dez execuções, zero ativas**. [Resumo verificável](../../output/funding-programmes/classification-pagination-summary.json).
