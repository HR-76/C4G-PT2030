# S5 — revisão do contrato de leitura e calendário SQL

31/10/2026. Revisão local de código, contratos, SQL gerado e testes; nenhuma ligação a PostgreSQL, aplicação de SQL, migração ou ativação. Estas notas complementam o relatório S5 e não substituem o gate S6.

## Fronteiras verificadas

- A leitura pública continua a partir de `opportunity.current_revision_id` e `revision.snapshot`; nenhuma tabela de candidatos S2/S3/S4 é consultada ou promovida.
- Lista e detalhe expõem a revisão e usam a projeção aditiva `opportunity-read-v2.0`. O snapshot v1 não é transformado num snapshot factual v2 e conserva valores históricos, truncatura e estados de ausência/conflito.
- Factos financeiros mantêm strings decimais, moeda desconhecida e pluralidade; não há soma implícita de dotações por programa ou fundo.
- A paginação reduz o número de elementos para respeitar 1 MiB, retomando no último UUID emitido. O detalhe é limitado a 512 KiB; nenhum facto é recortado silenciosamente.
- As queries mantêm parâmetros de pesquisa e autoridade C4G/tenant existentes. Os filtros são aplicados antes do limite/paginação, incluindo programas plurais e PLANNED.

## Encontrado e corrigido

| Achado | Reprodução e resolução |
| --- | --- |
| Filtro/faceta v1 ignorava estado observado de programa | `sourceEnrichment.programme` CONFLICT/NOT_FOUND/UNSUPPORTED ainda permitia fallback para `programme_name`, enquanto a projeção mostrava o estado observado. O fallback SQL fica agora reservado a ausência de enriquecimento. Regressão incluída. |
| Leitura comum recusava instantes históricos válidos em v1 | `2027-01-01T00:00:00-0000` e `2027-01-01T24:00:00Z` passavam o leitor S1 mas falhavam no novo normalizador v2. O cálculo temporal v1 conserva a sua semântica Date e os valores originais permanecem na projeção/snapshot, com `LEGACY_TEMPORAL_SEMANTICS`. |
| Relógio do dashboard divergente entre fontes | As leituras central/privada usavam CURRENT_TIMESTAMP independentemente. A porta SQL aceita agora um `asOf` UTC canónico partilhado e ligado ao mesmo dia; o chamador S5 fornece o instante único. A assinatura histórica sem asOf mantém comportamento anterior. |
| Dashboard com oportunidade aberta sem prazo | S1 permite OPEN apoiado apenas no estado da fonte. Nesse caso `closing_date` pode ser null; o consumidor preserva o valor ausente e ordena datas desconhecidas no fim sem executar `localeCompare` sobre null. Código e regressão revalidados. |
| Matching interpretava condições v2 como lista | `FactConditions` é texto. Uma oportunidade v2 válida com condições PRESENT lançava `TypeError` na chamada a `join`. O consumidor passou a manter string/null; a regressão cobre ambas as disponibilidades e a explicação de que matching não determina elegibilidade. |

Os dois primeiros achados foram revalidados no código corrigido. O foco cruzado dos módulos `readModel`, repositório e SQL passou com 16 testes no estado revisto. Os testes gerais finais e a validação visual constam do relatório principal.

## Calendário SQL preparado

`opportunities/v2/temporalSql.js` deriva apenas campos v2 PRESENT, separa calendário confirmado e previsto, mantém PLANNED distinto de OPEN e conserva precedência de conflito/estado final. Os limites UTC de DATE/PERIOD são auxiliares de comparação; nunca são devolvidos como prazos inventados.

Deduplicação ignora apenas a representação original do fuso para o mesmo instante, mantendo fases distintas. Próximo e último prazo exigem extremo único; sobreposição de precisões e fases impede selecionar arbitrariamente o primeiro. A coluna textual de prazo é null para PERIOD; a coluna JSON preserva o intervalo. A referência SQL é truncada a milissegundos para concordar com Date/ISO do DTO.

O wrapper mantém as regras legadas de datas/correções e aplica a revisão da fonte como UNKNOWN. Dashboard usa título/fonte da revisão v2, contabiliza PLANNED separadamente, não soma orçamentos e não recupera datas v1 como fallback de planos v2. O helper é reutilizável para o último prazo confirmado em snapshots privados imutáveis.

