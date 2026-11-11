# APIs de oportunidades — conformidade e cobertura (11/11/2026)

Revisão pedida pelo utilizador. Compara o código com a [documentação oficial da API](https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis) (lida na íntegra no browser) e com respostas reais da API pública (apenas leitura, `apiVersion` 2.157.1). Sem base de dados, worker, SQL ou deploy. Complementa a [revisão de 01/11](eu-funding-api-compliance-2026-11-01.md).

## Confirmado contra a API real

| Ponto | Resultado |
| --- | --- |
| Endpoint, POST, `apiKey=SEDIA`, `text=***`, partes JSON em Form Data | Conforme a documentação; HTTP 200. |
| Idioma | A parte `languages:["en"]` é o que filtra (1095 resultados). O parâmetro `language=en` no URL, sozinho, não filtra (15 874). O código envia ambos. |
| Ordenação | A lista de três campos é aceite e devolvida em `sort`; 0 violações do campo principal e 78 empates ordenados em 100 registos. Um único objeto ou nenhuma ordenação dão outra ordem. Repetição estável; páginas 1 e 2 sem sobreposição. |
| Paginação | `pageSize` é limitado a 100 pelo servidor. 100 registos com os `displayFields` atuais ocupam cerca de 770 kB (limite local 2 MiB). |
| Detalhe | A pesquisa por identidade exata devolve 1 registo; o modelo `text="<identificador>"` da documentação devolve 25 variantes de idioma. O código usa a forma mais precisa. |
| Quotas | Nenhum cabeçalho de limite ou `Retry-After` nas respostas; continua sem quota publicada. |
| Interreg Europe e POCTEP | XLSX e as duas páginas `wp-json` respondem 200 com o tipo, `id` e `link` que o código exige. |

## Corrigido

1. **Filtro de período** (`backend/src/fundingTenders/source.js`). O termo `programmePeriod: "2021 - 2027"` excluía 71 registos abertos/previstos: 69 calls em cascata sem período publicado (todas com prazos passados, já excluídas localmente), uma call 2028–2034 (`HUMA-2028-2034-PARTNERSHIP-CERT`, prazo 2033) e uma Europe Direct aberta até 07/01/2027. O termo foi removido; a atualidade continua a ser decidida pelo estado e por prazo futuro. Total remoto 1095 → 1166. `CURSOR_VERSION` 6 → 7: uma continuação em curso termina com `SOURCE_CURSOR_INVALID` e o ciclo seguinte recomeça.
2. **Códigos de programa** (`backend/src/utils/programmeMapping.js`). Doze códigos do FACET oficial apareciam ao utilizador como número: I3, JTM, JUST, NDICI (código atual), INNOVFUND, IMCAP, PERICLES IV, HUMA, EU4H, EMFAF (código atual), IMREG e ED.
3. **Descrição no snapshot canónico V2** (`backend/src/fundingTenders/adapterV2.js`, mapeamento v2.1, a pedido do utilizador). `results[].summary` repete sempre o título; a descrição passa a vir de `metadata.descriptionByte` (tópicos) ou `metadata.description` (cascata). Regra, exemplo e consequências em [mapeamento EU v2.1](../references/opportunity-v2/mapping-eu-v2.1.md). O `mappingDigest` mudou: as oportunidades EU aceites passam a revisão humana e as janelas do escritor têm de ser refeitas.
4. **Taxonomia canónica** (`programmeTaxonomy.json`, versão `eu-framework-2026-11-11`, a pedido do utilizador). De 27 para 33 programas, com extrato do FACET oficial de 11/11: RELEX-PROSPECT, H2020, COSME, ED, HUMA e EU4H.
5. **Tipo 2 — EuropeAid/Prospect** (a pedido do utilizador). A recolha pede os tipos 1, 2 e 8, como o exemplo oficial; identidade, ligação publicada, dotação com moeda e documentos oficiais são mapeados (`eu-funding-type2-v2.1`). Em 19 convites abertos, 13 ficam completos e 6 registos antigos dão conflito e não entram no catálogo. Total remoto 1166 → 1186; cursor v8. Detalhe em [mapeamento EU v2.1](../references/opportunity-v2/mapping-eu-v2.1.md).
6. **Páginas de 100** (a pedido do utilizador). A política aprovada passa de quatro pedidos de 25 para um de 100, o máximo servido pela API. Uma varredura completa real fez 12 pedidos em 8 s (antes seriam 48); a maior resposta teve 891 kB, abaixo do limite de 2 MiB. As pesquisas exatas continuam com 25, dentro do limite de variantes da evidência e da restrição da base de dados. Sem migração: `result_count` já admite 100. Os modos não aprovados mantêm o ensaio de 5 registos. Uma continuação guardada com páginas de 25 termina com `SOURCE_CURSOR_INVALID` e o ciclo seguinte recomeça.
7. **Títulos com mais de 300 caracteres** (a pedido do utilizador). Em vez de rejeitar a call, ficam os primeiros 299 caracteres e `…`. No snapshot canónico a evidência usa `TEXT_NFC_TRIM_EXCERPT` e `quality.issues` recebe `TITLE_EXCERPT`. O índice de pesquisa corta o `content` longo: uma cópia cortada do mesmo `callTitle` (300 ou mais caracteres) deixa de ser tratada como divergência; títulos curtos continuam a ter de coincidir. Caso real: cascata `CASCADE:15681`, antes inválida, agora `FOUND`; a varredura completa passou de 1 para 0 registos inválidos.

