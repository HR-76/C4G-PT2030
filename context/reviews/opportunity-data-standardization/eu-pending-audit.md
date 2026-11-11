# Auditoria factual dos candidatos EU pendentes

31/10/2026. Âmbito: ponto 1 do plano de prioridades. Esta auditoria lê os 137 candidatos `REVIEW`, os cinco alvos `CONFLICT`, a chamada 11145 aceite e os arquivos oficiais imutáveis. O ciclo é `7266ad6b-8880-4ec1-9399-4751187831c5`. O ambiente EU deve permanecer `QUIESCED` com fence 7.

## Critérios de aceitação

1. Inventariar os 137 candidatos com ID, run, digest, motivos, revisão esperada e estado de arquivo, sem aceitar ou migrar qualquer um.
2. Conferir a integridade de cada arquivo pela rederivação do adaptador v2, contar motivos e estados de ausência, e distinguir decisão de migração de defeito de parsing.
3. Identificar os cinco conflitos por ID e distinguir lookup sem arquivo, resoluções históricas e evidência necessária para cada decisão.
4. Comparar a 11145 aceite com a observação oficial arquivada e com os valores SQL atuais, campo a campo. Não inferir moeda, financiador, datas ou estado a partir do nome do portal.
5. Produzir lista concreta de correções e decisões, com prioridade, evidência e critério de conclusão. Verificar que leitura/auditoria não modificou catálogo, fonte ou dados privados.

O portal fornecido é uma aplicação JavaScript cujo HTML público não expõe os campos no acesso textual. A comparação factual usa o arquivo da API de pesquisa da Comissão Europeia de 30/10/2026, guardado com corpo, metadados e SHA-256, e a observação oficial rederivada pelo ciclo de 31/10/2026. Isto certifica as observações arquivadas; uma nova leitura do portal seria uma verificação de frescura separada.

## Resultado da leitura habitual

[Inventário verificável dos 142 casos](../../../output/eu-pending-audit-9dad5e30-9434-45de-bf70-61ca08cd875b/review-inventory.json) e [fila CSV para revisão](../../../output/eu-pending-audit-9dad5e30-9434-45de-bf70-61ca08cd875b/decision-queue.csv). Consulta PostgreSQL `REPEATABLE READ READ ONLY`, com rederivação individual dos 137 arquivos pelo adaptador v2. A fonte permaneceu `QUIESCED`, fence 7; não se executou aceitação nem atualização de catálogo.

| Grupo | Quantidade | Constatação | Decisão proposta |
|---|---:|---|---|
| `REVIEW` | 137 | Todos são cabeças v1, runs `SUCCESS` não limitados, arquivos canónicos válidos, CAS esperado ainda atual, sem correções ou conflitos editoriais no registo legado. Todos têm `LEGACY_MIGRATION_REQUIRES_REVIEW` e `MAPPING_BASELINE_UNAVAILABLE`. | Rever a migração por ID. Não interpretar `REVIEW` como erro do parser nem aprovar em lote por semelhança. |
| `CONFLICT` | 5 | Nenhum tem arquivo canónico v2 nem decisão de writer; o lookup terminou `SUCCESS` mas devolveu `CONFLICT`. O motivo por variante não foi conservado. | Nova leitura oficial limitada por ID, comparação do corpo e registo explícito do motivo antes de qualquer resolução. |
| `DISCOVERED` + `PENDING` | 391 + 2 | Continuam por tratar no ciclo; não pertencem aos 142 casos inspecionados aqui. | Manter no plano do ciclo seguinte, após decisão de retoma. |
| `UNCHANGED` | 1 | A 11145 foi reobservada e permaneceu na revisão aceite. | Preservar a revisão e o arquivo; corrigir apenas a atribuição legada do financiador por percurso próprio. |

