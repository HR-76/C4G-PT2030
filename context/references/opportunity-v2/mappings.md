# Mapeamentos normativos do contrato v2.0

Este documento fixa os resultados esperados dos adaptadores `eu-funding-type8-v2.0` e `pt2030-plan-xlsx-v2.0`. Complementa o [contrato](contract.md), o [schema fechado](opportunity-v2.schema.json) e os [seis exemplos completos](examples.md). Não descreve uma importação executada nem certifica o armazenamento ou os endpoints atuais da APP.

Os destinos abaixo incluem `.value` quando atravessam um `Fact<T>`. Cada facto recebe também `state`, `reason` e `evidenceRefs`; omitir esse envelope ou substituir ausência por texto «Por confirmar» viola o contrato. Os caminhos com `[*]` representam todos os elementos, sem escolher silenciosamente o primeiro. As referências de evidência são locais a cada snapshot.

## 1. EU Funding & Tenders — chamada 11145

Origem: [página oficial 11145](https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/competitive-calls-cs/11145). A [resposta oficial preservada](evidence/eu-11145.json) foi observada em `2026-10-30T22:45:39.461Z`, com SHA-256 `21e07eb79a478de23ca126fd8377733f82c6731ac24fe91313a79b2ed186f2a6`. Os [metadados da consulta](evidence/eu-11145.metadata.json) registam endpoint, filtros e cobertura. O resultado contém uma chamada de tipo `8`; o mapping não generaliza este formato às chamadas de tipo `1`.

### Identidade e origem

`$.results[0].metadata.callccm2Id[0]="11145"` determina `sourceRecords[0].externalId="CASCADE:11145"`, `sourceRecords[0].key="EU_FUNDING_TENDERS:CASCADE:11145"` e `identity.kind="CASCADE_CALL"`. O namespace é `EU_FUNDING_TENDERS`, transporte `API` e papel `CALL`. São dimensões distintas: mudar de transporte não cria outra identidade.

`$.results[0].metadata.ccm2Id[0]="46214053"` é outro identificador. Tanto `$.results[0].url` como `$.results[0].metadata.url[0]` apresentam um URL com esse número. Não o usar como ID da cascata nem como URL canónico. `links.official.value` e `sourceRecords[0].url` são reconstruídos a partir de `callccm2Id`, com o caminho `/competitive-calls-cs/11145`; registar `SOURCE_URL_RECONSTRUCTED_FROM_CALL_ID`.

### Campos e transformações

Os JSONPaths da primeira coluna referem-se à resposta integral. A evidência persistida usa o JSON Pointer equivalente; por exemplo, `$.results[0].metadata.budget[0]` corresponde exatamente a `/results/0/metadata/budget/0`.

