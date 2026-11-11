# Exemplos normativos e critérios S0

Pacote `opportunity-v2.0`, fechado em 30/10/2026. Os exemplos definem os resultados esperados dos futuros adaptadores; não são exportações da base da APP nem prova de que o runtime já os produz. Usar em conjunto com o [contrato](contract.md), [schema](opportunity-v2.schema.json) e [mapeamentos](mappings.md).

## Corpus fixado

| Exemplo completo | Origem e caso normativo |
| --- | --- |
| [EU 11145](examples/eu-11145.json) | Cascata, título próprio, referência do tópico, dotação 120000, apoio mensal separado, projeto SUSA/acordo 101190010 e sete cut-offs |
| [PT2030 8485](examples/pt2030-8485.json) | Linha física 3; previsão não se torna aberta por passagem do tempo; beneficiários/modalidades plurais |
| [PT2030 8514](examples/pt2030-8514.json) | Linha 111; seis programas, uma dotação 40000000, sem multiplicação ou repartição |
| [PT2030 8583](examples/pt2030-8583.json) | Linha 17; decimal exato 18181527.09, sem arredondar para inteiro ou converter por formatação local |
| [PT2030 8614](examples/pt2030-8614.json) | Linha 18; três programas, uma dotação 51000000 |
| [PT2030 8664](examples/pt2030-8664.json) | Linha 23; zero literal conservado com ZERO_UNEXPLAINED; moeda desconhecida não é zero |

[Projeção das 177 linhas](pt2030-expected-177.json): 13 colunas contabilizadas por registo, com ID, linha física e digest de todas as colunas. É uma expectativa de mapping, não um lote pronto a importar. A [extração lexical](evidence/pt2030-plan-177.json) conserva as 2301 células, índices de shared strings, valores resolvidos e datas derivadas. Existem nove dotações fracionárias; a maior precisão observada é de duas casas, sem reduzir o contrato a essa precisão.

O XLSX original, 65667 bytes, tem SHA-256 `f5d81e3a2fcf31fac5b4545a4e7625c9f0c22333f28cc301ad4b61a7845f5869`. Não é incluído nem alterado. A chamada 11145 tem [resposta oficial preservada](evidence/eu-11145.json) e [metadados da observação](evidence/eu-11145.metadata.json), sem credenciais. O [manifesto](manifest.json) identifica cada artefacto por hash.

## Resultados temporais de referência

Os cálculos seguintes são critérios de aceitação para S1/S2, fora do snapshot factual. Não foram executados contra a APP nesta entrega.

| Entrada | Resultado obrigatório |
| --- | --- |
| EU11145, `asOf=2026-10-30T12:00:00.000Z` | OPEN; próximo `2027-01-03T04:59:00.000Z`; último `2028-09-02T04:59:00.000Z`; precisão EXACT |
| EU11145, `asOf=2027-01-03T04:59:00.000Z` | Esse cut-off já venceu; próximo `2027-09-02T04:59:00.000Z`; último inalterado; OPEN |
| EU11145, `asOf=2028-09-02T04:59:00.000Z` | CLOSED por calendário observado; próximo null; último preservado; estado publicado OPEN continua visível como observação histórica |
| PT8485, em 30/10/2026 ou após 31/12/2027 sem nova evidência | PLANNED; nenhum prazo confirmado/próximo/último fabricado |
| Prazo DATE no próprio dia, sem hora e sem CLOSED/CANCELLED oficial | UNKNOWN, `DEADLINE_TIME_NOT_PUBLISHED`; conservar DATE |
| Prazo DATE e INSTANT com intervalos sobrepostos e escolha ambígua | Singular null; candidatos completos; `AMBIGUOUS_DEADLINE_PRECISION` |

O calendário é o conjunto de sete valores de `metadata.deadlineDate`. `metadata.closingDate=2026-05-19T00:00:00Z` não é o prazo da chamada. O estado calculado não certifica que o portal não tenha sido alterado desde a observação.

## Exatidão financeira e limites da evidência

O valor `metadata.budget[0]="120000"` corresponde exatamente a `financing.allocations.value[0].money.amount="120000"`, scope CALL_TOTAL. O apoio máximo de `1500` EUR por pessoa/mês vem da descrição e tem coleção/unidade próprias. Não é somado à dotação, não a substitui e a sua moeda não é propagada ao total sem prova aplicável.

A resposta da API não publica uma moeda no campo do total. O exemplo mantém `currency.state=NOT_FOUND`, `value=null`. Por isso, S0 confirma o montante numérico de 120000; não certifica por esta observação isolada o par montante/moeda «120 000,00 €» apresentado na interface do portal, nem a persistência atual da APP. S2/S6 devem completar a evidência de moeda e verificar o percurso fonte → parser → revisão → projeção numérica → HTTP → UI/exportação.

No XLSX, `Dotação Fundo` e o formato `#,##0.00` não identificam moeda. Todos os 177 montantes permanecem exatos, com moeda não encontrada nesta origem. Os dois avisos multiprograma não são seis/três dotações. Mesmo numa linha com um programa, aditividade entre linhas não foi comprovada e `aggregation=UNKNOWN`.

## Portas de saída e validação

[validation.json](validation.json) regista a verificação offline do schema, dos seis snapshots, das referências internas, dos montantes/calendários de 11145 e da reconciliação das 177 linhas com o ficheiro original. Casos negativos provam rejeição estrutural de formatos inválidos. Isso valida o pacote S0; não testa o parser, o armazenamento, o endpoint, as projeções temporais ou a segurança de ingestão da APP.

Para S1, converter também em regressões as invariantes semânticas do contrato: mínimos/máximos e taxas, limites de bytes, referências inválidas, colisões de identidade, atualização sem perda, digest independente do relógio/ordem, calendário de precisão mista e compatibilidade v1 com truncatura e decimais históricos. S2/S3 acrescentam testes dos adaptadores contra estas evidências. Uma fonte posteriormente alterada gera nova observação/versão de exemplo; não reescrever a evidência congelada para fazer um teste passar.

S0 está concluído quando o pacote é coerente, os valores observados têm destino ou ausência explícita e a validação offline passa. A feature global permanece Ready para S1; S1–S6 não estão implementados por esta entrega.
