# Contrato normativo de oportunidade v2.0

S0 fechado em 30/10/2026 por pedido explícito do utilizador. Contrato: `opportunity-v2.0`; `schemaVersion: 2`. A versão fecha a representação e as regras para iniciar S1. Não declara implementação, migração ou ativação concluídas.

Fontes normativas: este documento, [JSON Schema](opportunity-v2.schema.json), [mapeamentos](mappings.md), [exemplos](examples.md) e respetiva evidência identificada por hash. O [plano](../../features/opportunity-data-standardization.md) governa as fases. Havendo uma divergência entre schema e prosa, corrigir o pacote antes de implementar; não escolher silenciosamente uma interpretação.

## 1. Fronteira do contrato

O schema define o **snapshot factual** independente da fonte. O envelope do servidor conserva `opportunityId`, `revisionId`, número de revisão/rowVersion, lifecycle administrativo, validação editorial, origem CENTRAL/privada histórica e autorização. Esses valores não são aceites do fornecedor nem do Excel. UUIDs v7 existentes e referências privadas permanecem estáveis.

O DTO de leitura acrescenta projeções temporais e saúde da fonte; relógio, idade da observação e próxima data calculada não entram no digest factual nem criam revisões. Alterações de fonte/condições criam revisões imutáveis. O contrato não concede acesso, não altera memberships e não promove dados privados.

Todo objeto é fechado: chaves desconhecidas são recusadas. Todos os blocos do schema são obrigatórios, mesmo quando os seus factos estão ausentes. Extensões de fonte não são permitidas nesta versão; um conceito novo exige evolução versionada, sem parsing específico no frontend.

## 2. Facto tipado e ausência

Os caminhos funcionais do plano passam a usar um envelope uniforme `Fact<T>`:

```json
{"state":"PRESENT","value":"120000","evidenceRefs":["budget"],"reason":null}
```

Nem todo montante usa um envelope individual: `financing.allocations` é `Fact<Allocation[]>`; cada linha tem um decimal obrigatório e um `Fact<Currency>` independente. Assim, pode existir montante conhecido e moeda desconhecida. `description.title` é sempre PRESENT e não vazio para admitir um novo registo no catálogo; um candidato inválido fica em staging com erro.

| Estado | `value` | Evidência e significado |
| --- | --- | --- |
| PRESENT | Tipo definido no schema, não null | Pelo menos uma referência; observado/representável, sem certificação de elegibilidade |
| NOT_FOUND | null | Consulta completa da origem/campo, com evidência da ausência |
| NOT_COLLECTED | null | Campo não consultado ou não coberto por este mapping; pode não ter evidência |
| NOT_APPLICABLE | null | Não aplicabilidade demonstrada, motivo e evidência obrigatórios |
| CONFLICT | null | Pelo menos duas evidências incompatíveis; candidatos conservados nas observações |
| UNSUPPORTED | null | Valor recebido sem interpretação segura; evidência original e motivo obrigatórios |

`reason` é null em PRESENT e código explícito nos restantes. Arrays PRESENT contêm pelo menos um elemento. Nunca usar `[]` para disfarçar falta de consulta, strings de apresentação como null ou zero para ausência. A validade do schema não substitui invariantes semânticas.

Um conflito de atualização não apaga o último facto aceite: a observação/candidato fica em revisão e o DTO assinala o conflito junto do valor anterior e respetiva revisão. Se ainda não houver valor aceite, o facto pode ser CONFLICT/null. Uma decisão editorial resolve o candidato com identidade, autoria, âmbito e evidência; não elimina as versões anteriores.

## 3. Dicionário e limites fechados

O JSON Schema Draft 2020-12 contém nomes, tipos, enums e limites por campo. `format` é validado com verificação de datas/URLs ativa, não apenas tratado como anotação. Invariantes da secção 10 são igualmente obrigatórias.