Os 137 snapshots v2 candidatos contêm orçamento e calendário estruturados; 129 têm estado publicado `OPEN`, cinco `UPCOMING` e três `CLOSED` na observação de 31/10/2026. Os 137 valores de moeda do orçamento são `NOT_FOUND`; 112 têm acrónimo de projeto e 25 `NOT_FOUND`. Apenas um candidato (`CASCADE:11143`) tem `DIRECT_AWARDER` estruturado; 136 têm partes `NOT_COLLECTED`. Os 137 registos legados apresentam `funderName: European Commission`, preenchido literalmente em [source.js](../../../backend/src/fundingTenders/source.js), linha 42. Dois arquivos (`CASCADE:11143` e `CASCADE:12447`) contêm afirmação explícita de que a chamada não é uma ação da UE; o primeiro já identifica a universidade como concedente direto. A evidência dos outros 135 não autoriza concluir automaticamente quem concede cada apoio.

### Cinco conflitos com decisão individual

| ID | Leitura anterior | Decisão necessária |
|---|---|---|
| `CASCADE:17045` | Um resultado, nenhuma resolução anterior, nenhum arquivo v2. | Repetir lookup oficial e capturar o motivo exato do `CONFLICT` (normalização, estado ou evidência); só depois propor correção ou revisão. |
| `CEF-T-2021-AFIFCOEN-WORKS-LNG` | Dois resultados; resolução editorial AFIF da quinta ronda presente na revisão atual. | Comparar nova evidência e fingerprint com a resolução preservada; manter cinco rondas e último prazo 07/11/2023 até prova contrária. |
| `CEF-T-2021-AFIFCOEN-WORKS-ZE` | Dois resultados; mesma proteção de resolução histórica. | Mesma comparação, com decisão própria para este ID. |
| `CEF-T-2021-AFIFGEN-UNITS` | Dois resultados; resolução histórica AFIF Geral. | Comparar com a convocatória e a decisão deste ID. |
| `CEF-T-2021-AFIFGEN-WORKS-LNG` | Dois resultados; resolução histórica AFIF Geral. | Comparar com a convocatória e a decisão deste ID. |

Os quatro casos AFIF têm os respetivos `funding_resolution` e fingerprints ainda ligados à revisão atual. O simples resultado `CONFLICT` não demonstra que a resolução anterior esteja errada. O recibo do lookup não preserva as variantes ou um código causal discriminado; portanto, a causa exata dos cinco casos continua **não demonstrada**. A correção técnica é guardar um diagnóstico limitado e auditável por variante antes de repetir a operação, sem promover automaticamente nenhum resultado.

## Matriz factual da chamada 11145

O [arquivo da API oficial](../../references/opportunity-v2/evidence/eu-11145.json) tem SHA-256 `21e07eb79a478de23ca126fd8377733f82c6731ac24fe91313a79b2ed186f2a6` e [metadados da captura](../../references/opportunity-v2/evidence/eu-11145.metadata.json) de 30/10/2026. O arquivo real da APP recolhido em 31/10/2026 às 16:34:03.820Z também passou rederivação e repete título, referência, orçamento, projeto, estado e sete prazos. Os factos coincidem com a revisão5 armazenada; a nova data de proveniência não cria uma revisão artificial. A [listagem oficial](https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/calls-for-proposals?frameworkProgramme=43152860&isExactMatch=true&order=ASC&pageNumber=1&pageSize=100&programmePeriod=2021+-+2027&sortBy=deadlineDate&status=31094502) indexada confirma a apresentação como chamada aberta com o próximo prazo em 03/01/2027. O HTML textual da [página 11145](https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/competitive-calls-cs/11145) é uma shell JavaScript; a renderização visual atual, incluindo o símbolo monetário, não ficou certificada neste ensaio.