| JSONPath da origem | Destino v2 | Resultado e transformação |
| --- | --- | --- |
| `$.results[0].content` | `description.title.value` | `Gnomon Internships Offer`; NFC e trim, evidência `call-title` |
| `$.results[0].summary` | `description.summary.value` | Resumo publicado; nesta resposta coincide com o título, evidência `summary` |
| `$.results[0].language` | `description.language.value` | `en`, evidência `language` |
| `$.results[0].metadata.callccm2Id[0]` | `identity.references.value[0].value` | `11145`, referência `SOURCE_CALL_ID`, evidência `call-id` |
| `$.results[0].metadata.identifier[0]` | `identity.references.value[1].value` | `DIGITAL-2023-SKILLS-05-SPECIALEDU`, referência `TOPIC_REFERENCE`, evidência `topic-id` |
| `$.results[0].metadata.frameworkProgramme[0]` | `programmes.value[0]` | ID `43152860`, código `DIGITAL`, label `Digital Europe Programme (DIGITAL)`; correspondência no catálogo fixado |
| `$.results[0].metadata.description[0]` | `parties.value[0]` | `Gnomon Informatics SA`, papel `DIRECT_AWARDER`; nome e papel explicitamente descritos, evidência `direct-awarder` |
| `$.results[0].metadata.type[0]` | `publication.value` | Tipo `8` deste registo publicado → `PUBLISHED`, evidência `source-type` |
| `$.results[0].metadata.startDate[0]` | `schedule.opening.value` | `2025-06-30T00:00:00.000Z`, precisão `INSTANT`, fuso original `+00:00`, evidência `opening` |
| `$.results[0].metadata.deadlineDate[*]` | `schedule.deadlines.value[*].at` | Todos os sete cut-offs; converter offset para UTC, ordenar e deduplicar sem perder fases distintas; evidência `deadlines` |
| `$.results[0].metadata.deadlineModel[0]` | `schedule.deadlineModel.value` | `multiple cut-off` → `MULTIPLE_CUTOFF`, evidência `deadline-model` |
| `$.results[0].metadata.status[0]` | `status.published.value`, `status.publishedCode.value` | `31094502` → `OPEN`; conservar também o código original, evidência `status` |
| `$.results[0].metadata.budget[0]` | `financing.allocations.value[0].money.amount` | `120000` como decimal canónico exato, evidência `budget` |
| `$.results[0].metadata` — ausência de moeda do total | `financing.allocations.value[0].money.currency` | `NOT_FOUND`, `value=null`, `CURRENCY_NOT_DECLARED`, evidência `currency-absence` |
| `$.results[0].metadata.description[0]` | `financing.support.value[0]` | Máximo mensal explícito: `maximum="1500"`, `minimum=null`, `currency.value="EUR"`, `unit="PER_PERSON_MONTH"`; evidências `monthly-support` e `support-currency` |
| `$.results[0].metadata.projectAcronym[0]` | `relatedProject.acronym.value` | `SUSA`, evidência `projectAcronym` |
| `$.results[0].metadata.projectName[0]` | `relatedProject.name.value` | `Sustainable Healthcare with Digital Health Data Competence`, evidência `projectName` |
| `$.results[0].metadata.projectId[0]` | `relatedProject.grantAgreementNumber.value` | `101190010` como texto identificador, evidência `projectId` |

`$.results[0].metadata.callTitle[0]` confirma o título da cascata. `$.results[0].metadata.title[0]` é `Specialised education programmes in key capacity areas`, o título do tópico associado: não substitui `description.title.value`. A referência do tópico e o acordo do projeto não são referências intercambiáveis.

O catálogo [eu-programme-taxonomy.json](evidence/eu-programme-taxonomy.json), versão `eu-framework-2026-10-29`, fixa a correspondência usada por `mapping="VERIFIED"`. A key do conceito é `EU_FRAMEWORK_PROGRAMME:62ef862087520b30`, com `sourceId="43152860"`, `code="DIGITAL"` e `schemeVersion` igual à versão fixada. É evidência de correspondência com a taxonomia local versionada; a consulta de 11145 não constitui nova validação independente de todas as entradas desse catálogo oficial referenciado. Não converter um ID desconhecido pelo catálogo em programa inventado.

### Calendário completo

O calendário confirmado tem estes instantes, com `phase=null` em cada prazo e `originalTimezone="+00:00"`:

```text
2025-09-02T04:59:00.000Z
2026-01-03T04:59:00.000Z
2026-09-02T04:59:00.000Z
2027-01-03T04:59:00.000Z
2027-09-02T04:59:00.000Z
2028-01-03T04:59:00.000Z
2028-09-02T04:59:00.000Z
```

`$.results[0].metadata.closingDate[0]="2026-05-19T00:00:00Z"` fica na evidência `unused-closing`, com transformação `EXCLUDE_NON_CALENDAR_METADATA` e issue `SOURCE_CLOSINGDATE_NOT_A_DEADLINE`. Não pertence ao calendário desta chamada; esta exclusão não exige atribuir-lhe outro significado não comprovado. O último prazo é `2028-09-02T04:59:00.000Z`; o próximo é uma projeção dependente de `asOf`, fora do snapshot factual. Não eliminar os cut-offs anteriores ao dia da recolha.

### Dinheiro, entidades e limites de cobertura

