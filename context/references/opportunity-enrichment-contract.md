# Contrato técnico P3 v1

Complementa `features/opportunity-enrichment.md`. Todos os campos são obrigatórios dentro do objeto; o objeto é opcional nos snapshots anteriores.

```js
sourceEnrichment = {
  schemaVersion: 1,
  mappingVersion: 'eu-framework-2026-10-29',
  observedAt: '2026-10-29T00:00:00.000Z',
  fields: {
    programme: field, instrument: field, budget: field, support: field,
    rate: field, territories: field, beneficiaries: field, consortium: field,
    conditions: field, documents: field, submission: field
  }
}
field = { status: 'PUBLISHED' /* ou NOT_FOUND, CONFLICT, UNSUPPORTED */,
  items: [{ value: typedValue, evidence: { url, locator, excerpt, observedAt } }],
  truncated: false }
```

Limites: objeto 12288 bytes na representação JSONB estimada; campo máximo 8 itens, documents 8, conditions 1. URL HTTPS pública sem credenciais nem parâmetros sensíveis, até 2048 caracteres; locator 240; excerpt 500. Dados são texto inerte. Evidence observedAt é ISO UTC com milissegundos; a mesma regra aplica-se ao topo. Truncatura ou formato não suportado têm indicação explícita. NOT_FOUND exige items vazio; PUBLISHED exige itens; CONFLICT/UNSUPPORTED podem conservar evidência parcial.

Tipos por campo (chaves fechadas):

- programme: `{ id, code, label }`; id até 100, code string até 64 ou null, label até 200. UNKNOWN mapping usa UNSUPPORTED e code null. Não escolher programa quando há vários diferentes.
- instrument, rate, territories, beneficiaries, consortium, conditions: `{ text }`, até 1800 caracteres (conditions 3000). Texto literal de secção publicada, não conclusão ou extração numérica por heurística. Podem ser referências documentais.
- budget: `{ amount, currency, period, scope, group, action }`; amount decimal exato positivo string; currency ISO de três letras ou null; period string até 80 ou null; scope CALL ou TOPIC_OR_SHARED; group até 100 ou null; action até 300 ou null. Sem soma. Scope de tipo8=CALL; tipo1=TOPIC_OR_SHARED.
- support: `{ minimum, maximum, currency, unit, action }`; mínimo/máximo positivos string ou null, pelo menos um presente; ordem válida se ambos; currency ISO ou null; unit PER_PROJECT; action até 300 ou null. Zeros predefinidos são desconhecidos, não limites comprovados.
- documents: `{ title, url }`; título até 200 e URL HTTPS seguro. Somente ligações publicadas na fonte, sem fetch arbitrário. Não prometer disponibilidade HTTP do destino.
- submission: `{ title, url, availability }`; título até 200, URL seguro, availability UNKNOWN. Estado temporal e instruções publicadas permanecem separados da existência da ligação.

API interna prevista:

- `opportunities/sourceEnrichment.js`: validateSourceEnrichment(value); semanticEnrichment(value) remove apenas observedAt do topo/evidence para comparação; retainEnrichmentObservation(previous,incoming) conserva factos/evidência anteriores semanticamente iguais; fitEnrichment(value,maxBytes) limita de forma determinística e sinaliza truncatura sem alterar valores monetários; jsonbBytes(value) mede representação JSON compatível com espaços do JSONB.
- `fundingTenders/enrichment.js`: extractEnrichment(rawItems,{externalIdentifier,observedAt}) devolve objeto validável; concilia campo a campo variantes completas. Sem acesso à BD/rede. Extrator não importa `source.js` para evitar ciclos. Identity/URLs pelos módulos identity existentes.

Retenção: observação operacional continua na tabela existente; repetição só muda observedAt operacional. O enriquecimento da revisão conserva a observação original de cada campo inalterado. Alteração material cria revisão nova, sem alterar snapshots das candidaturas.

Ativação: opção `FUNDING_TENDERS_ENRICHMENT=verified-v1`, omitida por omissão; exige cobertura completa, refresh e resolução suportados. createSource/createFundingRepository recebem enrichmentEnabled=false por omissão. Quando ativo, os novos identificadores descobertos também passam pelo percurso KNOWN para obter detalhe completo antes da criação.
