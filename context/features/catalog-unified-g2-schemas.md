# GCNI-CAT-01 / G2 — schemas e testes isolados

Estado: **Complete para o incremento autorizado de schemas e casos de teste**. A melhoria GCNI-CAT-01 continua In Progress; domínio/projeções, persistência e serviço não estão implementados por este incremento.
Data: 01/11/2026. G1 aprovado explicitamente pelo utilizador neste pedido.

## Entrega

Pacote em `experiments/catalog-read-g2`, separado da APP e das suites automáticas existentes. JSON Schema draft 2020-12 com 48 definições; 18 raízes de exemplos; 105 casos positivos/negativos e verificações adicionais. Queries são validadas como valores HTTP string, sem coerção. Todos os DTOs G1 e todas as secções têm exemplos. Foi preparada matriz dos 20 critérios de aceitação com cenários Given/When/Then para integração futura.

## Validação executada

- Suite no pacote instalado no GCNI: **133 PASS, 0 FAIL, 0 SKIP**.
- Compilação estrita das 48 definições em Ajv 8.20.0 / ajv-formats 3.0.1; Node 24.13.1.
- `node --check` dos três ficheiros CJS passou.
- Verificada igualdade entre pacote preparado e instalado; entrada da aplicação e ficheiros de dependências não foram alterados.
- Ambiente do processo reduzido, sem variáveis da aplicação/NODE_OPTIONS; chamadas de rede do harness bloqueadas; Node sem permissão de escrita ou subprocessos. Testes verificam os bloqueios sem abrir conexões nem criar ficheiros.

Não foram executadas suites completas backend/frontend ou build: não se alterou código dessas aplicações. Não foram abertas bases, aplicadas migrações, consultadas APIs de fontes ou executados jobs. O estado vivo das fontes não foi consultado nem alterado.

## Autorrevisão

Revisão pelo próprio autor, sem alegação de revisão independente. Ordem: correspondência G1, tipos e limites, casos negativos, privacidade, integridade, erros, âmbito e qualidade das provas.

Corrigida uma falha inicial de compilação estrita: foram acrescentados tipos explícitos aos ramos condicionais/composição do schema, mantendo `strict:true`, sem desligar verificações. Corrigida a execução Windows do permission model para resolver dependências; a leitura é permitida e o âmbito real dessa proteção está descrito, sem a apresentar como isolamento total. O launcher remove variáveis de aplicação e bloqueia escrita/filhos; não trata código hostil como seguro.

A revisão confirmou que moedas e datas não são números de ponto flutuante, ausências não viram zero, conflito não seleciona vencedor, documento reference_only não é apresentado como arquivo preservado, scopes de financiamento são distintos, e o schema público rejeita campos de organização/revisor. Comparação de fixtures não é prova de autorização nem de assinatura de snapshot.

Limitações explícitas: verificação de moedas/fontes oficiais, normalização por conector, integridade referencial completa, revogação, isolamento SQL, paginação concorrente, imutabilidade, idempotência, desempenho e UI exigem os ensaios de integração. Os 20 cenários permanecem `not_executed`; nenhum foi contabilizado como teste passado. Não declarar AC01–AC20 integralmente satisfeitos.

Veredicto: **ready to close** para este incremento de schemas e testes; nenhuma pendência corretiva identificada no âmbito executado. Não equivale a aprovação para produção.

## Clarificações de contrato

Expiração: now >= expiresAt é inválido; validade estritamente anterior ao limite. Meta.asOf fixa emissão lógica e expiresAt=asOf+900s. TemporalDate corresponde ao objeto Date. Filtros de áreas continuam indisponíveis até contrato próprio. Estas clarificações não implementam tokens ou regras temáticas.

## Referências

- [Pacote e execução](../../experiments/catalog-read-g2/README.md)
- [Schema](../../experiments/catalog-read-g2/schemas/catalog-read.schema.json)
- [Matriz dos critérios](../../experiments/catalog-read-g2/acceptance-matrix.md)
- [Cenários de integração pendentes](../../experiments/catalog-read-g2/integration-scenarios.json)
- [Especificação da melhoria](catalog-unified-experience.md)

Próximo passo: adaptar o modelo e as projeções do GCNI ao contrato aprovado e preparar o ensaio de persistência em base isolada, antes de implementar o serviço de leitura, mantendo fontes suspensas.