A única dotação tem `scope="CALL_TOTAL"`, `basis="CONFIRMED"`, `aggregation="STANDALONE"`, `money.interpretation="PUBLISHED_AMOUNT"`, referência ao programa, nenhum fundo identificado, `period=null`, `sharedGroup=null` e nenhum qualificador. `CONFIRMED` refere-se ao montante publicado, não a financiamento atribuído a um candidato.

A descrição declara separadamente um máximo de €1 500 por mês de estágio e uma estrutura estimada de 20 estágios de quatro meses. A coleção `financing.support.value` conserva esse apoio e as suas condições; a moeda EUR tem evidência própria no símbolo publicado. Não multiplicar esses números para obter a dotação, não somar o apoio ao total, não converter a estimativa em compromisso e não propagar a moeda do apoio para `financing.allocations.value[0].money.currency`. A resposta confirma o montante `120000`; a confirmação independente do par total/moeda «120 000,00 €» exige evidência adicional aplicável ao total.

O concedente direto é Gnomon. A presença no portal europeu e a associação ao programa DIGITAL não autorizam preencher automaticamente `European Commission` como `DIRECT_AWARDER`. Um eventual `PROGRAMME_FUNDER` necessita de evidência própria e de papel explícito.

Neste mapping, `financing.rates`, `financing.eligibleCosts`, a classificação, as condições/beneficiários/territórios, as modalidades, os links de submissão/documentos e as datas previstas ficam `NOT_COLLECTED` quando não abrangidos pelo extrator, ainda que a narrativa possa conter informação relevante. Não declarar `NOT_FOUND` por não ter interpretado essa narrativa. `funds` e `relatedProject.url` ficam `NOT_FOUND` com evidência do registo inspecionado e motivos específicos do exemplo. A resposta integral permanece recuperável; campos não mapeados não são apresentados como extraídos.

## 2. PT2030 — plano de avisos fornecido em XLSX

Mapping `pt2030-plan-xlsx-v2.0`. Origem: `PlanoAnualAvisos_download_140926-1.xlsx`, SHA-256 `f5d81e3a2fcf31fac5b4545a4e7625c9f0c22333f28cc301ad4b61a7845f5869`. A [extração lexical](evidence/pt2030-plan-177.json) conserva valores e tipos das 2301 células de dados: 177 linhas, 13 colunas, folha `Sheet1`, cabeçalhos na linha 2 e dados nas linhas físicas 3–179. O original não é alterado nem executado. Não foram encontradas fórmulas, ligações externas de workbook ou hyperlinks.

Cada linha gera um candidato independente com `identity.kind="CALL"`, namespace `PORTUGAL2030_PLAN`, transporte `XLSX` e papel `PLAN`. O ID textual de A determina `sourceRecords[0].externalId`, a key local `PT2030_PLAN:<ID>` e uma referência de tipo `PLAN_ID`; não é assumido como código oficial de aviso publicado. A posição física serve de locator, não de identidade. A URL da origem é null, pois o ficheiro não fornece uma por linha.

### Destino obrigatório das 13 colunas

Em cada exemplo, `cell-A` a `cell-M` identificam a célula `Sheet1!<coluna><linha física>`. O cabeçalho integral é evidência `headers`, locator `Sheet1!A2:M2`.