| Bloco | Contrato |
| --- | --- |
| `identity` | CALL/CASCADE_CALL e `references: Fact<Reference[]>`; referências PLAN_ID, SOURCE_CALL_ID, TOPIC_REFERENCE ou CALL_REFERENCE. Acordo fica no projeto associado |
| `sourceRecords[]` | Até 16 ligações com key, namespace, externalId textual, transporte, papel e URL pública ou null |
| `description` | Título até 300 caracteres, resumo até 4000, língua declarada até 35; cada campo é um Fact |
| `programmes`, `funds` | Fact de até 64 conceitos; listas independentes |
| `parties` | Fact de até 32 entidades; papéis PROGRAMME_FUNDER, MANAGING_AUTHORITY, DIRECT_AWARDER, PUBLISHER |
| `classification` | Natureza do aviso, instrumentos, objetivos específicos, temas; códigos nativos separados de mapeamento taxonómico |
| `publication` | Fact de PLANNED/PUBLISHED/UNKNOWN, independente do lifecycle editorial |
| `schedule` | Previsões, período de planeamento, abertura confirmada, até 64 deadlines com fase e modelo SINGLE/MULTIPLE_CUTOFF/CONTINUOUS/OTHER |
| `status` | Fact do estado publicado OPEN/UPCOMING/CLOSED/CANCELLED/UNKNOWN e código original |
| `financing` | Até 128 dotações; até 64 linhas de apoio, taxas e custos elegíveis em cada coleção |
| `eligibility` | Beneficiários, até 64 territórios com âmbito OPERATION/APPLICANT/UNSPECIFIED e condições até 4000 caracteres |
| `applicationModes` | Até 64 conceitos; modalidade não é confundida com instrumento ou natureza |
| `relatedProject` | Acrónimo até 128, nome até 300, acordo textual até 128 e URL opcional; cada facto tem estado próprio |
| `links` | URL oficial, até 64 links de submissão e até 64 documentos; disponibilidade é independente da existência do link |
| `quality` | Versão `opportunity-quality-v2.0` e até 128 issues por campo; sem score que prometa exatidão |
| `provenance` | Versão do mapping, até 64 observações e 512 localizações de evidência; factos referenciam até 32 evidências cada |

Limite do snapshot v2 serializado: **256 KiB UTF-8**, medido antes de aceitar e novamente na representação persistida. Limite da observação API: **2 MiB**; XLSX mantém **10 MiB/5000 linhas** do contrato existente. Cada linha é uma oportunidade/candidato independente; não colocar um workbook inteiro num snapshot. Listagem mantém resposta máxima **1 MiB** e projeção resumida; detalhe até **512 KiB** incluindo envelope. Limites não autorizam truncar factos para caber. Excesso → erro explícito, observação retida segundo política vigente, última revisão preservada. Recolha não é declarada completa quando houve recusas.

Texto resumido pode ser excerto explicitamente identificado; calendário, montantes, referências e listas factuais não podem sofrer truncatura silenciosa. URL até 2048 caracteres, HTTPS sem credenciais, controlos ou esquemas executáveis; não executar nem seguir automaticamente URLs recebidos. Excertos de evidência até 2048; valor integral continua recuperável na observação original.

## 4. Identidades e taxonomias

Namespaces v2: EU_FUNDING_TENDERS, PORTUGAL2030_PLAN, PORTUGAL2030_NOTICE, INTERREG_EUROPE, POCTEP, C4G_MANUAL. Transporte API/XLSX/HTML/MANUAL não integra a identidade funcional. O ID do plano não é assumido equivalente ao código do aviso publicado. Aliases legados, incluindo PORTUGAL_2030_XLSX, são conservados; nunca relabelar observações históricas.

EU tipo 8 usa `externalId=CASCADE:<callccm2Id>`; tipo 1 usa identificador do tópico. CORDIS/Horizon e Erasmus continuam seleções da mesma origem europeia, não novas identidades. `ccm2Id` interno e `metadata.url` não substituem `callccm2Id` para uma cascata.

Conceito: `{key, sourceId, code, label, scheme, schemeVersion, mapping}`. `mapping=VERIFIED` requer catálogo fixado e evidência da correspondência; `UNMAPPED` conserva o valor sem inventar códigos. `sourceId` e `code` podem ser null. Quando a origem só fornece rótulo, a key é `<scheme>:<primeiros16hex(SHA256(UTF-8(NFC(trim(label)))))>`; mesma key com label, código ou identidade de origem diferentes é colisão e erro, não fusão. Ordenar listas de rótulos normalizados pela ordem Unicode, sem locale dependente do host; deduplicar apenas conceitos equivalentes após NFC/trim, sem apagar códigos distintos com o mesmo rótulo.

A taxonomia europeia usada por 11145 está [fixada no pacote](evidence/eu-programme-taxonomy.json). PT2030 conserva os rótulos do anexo, com mapping UNMAPPED e versão da taxonomia null. Isso fecha a representação sem alegar conhecimento de códigos NUTS ou de entidades. AML, RAA, RAM e Extra-Regio NUTS II não são convertidos para códigos de outra versão por inferência.

## 5. Dinheiro e percentagens