Regressões em `backend/test/fundingPageSize.test.js`, `backend/test/fundingType2.test.js`, `backend/test/fundingProgrammes.test.js` e `backend/test/fundingAdapterV2.test.js` (RED/GREEN). Verificação real: `collect` de uma página devolveu 25 registos válidos, total 1166, cursor versão 7; `lookup` da call 2028–2034 devolveu `FOUND`.

## Observações em aberto

- **Seis registos EuropeAid de formato antigo** ficam em conflito por variantes divergentes na própria API e não entram no catálogo.
- **Registos sem prazo futuro.** Dos 1186 registos abertos/previstos devolvidos pela API, 669 só têm prazos passados e são excluídos localmente; 516 são atuais.

## Gates de integração isolados (11/11/2026)

Executados a pedido do utilizador, só com PostgreSQL descartável criado e removido por cada gate. Sem acesso ao ambiente habitual. Os gates que escrevem nas bases habituais (`test/integration/integrations/*-native.cjs`, `official-live.cjs`) não foram corridos.

| Gate | Resultado | Nota |
| --- | --- | --- |
| `opportunity-v2/gate.cjs --isolated` | PASS, 33 verificações | Corpus S6 completo, inclui o adaptador EU v2.1. |
| `opportunity-v2/eu-writer-gate.cjs --isolated --eu-writer` | PASS, 32 | |
| `opportunity-v2/eu-reconciliation-gate.cjs --isolated --eu-reconciliation` | PASS, 43 (2.ª execução) | A 1.ª parou em `RECONCILIATION_FIXTURE_INPUT_DRIFT`: três ficheiros de `catalogRead` foram alterados por outra sessão durante a execução. |
| `opportunity-v2/executor-11145-gate.cjs --isolated --live-11145` | PASS, 17 | Leitura real da 11145. |
| `opportunity-v2/registered-package-gate.cjs` | PASS, 12 | |
| `opportunity-v2/eu-legacy-prearchive-gate.cjs` | PASS, 6 | |
| `opportunity-v2/habitual-installer-gate.cjs` | **FAIL**, 7 de 8 | `APPROVAL_COLLECTION_CHANGED`: `scripts/opportunity-v2-approve.cjs` fixa o conteúdo v2.0 da 11145 (`355df5dc…`); o candidato v2.1 tem `fe959c4b…`. Passava em 31/10. Consequência prevista do mapeamento v2.1; exige decisão. |
| `funding-tenders/core`, `programmes`, `coverage`, `resolution` | FAIL | Anterior a esta revisão: a gravação v1 exige `funderName`, que a recolha EU deixou de produzir na [correção do concedente](../reviews/opportunity-data-standardization/eu-funder-conflict-correction.md). A recolha funciona (`programmes` recebeu 100 registos). |
| `funding-tenders/temporal` | FAIL | Anterior: `column o.current_schema_version does not exist` no esquema instalado pelo gate. |
| `funding-tenders/official` | FAIL | Anterior: o esperado do gate não inclui as colunas `source_review`, `source_reviewed_at` e `source_resolution_id`. |