| Coluna e cabeçalho exato | Destino v2 | Transformação |
| --- | --- | --- |
| A — `ID` | `identity.references.value[0].value`, `sourceRecords[0].externalId` | Identificador textual, NFC/trim; não converter em medida numérica |
| B — `Tipo Ent. Beneficiária` | `eligibility.beneficiaryTypes.value[*]` | Lista por `\|`; conceitos `PT2030_BENEFICIARY_LABEL` |
| C — `Natureza Aviso` | `classification.callNature.value` | Conceito `PT2030_CALL_NATURE_LABEL`; preservar Concurso/Convite |
| D — `Designacao do Aviso` | `description.title.value` | Texto NFC/trim; preservar acentos e conteúdo |
| E — `Programa` | `programmes.value[*]` | Lista por `\|`; conceitos `PT2030_PROGRAMME_LABEL` |
| F — `Objetivo Especifico` | `classification.specificObjectives.value[0]` | Separar código de origem e descrição quando a estrutura explícita `código - descrição` o permite; esquema `PT2030_SPECIFIC_OBJECTIVE` |
| G — `Fundo` | `funds.value[0]` | Conceito `PT2030_FUND_LABEL`; neste ficheiro há um fundo por linha |
| H — `Dotação Fundo` | `financing.allocations.value[0].money.amount` | Decimal exato do valor XML, sem agrupadores; não usar o texto formatado da célula |
| I — `Data Inicio Prevista` | `schedule.plannedOpening.value.value` | Serial Excel 1900 → `YYYY-MM-DD`, precisão `DATE` |
| J — `Data Fim Prevista` | `schedule.plannedClosing.value.value` | Serial Excel 1900 → `YYYY-MM-DD`, precisão `DATE` |
| K — `Quadrimestre` | `schedule.planningPeriod.value.label` | Preservar Q1/Q2/Q3; esquema `PT2030_PLAN_FOUR_MONTH`, `start=null`, `end=null` |
| L — `NUTS II` | `eligibility.territories.value[*].concept` | Lista por `\|`; conceitos `PT2030_NUTS_II_LABEL`, cada território com `scope="UNSPECIFIED"` |
| M — `Modalidade Apresentação Candidatura` | `applicationModes.value[*]` | Lista por `\|`; conceitos `PT2030_APPLICATION_MODE_LABEL` |

A classificação `publication.value="PLANNED"` provém do contexto do documento, evidência `document-title`, locator `Sheet1!A1`. O timestamp de modificação do workbook é metadado documental: não demonstra publicação de cada aviso nem atualidade no portal PT2030.

### Conceitos, listas e keys

Aplicar trim e normalização Unicode NFC a cada texto. Nas colunas de listas B/E/L/M, separar pelo carácter literal `|`, normalizar cada elemento, deduplicar apenas labels iguais e ordenar pela ordem Unicode, sem dependência do locale do host. Não dividir labels por espaços, hífen, barra ou `+`; por exemplo, `FSE+` e `Extra-Regio NUTS II` são labels integrais. Uma célula inesperada ou elemento sem interpretação segura requer erro/estado explícito, nunca descarte silencioso.

Todos os conceitos PT2030 dos exemplos têm `mapping="UNMAPPED"`, `schemeVersion=null` e `sourceId=null`. `code=null`, exceto quando o código está escrito na própria coluna F. A key é `<scheme>:<primeiros16hex(SHA256(UTF-8(NFC(trim(label)))))>`. Para F, o hash usa a descrição separada: `RSO2.1 - Eficiência energética` resulta em `code="RSO2.1"`, `label="Eficiência energética"` e key `PT2030_SPECIFIC_OBJECTIVE:a862324a24720b40`. O conteúdo integral de F continua na evidência. Não atribuir um código a partir do nome do programa, fundo ou região; um código nativo observado não equivale a uma correspondência taxonómica verificada.

As keys das listas `programmes.value` e `funds.value` alimentam `financing.allocations.value[0].programmeRefs` e `financing.allocations.value[0].fundRefs`. Todas as referências têm de resolver no mesmo snapshot. Uma key igual com label, código ou identidade de origem diferentes é colisão e erro; não fundir códigos distintos com o mesmo rótulo. Labels territoriais AML, RAA, RAM e Extra-Regio NUTS II permanecem intactos, sem inferir uma versão NUTS ou âmbito territorial da operação/candidato. Registar as pendências taxonómicas conforme os exemplos.

### Dinheiro e calendário previstos

H produz exatamente uma dotação por linha: `scope="FUND_ALLOCATION"`, `basis="PLANNED"`, `aggregation="UNKNOWN"`, `period=null`, `sharedGroup=null` e nenhum qualificador. Associar todos os programas de E a essa mesma linha, sem duplicar ou repartir o montante. Os exemplos 8614 e 8514 conservam, respetivamente, três programas/`51000000` e seis programas/`40000000`. Não somar linhas como total certificado sem evidência de aditividade.