Decisão: valores novos v2 usam precisão decimal exata com **até 24 dígitos inteiros e 8 decimais**, equivalentes a `NUMERIC(32,8)`. Projeções SQL financeiras são numéricas e derivadas da mesma revisão factual. JSON transmite string decimal canónica: ponto decimal, sem agrupadores, expoente, sinal ou zeros iniciais/finais desnecessários; `0` é válido. É uma representação decimal exata, não texto monetário formatado. Converter para `Number` indiscriminadamente é proibido. Valores negativos, NaN/Infinity ou precisão excessiva são recusados antes do cast; PostgreSQL não deve arredondar silenciosamente.

O snapshot/revisão é a autoridade factual. Projeções numéricas, índices e resumos são derivados e gravados/reconciliados com essa revisão; não se tornam uma segunda origem editável. DDL e backfill ficam em S1/S6, com migrações aditivas e gates próprios.

Montante e moeda têm evidências separadas. EUR só é preenchido quando publicado no campo ou comprovado por documentação aplicável àquela medida/versão. A moeda de apoio mensal não preenche a moeda da dotação total. Nos exemplos API11145 e XLSX isolado, moeda é NOT_FOUND/null. Uma observação complementar futura pode preencher EUR por nova revisão.

Cada dotação indica scope CALL_TOTAL/FUND_ALLOCATION/TOPIC_OR_SHARED, basis PLANNED/CONFIRMED, programas/fundos associados, período, sharedGroup, aggregation STANDALONE/SHARED/BREAKDOWN/UNKNOWN e qualificadores INITIAL/ESTIMATE. CONFIRMED indica dotação publicada da chamada, não dinheiro atribuído à organização.

`money.interpretation=PUBLISHED_AMOUNT` para montante positivo; `ZERO_UNEXPLAINED` para zero literal sem semântica comprovada; `EXPLICIT_ZERO` apenas com prova de zero económico. Um zero predefinido de API pode originar NOT_FOUND/UNSUPPORTED apenas por regra específica comprovada. Não inferir encerramento ou inexistência de apoio de zero. Relatórios distinguem número de zeros não esclarecidos.

Não somar por programa/fundo repetido, nem misturar moedas, dotação e limites individuais. Sem aditividade comprovada, `aggregation=UNKNOWN` e totais agregados não certificados. Mesmo total em vários programas conta como uma única linha. Apoio tem mínimo/máximo e unidade própria; pelo menos um limite presente, mínimo ≤ máximo. Taxas são pontos percentuais decimais entre 0 e 100; 85% é `"85"`, não `"0.85"`; taxa textual sem interpretação segura permanece nas condições, sem número inventado.

## 6. Calendário e projeção temporal

Temporal é união fechada:

- DATE: `{precision:"DATE",value:"YYYY-MM-DD"}`; sem hora fabricada.
- INSTANT: `{precision:"INSTANT",value:"...ss.SSSZ",originalTimezone:offsetOuZonaOuNull}`; UTC canónico, original recuperável na evidência.
- PERIOD: início/fim civis inclusivos, label e MONTH/QUARTER/FOUR_MONTH/YEAR/RANGE; limites apenas quando comprovados.

`planningPeriod` aceita label/esquema e limites null quando o documento não os define. Q1 do anexo é preservado; não é trimestre janeiro–março. O contexto público setembro2026–agosto2027 é uma observação diferente e não preenche automaticamente os limites de cada linha.

`plannedOpening/plannedClosing` nunca alimentam estado OPEN ou calendário confirmado. Publication PLANNED continua PLANNED até prova de publicação, mesmo depois das datas previstas. PUBLISHED pode coexistir com estado UPCOMING quando a chamada foi publicada antes da abertura.

DTO calculado, fora do snapshot: `asOf` UTC; `effectiveState` PLANNED/OPEN/UPCOMING/CLOSED/CANCELLED/UNKNOWN; `nextDeadline`, `nextDeadlineCandidates[]`, `finalDeadline`, `finalDeadlineCandidates[]`; `precision` EXACT/DATE_ONLY/PERIOD_ONLY/MIXED/UNKNOWN; `reasonCodes[]`. Retorna também o estado publicado sem o substituir pelo cálculo.

Regras temporais, por ordem:

