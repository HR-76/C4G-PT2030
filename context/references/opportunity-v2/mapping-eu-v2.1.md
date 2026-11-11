# Mapeamento EU v2.1 — descrição a partir da narrativa publicada

Adenda de 11/11/2026 aos [mapeamentos v2.0](mappings.md), que ficam inalterados (artefacto fixado por hash no [manifesto](manifest.json)). Aplica-se a `eu-funding-type1-v2.1` e `eu-funding-type8-v2.1` em `backend/src/fundingTenders/adapterV2.js`. O contrato e o schema `opportunity-v2.0` não mudam.

## Motivo

Na API de pesquisa, `results[].summary` repete o título (25/25 registos na pesquisa e no detalhe, 11/11/2026). O mapeamento v2.0 copiava esse campo para `description.summary`, pelo que as oportunidades EU canónicas ficavam sem descrição. A narrativa publicada está em `metadata.descriptionByte` (tópicos, tipo 1) e `metadata.description` (cascata, tipo 8).

## Regra

| Condição | `description.summary` | Evidência `summary` |
| --- | --- | --- |
| `summary` publicado e diferente do título | Resumo publicado, como em v2.0 | `/summary`, `TEXT_NFC_TRIM` |
| `summary` ausente ou igual ao título, e exatamente uma narrativa não vazia | Narrativa em texto simples (HTML removido, NFC, trim) | `/metadata/descriptionByte/0` ou `/metadata/description/0`, `HTML_TO_TEXT_NFC_TRIM` |
| Narrativa com mais de 4000 caracteres | Primeiros 3999 caracteres e `…`; `quality.issues` recebe `DESCRIPTION_EXCERPT` em `/description/summary` | Mesmo localizador, `HTML_TO_TEXT_NFC_TRIM_EXCERPT` |
| Sem narrativa, ou várias narrativas distintas | Comportamento v2.0: resumo publicado (mesmo que repita o título) ou `NOT_FOUND`/`SUMMARY_NOT_DECLARED` | `/summary` |

O texto nunca é inventado nem composto a partir de vários campos. Deve continuar a ser apresentado como texto, nunca como HTML.

## Artefactos

- [Exemplo 11145 em v2.1](examples/eu-11145-v2.1.json): igual ao [exemplo v2.0](examples/eu-11145.json) exceto `description.summary.value` (2810 caracteres da narrativa), a evidência `summary` e `provenance.mappingVersion`.
- O exemplo v2.0 permanece byte a byte igual. Continua a ser a referência do pacote 11145 já aceite e do `NORMATIVE_CONTENT` em `scripts/opportunity-v2-approve.cjs`.
- `backend/scripts/localPlatform/prepareOpportunityV2Window.js` compara a observação atual com o exemplo v2.1.

## Consequências operacionais

- O `mappingDigest` do escritor EU mudou (ficheiro `adapterV2.js` e versão `eu-writer-mapping-v2.1`). Cada oportunidade EU já aceite passa a revisão humana com `MAPPING_IMPLEMENTATION_CHANGED` na próxima recolha canónica; nenhuma é atualizada automaticamente.
- Pré-visualizações, planos e janelas do escritor preparados com o digest anterior deixam de ser válidos e têm de ser refeitos.
- O fluxo habitual de aprovação da 11145 (`opportunity-v2-approve.cjs`) continua fixado ao conteúdo v2.0 e recusa um candidato v2.1. Não foi alterado.
- O corpus preservado do catálogo habitual (178 oportunidades) mantém a 11145 na revisão v2.0 publicada em 02/11/2026, fixada em `backend/src/opportunities/catalogRead/storedEvidence.eu-11145.v2.0.json` e verificada por `acceptedEu11145.js`. Sem isto, o corpus era rederivado em v2.1, deixava de coincidir com a geração publicada e `npm run dev` falhava com `STORED_CATALOG_EXISTING_CONTENT_REQUIRES_REVIEW` (corrigido em 11/11/2026). Os campos arquivados da ficha aceitam a revisão v2.0 publicada e a derivação atual da mesma evidência. Publicar a 11145 em v2.1 no catálogo habitual continua a exigir revisão e decisão própria.
- Nenhuma base de dados foi tocada por esta alteração.