| Campo | Fonte oficial arquivada | APP atual | Resultado |
|---|---|---|---|
| Título | `Gnomon Internships Offer` | Igual | ✅ |
| Programa e referência | ID `43152860` / DIGITAL; `DIGITAL-2023-SKILLS-05-SPECIALEDU` | DIGITAL e mesma referência | ✅ |
| Fonte | Funding & Tenders; `CASCADE:11145` | Namespace/URL da chamada corretos | ✅ |
| Financiador/concedente direto | Descrição: Gnomon concede o apoio em nome próprio; publicação no portal apenas para divulgação. | v2: `DIRECT_AWARDER = Gnomon Informatics SA`; legado: `funderName = European Commission` | ⚠️ Legado factual incorreto |
| Abertura | `2025-06-30T00:00:00.000+0000` | `2025-06-30T00:00:00.000Z` | ✅ |
| Fecho | Sete cut-offs, último em `2028-09-02T04:59:00.000Z`; `closingDate` da pesquisa não corresponde ao último prazo. | Sete instantes UTC; nenhum fecho único inventado | ✅ |
| Estado publicado | Código `31094502`, aberta na observação | `OPEN`, código preservado | ✅; recalcular estado efetivo com relógio atual |
| Total disponível | `budget = "120000"` | Snapshot decimal `"120000"`; SQL `numeric(32,8)` = `120000.00000000` | ✅ valor capturado e armazenado |
| Moeda do total | Sem chave de moeda no registo API arquivado; o valor mensal de €1500 está na narrativa, com outro âmbito. | `NOT_FOUND`/NULL no total | ⚠️ Apresentação `120 000,00 €` indicada no pedido exige prova da regra de apresentação do portal antes de atribuir EUR ao total |
| Projeto e acordo | SUSA; `101190010` | Iguais, acordo como texto | ✅ |
| Prazos | Sete valores de `deadlineDate` | Sete valores ISO 8601 UTC iguais, na revisão e na projeção SQL | ✅ |

O URL bruto do resultado de pesquisa aponta para o ID interno `46214053`, enquanto o contrato usa o URL estável `.../11145` reconstruído pelo identificador da chamada. A APP assinala essa reconstrução no indicador de qualidade. Ambos devem ser conservados como proveniência distinta e a equivalência de navegação deve ser comprovada antes de retirar o aviso.

## Correções e decisões por prioridade

1. **P0 — Corrigir a atribuição de financiador nos novos dados e na leitura legada.** Remover a atribuição fixa `European Commission` de `backend/src/fundingTenders/source.js:42` para chamadas em cascata. Identificar concedente direto apenas quando a observação o comprovar, mantendo `NOT_COLLECTED` noutros casos. A 11145 exige Gnomon; a 11143 já identifica METU; a 12447 exige extração/revisão específica. Preservar os snapshots v1 históricos e preparar correção editorial versionada para valores já exibidos. Testar o caminho lista/detalhe/exportação v1/v2 para não mostrar a Comissão como concedente direto destes casos.
2. **P0 — Tratar 137 migrações com decisão humana por identidade.** A fila CSV contém ID, título, programa, orçamento, moeda, prazos, projeto, digest e motivo. Cada plano futuro deve revalidar arquivo, CAS e autoridade. O resultado factual desta auditoria é `REVIEW`, não `ACCEPT`. Agrupar para navegação é possível; a aprovação não pode ignorar diferenças de cada candidato.
3. **P0 — Guardar diagnóstico causal dos conflitos.** Em `source.js` e `discoveryDetails.js`, conservar códigos limitados para duplicados divergentes, incompatibilidade de status e conflito de parsing v2, e referência ao arquivo de cada variante quando a fonte permitir. Depois repetir os cinco lookups e comparar os quatro AFIF com as resoluções e os documentos oficiais já preservados. Sem evidência nova, manter `CONFLICT`.
4. **P1 — Esclarecer a moeda do total da 11145.** Confirmar em documento oficial ou regra formal do portal se `120000` tem EUR no âmbito da dotação total. A presença de `€` no apoio mensal e a formatação indicada no pedido não bastam para preencher a moeda da dotação. Se a regra for comprovada, acrescentar extração localizada, proveniência e regressão; se não, manter `NOT_FOUND` com exibição explícita do valor sem moeda confirmada.
5. **P1 — Preservar semântica de calendário e URL.** Continuar a usar todos os `deadlineDate`, sem tomar `closingDate` técnico como fecho. Expor próximo/último prazo derivados e guardar separadamente URL bruto e URL canónico. Testar a 11145 e os avisos com múltiplos cut-offs.

Esta auditoria fecha a **classificação factual** do ponto 1. Não é uma aceitação dos 137 candidatos nem uma resolução dos cinco conflitos. Uma revisão visual atual da página dinâmica da Comissão Europeia não foi obtida: o acesso textual devolveu apenas a shell e o host do browser de automação estava indisponível. Os arquivos oficiais e a observação da APP de 31/10/2026 sustentam as comparações acima.