1. Conflito não resolvido em publication/estado/calendário → UNKNOWN com motivo, conservando candidatos e última revisão aceite. CANCELLED/CLOSED oficiais comprovados têm prioridade sobre projeção automática quando não há conflito.
2. Publication PLANNED → PLANNED. Publication UNKNOWN/ausente → UNKNOWN. Não usar datas previstas como prova.
3. Para INSTANT, uma deadline é pendente apenas se `at > asOf`; igualdade já encerra esse prazo. Abertura futura confirmada → UPCOMING. Publication PUBLISHED, abertura confirmada já atingida e pelo menos um prazo inequívoco futuro → OPEN, mesmo sem estado publicado. Todos os prazos exatos vencidos → CLOSED, salvo calendário explicitamente contínuo ou atualização contraditória a rever. Estados publicados OPEN/UPCOMING/UNKNOWN permanecem factos observados e não impedem a evolução calculada pelo relógio; isso, por si só, não cria conflito factual.
4. Para DATE, comparar com o dia UTC de `asOf` apenas como convenção de cálculo, sem criar um instante factual. Data futura é pendente, passada é vencida com precisão DATE_ONLY. No próprio dia de prazo sem hora, estado efetivo UNKNOWN/DEADLINE_TIME_NOT_PUBLISHED, salvo CLOSED/CANCELLED oficiais; a interface mostra «Prazo hoje — hora não indicada». Não prometer que ainda se pode submeter.
5. PERIOD serve de intervalo, nunca de instante de submissão. Durante o período, certeza temporal é desconhecida; fora dele só se deriva a relação anterior/posterior ao intervalo, mantendo PERIOD_ONLY.
6. Com estado oficial OPEN e sem limite contraditório conhecido, pode projetar OPEN com motivo SOURCE_STATUS_ONLY se falta abertura ou calendário. Um prazo futuro, isoladamente, não prova abertura: sem abertura conhecida nem OPEN oficial → UNKNOWN. Abertura DATE no próprio dia também não prova que a hora já chegou; sem OPEN oficial → UNKNOWN. Abertura DATE passada pode satisfazer a regra de abertura já atingida, com precisão DATE_ONLY. Sem estado ou calendário suficiente → UNKNOWN. Frescura é exposta separadamente; não inventar uma cadência para certificar atualidade.

Para comparar precisão mista, DATE ocupa o intervalo lógico desse dia e PERIOD o seu intervalo civil; esses limites são internos ao cálculo e nunca persistidos como prazos. Intervalos não sobrepostos têm ordem inequívoca. Se candidatos sobrepostos de precisão diferente impedirem escolher próximo/último, devolver valor singular null e candidatos completos, ordenados por chave temporal estável, com AMBIGUOUS_DEADLINE_PRECISION. Mesmo instante repetido é deduplicado; preservar fases distintas se publicadas. `finalDeadline` deriva de todo o calendário confirmado e não depende de `asOf`; `nextDeadline` depende dele. Nenhum deadline conhecido é inventado a partir de datas de ingestão como `metadata.closingDate` de11145.

## 7. Proveniência e precedência

`sourceRecords` liga cada observação à identidade externa. `Observation` tem ID local, observedAt, sourceModifiedAt nullable, hash, documento/folha quando aplicável e coverage. `Evidence` identifica observação, localização JSON Pointer/célula/cabeçalho/documento, excerto opcional e regra de transformação versionada. IDs locais são únicos, estáveis dentro da revisão e têm referências válidas. O corpo/ficheiro original permanece em evidência protegida segundo os contratos de armazenamento/retencão vigentes; não criar prazo novo nem eliminar automaticamente.

Precedência por campo: correção editorial vigente mantém autoria/âmbito e conflito visível; revisão oficial posterior comparável atualiza o mesmo facto; aviso publicado confirma o calendário sem apagar a previsão; plano nunca substitui calendário confirmado. Entre autoridades equivalentes divergentes sem sequência de versão comprovada, CONFLICT; data de recolha mais recente não prova edição mais recente.

Plano→aviso publicado: ligação automática apenas com referência explícita/identificador estável comprovado entre ambos. Caso contrário, candidato a associação para decisão C4G. Correspondência por título, programa ou montante não é identidade. Ausência em amostra/ciclo não elimina nem arquiva automaticamente. Mesma identidade + factos semanticamente iguais → sem revisão; mudança material → nova revisão e evento já previsto no plano de calibração.

Digest factual inclui valores, natureza/âmbito, disponibilidade, mapping e referências de origem semanticamente relevantes. Exclui relógio de projeção, execução, ID transitório de observação e timestamps/checksums alterados apenas por nova recolha sem mudança semântica. A observação operacional nova fica registada; evidência original do facto inalterado é conservada. Mudança apenas de ordem em conjuntos não cria revisão, mas ordem de fases publicada pode ser semântica.