Validação deste ramo: cinco testes novos de contrato/estrutura SQL, regressões v1/v2 existentes e focos HTTP/F12; 49 PASS na execução específica. A sintaxe JavaScript foi verificada. Não foi executado SQL num servidor: a análise estática e os testes do cálculo JavaScript não provam execução, plano de consulta ou equivalência operacional PostgreSQL.

A revisão adicional confirmou que S0/S1 aceitam o ano astronómico ISO `0000`. Casts PostgreSQL diretos não representam esse ano com a mesma notação. `civilDateSql` e `instantSql` constroem as comparações com `make_date(-1, mês, dia)` e hora UTC, conservando o texto ISO original nos factos. A correspondência negativa/BC é documentada nas [funções oficiais PostgreSQL](https://www.postgresql.org/docs/current/functions-datetime.html) e nos [tipos de data/hora](https://www.postgresql.org/docs/current/datatype-datetime.html). Acrescentou-se a regressão de preservação do contrato, elevando este foco a seis testes novos e 50 PASS; a execução real desta fronteira também pertence ao gate S6.

## Gate ainda necessário

Antes de S6 ativar escritores v2, executar em âmbito isolado a matriz PostgreSQL→DTO para os seis exemplos S0, cortes exatos, DATE no próprio dia, PERIOD em curso, intervalos sobrepostos, mesmas datas com fases diferentes, estado final, conflitos, correções v1 e fronteira de meia-noite. Medir também o custo dos joins laterais nos percursos de lista, dashboard e snapshots de candidaturas. Preservar os leitores históricos e não usar candidatos como substituto dessa validação.

## Revisão cruzada dos consumidores

Foram revistos `applications/opportunitySnapshot`, criação/leitura de candidaturas, browse/report/alerts/partners, interesses, matching e composição do dashboard. A candidatura v2 conserva a revisão original sem reescrever snapshots históricos; identidade e revisão atuais são verificadas na criação. O limite JSONB de 32768 bytes da migração tenant024 é verificado antes de escrever. Título e último prazo confirmado são derivados do snapshot congelado, com prazo escalar ausente quando a precisão é PERIOD ou o extremo é ambíguo. Planos não se tornam prazos confirmados. A conversão de dia dos alertas usa Lisboa para INSTANT e conserva DATE; o ano ISO 0000 usa a mesma construção civil SQL.

Os percursos privados mantêm os filtros `organization_id`, leituras autorizadas e revalidação de autoridade existentes. Matching recebe projeções compactas, conserva resumo v1, não copia o readModel completo para cada resultado e mantém a distinção de PLANNED/UNKNOWN sem declarar elegibilidade. O dashboard partilha um único `asOf` entre fontes e suporta prazos nulos. Foco independente depois da correção das condições: **49 PASS**, incluindo consumidores v2, matching, alertas, report, dashboard HTTP/agendamento e estrutura SQL temporal.

A prova adicional de limite encontrou um detalhe de interesse acima de 512 KiB: snapshot v2 válido com 56 taxas cujas condições têm 4000 caracteres e 64 cut-offs com fases distintas, JSONB de 254481 bytes. A resposta mínima `{snapshot, readModel}` tinha 535729 bytes. A correção foi revalidada: `withCapabilities` verifica o envelope completo; criação e mutação fazem preflight antes dos writes; `finish` verifica antes do recibo; detalhe, reexecução idempotente e registo já existente também passam pelo limite. O erro HTTP é explícito, `LIMIT_EXCEEDED`/409, sem conteúdo privado. A regressão principal conserva integralmente o snapshot e prova ausência de writes; outra testa o caso em que só acrescentar capacidades ultrapassa a fronteira.

Revisão encerrada sem bloqueantes de código conhecidos nos percursos examinados. O foco cruzado final, incluindo interesses e as correções acima, passou com **70/70 testes**. Estes são testes locais de contrato/comportamento e SQL estrutural; não constituem execução PostgreSQL nem autorização para S6. As notas e ficheiros deste ramo ficam congelados para a validação global conduzida no relatório principal.