Os seis gates `funding-tenders` tinham sido executados pela última vez em 28–29/10 e não validam o caminho atual. Evidência em `output/opportunity-v2-*` e `output/funding-*-20261028/`. Nenhum contentor ficou por remover.

### Aprovação habitual da 11145 em v2.1

A pedido do utilizador, `scripts/opportunity-v2-approve.cjs` passou a exigir o conteúdo do candidato v2.1 (`fe959c4b…`, igual ao que o adaptador produz a partir da evidência arquivada) e a ler `examples/eu-11145-v2.1.json`. A prova `habitual-installer-proof.cjs` e `backend/test/opportunityV2HabitualApproval.test.js` usam o mesmo exemplo. `habitual-installer-gate.cjs` voltou a PASS (8 verificações). A revisão já aceite com o mapeamento v2.0 mantém o digest `355df5dc…` em `catalogRead/acceptedEu11145.js` e nos registos históricos em `context/references/opportunity-v2/`.

Suite backend após esta alteração: 2896 aprovados, 7 ignorados, 2 falhas (`f44GateManifestSourceGuard` e o grafo de integração F12). Ambas apontam para `backend/src/security/centralMigrationManifest.js`, alterado às 11:51 UTC por outra sessão a trabalhar em paralelo no repositório; não pertence a esta revisão.

### Gates `funding-tenders` atualizados

A pedido do utilizador. Os seis gates passam pelos seus próprios scripts: `core`, `programmes`, `official`, `coverage`, `temporal` e `resolution`.

| Causa | Correção |
| --- | --- |
| O contrato v1 persistido exige `funderName` e o parser EU deixou de o afirmar (correção do concedente, 31/10). | Gates: `test/integration/funding-tenders/v1FixtureFunder.js` envolve a fonte real e acrescenta um rótulo de fixture explícito; usado por `core`, `programmes`, `coverage`, `resolution`, `temporal`, `crash-worker` e `cascade-reconciliation`. O parser continua a não produzir financiador. |
| O worker real em modo `fixture` (não `live`) não conseguia gravar o registo sintético, pela mesma razão. | Produção, só em modo não `live`: `backend/src/config/fundingTendersWorker.js` rotula o registo sintético com `Financiador sintético (fixture local)`. O modo `live` não muda. |
| `refresh.start` lia `o.current_schema_version` diretamente; numa Central sem o pacote v2 a coluna não existe e a consulta falhava mesmo sem modo canónico. | Produção: `backend/src/fundingTenders/refresh.js` lê a coluna com `to_jsonb(o)->>'current_schema_version'`, como o resto do repositório. Regressão em `fundingTemporalRefresh.test.js`; asserção de `fundingEuWriter.test.js` aceita a forma tolerante. |
| Comparações exatas do modelo de leitura falhavam por campos derivados do relógio (`asOf`, `ageSeconds`). | Gates `programmes`, `official` e `cascade-reconciliation` comparam sem esses dois campos. |
| `official` esperava linhas idênticas após aplicar todo o manifesto e a versão `018`. | O gate aceita colunas acrescentadas depois apenas se forem nulas nas linhas preservadas, e espera a última versão do manifesto. |

Após estas alterações: grupos de testes EU/canónico/catálogo 717 PASS. `eu-writer-gate` teve as 32 verificações funcionais PASS em duas execuções, mas a guarda final `EXECUTOR_GATE_INPUT_CHANGED` falhou em ambas porque outra sessão alterou `backend/src/applications/composition.js` e `frontend/src/api/api.js` durante a execução. A suite backend completa teve 29 falhas; 27 são `F13 productive authorization catalog is invalid` e todas vêm de ficheiros de autorização/candidaturas em edição pela outra sessão (`authorization/catalogs.js`, `applications/chat.js`, entre outros). Nenhuma está nos ficheiros desta revisão.

### Repetição (11/11/2026, 12:49 UTC)

- Suite backend: 2915 aprovados, 7 ignorados, 2 falhas. As duas são do diretório de pessoas (`organizationDirectory`), em edição pela outra sessão nos dez minutos anteriores; as 29 falhas de autorização da execução anterior desapareceram.
- `eu-writer-gate --isolated --eu-writer`: PASS, 32 verificações, incluindo a guarda final de entradas.