## 8. Compatibilidade e consumidores

Leitura v1 é mantida sem reescrever o original. `sourceEnrichment.PUBLISHED` projeta PRESENT; NOT_FOUND/CONFLICT/UNSUPPORTED e truncated continuam significativos. Ausência de observação projeta NOT_COLLECTED. `truncated=true` exige incompletude explícita e não pode ser projetado como conjunto v2 completo. Decimais v1 fora do limite v2 continuam legíveis no formato histórico; não arredondar, coagir ou perder informação para migrar.

Aliases `programmeName`, `funderName`, `openingDate`, `closingDate` e finanças legadas são projeções de compatibilidade, nunca segunda origem. Em multiplicidade/ausência não se escolhe o primeiro nem se usa programa como financiador. Consumidores que exijam campos singulares têm de ser adaptados antes da ativação; o schema antigo não deve ser falsamente satisfeito com valores inventados.

Lista/detalhe/exportação/dashboard usam a mesma semântica e revisão. Lista pode resumir vários montantes com indicação «Vários valores», sem somar ou ocultar conflito. Filtragem temporal usa projeção comum; previstos não contam como abertos. Campos de elegibilidade importados não confirmam critérios editoriais nem alteram o matching determinístico. Snapshots de candidaturas e interesses privados preservam os seus vínculos/revisões.

## 9. Resolução das pendências S0

| Pendência anterior | Decisão fechada |
| --- | --- |
| Nomes, tipos e limites | JSON Schema fechado + invariantes deste documento |
| Dinheiro | NUMERIC(32,8) para novos valores/projeções; JSON decimal exato string; sem cast/arredondamento silencioso |
| Moeda não publicada | NOT_FOUND/null; enriquecimento posterior exige evidência aplicável |
| Zero do anexo | Preservar `0`, ZERO_UNEXPLAINED e issue; não atribuir significado económico |
| Taxonomias PT/NUTS | Rótulos/códigos de origem preservados, mapping UNMAPPED/versão null; não bloquear por ausência de tradução taxonómica |
| Previsão e publicação | Campos separados e regras temporais explícitas |
| Precedência e ligação | Por facto/versão/autoridade; ligação incerta exige revisão, sem fusão por título |
| Retenção | Preservação segundo política vigente; nenhuma nova duração ou limpeza automática nesta versão |

Estas incertezas factuais estão representadas no contrato; não são decisões de produto por resolver que impeçam S1. Recolha adicional pode resolvê-las sem alterar o schema. Ativação, infraestrutura real e produção continuam sujeitas às fases/gates próprios.

## 10. Invariantes obrigatórias para S1

| Código | Regra |
| --- | --- |
| V2-01 | Schema fechado, formatos reais, limites de bytes e caracteres; título PRESENT |
| V2-02 | Todas as evidenceRefs/observationIds/sourceRecordKeys existem e são únicas; nenhuma evidência de outra identidade usada sem relação explícita |
| V2-03 | ProgrammeRefs/fundRefs resolvem conceitos da mesma oportunidade; keys sem colisões |
| V2-04 | Decimal canónico exato, limites e zero coerentes; mínimo ≤ máximo; taxas 0–100; sem soma automática |
| V2-05 | Datas/períodos válidos; início ≤ fim quando comparáveis; PLANNED não preenche calendário confirmado sem evidência adicional |
| V2-06 | Próximo/último prazo e estado seguem secção6, incluindo igualdade, datas civis e ambiguidades |
| V2-07 | Source namespace/ID, tipo e URL canónico coerentes; papéis e referência do projeto distintos |
| V2-08 | Mapping cobre todas as colunas/dados obrigatórios; header novo exige revisão; digest inclui novos campos |
| V2-09 | Erro/falta de consulta não apaga facto; conflito/correção/dedup/replay preservam histórico |
| V2-10 | DTOs conciliam com mesma revisão; autoridade/isolamento e limites mantidos |

## 11. Fontes técnicas

O [JSON Schema Draft2020-12](https://json-schema.org/draft/2020-12) define a linguagem do schema; o validador deve ativar os formatos. A [documentação PostgreSQL18 sobre numeric](https://www.postgresql.org/docs/18/datatype-numeric.html) fundamenta representação exata e o cuidado com arredondamento por escala. Nenhuma destas referências autoriza alterações ao ambiente.

O pacote S0 é validado offline contra o schema e os valores das evidências. Isso valida os artefactos normativos; os testes de implementação, SQL e HTTP são trabalho S1–S6.