## Verificação

Testes em `backend/test/fundingAdapterV2.test.js`. Consulta real a 14 oportunidades em 11/11/2026: 11 com narrativa, 3 cascatas sem narrativa publicada (mantêm o título), 0 erros.

## Taxonomia de programas — `eu-framework-2026-11-11`

`backend/src/fundingTenders/programmeTaxonomy.json` passa de 27 para 33 programas, todos presentes no FACET oficial de 11/11/2026 ([extrato](evidence/eu-programme-taxonomy-2026-11-11.json), pedido com tipos 1, 2 e 8, abertos e previstos). Acrescentados: RELEX-PROSPECT (`111111`), H2020, COSME, ED, HUMA e EU4H. Os rótulos são os do FACET, sem alteração. A [evidência de 29/10](evidence/eu-programme-taxonomy.json) fica inalterada.

A versão nova muda `schemeVersion` em todos os snapshots EU com programa e o `mappingVersion` do enriquecimento. A transformação de evidência chama-se agora `EU_PROGRAMME_TAXONOMY_20261111`.

## Tipo 2 — convites de ação externa (EuropeAid/Prospect) — `eu-funding-type2-v2.1`

A [documentação oficial](https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis) lista os tipos 1, 2 e 8 no exemplo de dados filtrados. A recolha passa a pedir os três; concursos públicos (tipo 0) continuam fora.

| Origem | Destino | Nota |
| --- | --- | --- |
| `metadata.identifier[0]` (`EuropeAid/187757/DD/ACT/KH`) | identidade externa e `identity.references` com `CALL_REFERENCE` | `identity.kind = CALL`. A chave do registo de fonte usa o hash da identidade, porque o alfabeto do schema não admite `/`. |
| `metadata.url[0]` | `links.official` e URL do registo de fonte | Ligação publicada, só `ec.europa.eu` ou `webgate.ec.europa.eu` em HTTPS; outro anfitrião invalida o registo. Nunca se fabrica um URL de tópico do portal. |
| `metadata.budget[0]` + `metadata.currency[0]` | `financing.allocations` | `CALL_TOTAL`, `STANDALONE`, como na cascata. |
| `metadata.frameworkProgramme` (`111111`) | `programmes` | RELEX-PROSPECT, `VERIFIED`. |
| `metadata.deadlineDate`, `startDate`, `status` | calendário e estado | Como nos outros tipos. Sem prazo futuro, o registo é excluído da descoberta. |
| `metadata.publicationDocuments[]` | enriquecimento `documents` | Título e URL de cada documento oficial (máximo 8); JSON inválido fica `UNSUPPORTED`. |
| — | `description.summary` | A fonte não publica narrativa para este tipo: fica o resumo publicado, igual ao título. |

Estes registos não têm `ccm2Id` nem `callccm2Id`; a evidência liga as variantes por `callIdentifier`. A pesquisa exata de uma identidade que não seja cascata pede os tipos 1 e 2.

Verificação real em 11/11/2026 (19 convites abertos): 13 `FOUND` com dotação, moeda e documentos; 6 registos de formato antigo (`…/data/topicDetails/…EN`) dão `CONFLICT` por variantes divergentes, cinco deles também sem estado, e não entram no catálogo. Total remoto da descoberta: 1186; cursor versão 8.

## Títulos longos

Um título publicado com mais de 300 caracteres fica com os primeiros 299 e `…`; a evidência `call-title` usa `TEXT_NFC_TRIM_EXCERPT` e `quality.issues` recebe `TITLE_EXCERPT` em `/description/title`. A comparação entre `content` e `callTitle` nas cascatas usa o texto completo. Como o índice de pesquisa corta o `content`, um valor com 300 ou mais caracteres que seja prefixo exato do outro é o mesmo título; abaixo disso, os dois têm de coincidir. A comparação entre resumo publicado e título usa o título completo. Caso real de 11/11/2026: `CASCADE:15681` (349 caracteres em `content`).