Preservar a precisão decimal lexical: o exemplo 8583 conserva `18181527.09`. O único zero, 8664 em H23, mantém `amount="0"`, `interpretation="ZERO_UNEXPLAINED"` e issue própria; não passa a null nem significa ausência de apoio. Valores positivos usam `PUBLISHED_AMOUNT`. Aplicam-se os limites decimais do contrato, sem conversão intermédia para ponto flutuante nem arredondamento silencioso.

Nem o cabeçalho H nem o formato `#,##0.00` declaram moeda. Por isso, `financing.allocations.value[0].money.currency` fica `NOT_FOUND/null`, motivo `CURRENCY_NOT_DECLARED`, em todas as 177 linhas. A localização portuguesa do ficheiro não é evidência suficiente de EUR.

I/J contêm datas civis, no sistema Excel 1900 declarado pelo workbook; conservar `DATE`, sem fabricar meia-noite UTC. O adaptador tem de respeitar o sistema de datas do ficheiro e tratar explicitamente seriais inválidos. K é um quadrimestre de planeamento; Q1 não significa trimestre janeiro–março. O anexo não fixa os limites do período por linha: conservar bounds null e `PLANNING_PERIOD_BOUNDS_NOT_DECLARED`. Não copiar os limites de outra página ou observação sem vínculo comprovado.

`schedule.opening`, `schedule.deadlines` e `schedule.deadlineModel` ficam `NOT_FOUND/null`, motivo `CONFIRMED_CALENDAR_NOT_DECLARED`; `status.published` e `status.publishedCode` ficam `NOT_FOUND/null`. As datas previstas não tornam a oportunidade aberta nem confirmam um prazo, mesmo depois de passarem. Uma publicação posterior exige observação e ligação próprias, sem apagar a previsão.

### Ausências e reconciliação das 177 linhas

Campos sem coluna correspondente — resumo, instrumentos, temas, apoio individual, taxas, custos elegíveis e condições — ficam `NOT_FOUND` com evidência `headers` e motivo `NO_COLUMN_IN_SOURCE`, conforme o exemplo. Língua, entidades, projeto e URLs também têm ausência explícita e motivo específico. Não deduzir financiador a partir de Programa/Fundo. Ausência comprovada no ficheiro não afirma que o dado inexiste no portal ou num aviso futuro.

A [projeção das 177 linhas](pt2030-expected-177.json) é um resultado esperado por campo, não um lote de 177 snapshots completos nem uma importação de runtime. Cada entrada conserva `externalId`, `physicalRow`, `sourceColumnsDigest`, título, todas as listas, objetivo original, fundo, montante, datas previstas, quadrimestre e distinção PLANNED/estado/prazos confirmados. O digest cobre os valores e tipos de A–M, com serialização definida em `evidence/pt2030-plan-177.json`; não depende da posição da linha.

A reconciliação exige 177 IDs únicos, 177 projeções e cobertura das 13 colunas por ID, além dos seis snapshots de referência. Alterações de cabeçalhos/estrutura são alterações do contrato da fonte e exigem revisão do mapping; não ignorar colunas novas. Os cinco exemplos PT2030 exercitam multiplicidade, precisão decimal, zero e previsão; não autorizam limitar o adaptador apenas a essas linhas.

## 3. Proveniência e âmbito de validação

`provenance.mappingVersion` identifica a regra acima. Cada observação conserva hash da origem, momento da observação, metadado documental quando existente e coverage; cada evidência aponta ao JSON Pointer ou célula reais. `evidenceRefs`, `observationId`, `sourceRecordKey`, `programmeRefs` e `fundRefs` devem resolver sem cruzar identidades indevidamente. Valores de fontes futuras não reescrevem a evidência fixada destes exemplos.

Os destinos deste documento devem existir no schema e nos snapshots correspondentes. A validação offline verifica essa coerência e a fidelidade às observações preservadas. A execução do parser, a persistência decimal, a API HTTP, a apresentação e a exportação da APP continuam a necessitar das verificações S1–S6; S0 não as declara concluídas.
