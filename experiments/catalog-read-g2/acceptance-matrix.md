# Matriz de aceitação G2

Os 20 critérios da melhoria completa não estão concluídos. Esta matriz separa validação local do contrato e cenários de integração ainda não executados.

| Critério | Cobertura local desta etapa | Prova pendente |
| --- | --- | --- |
| AC01 | Forma dos DTOs das fontes | Mapping de fontes (adapter) |
| AC02 | Tipos e combinações sintáticas dos filtros | Filtros antes da paginação (reader) |
| AC03 | Rejeição de query inválida e repetida | Filtro inválido e contexto (http-ui) |
| AC04 | Coerência de fixtures lista/ficha; sem concorrência real | Revisão concorrente (postgres-http) |
| AC05 | TTL declarado e formas dos cursores; sem criptografia | Expiração e token alterado (http-clock) |
| AC06 | Calendário, hora/fuso e precisão | Precisão e rondas (domain) |
| AC07 | Condição obrigatória e representação do conflito | Prorrogação e conflito (postgres-domain) |
| AC08 | Decimais exatos, moeda nullable e âmbito call/aviso | Verba partilhada (domain-reader) |
| AC09 | Hash de arquivo obrigatório e âmbito de substituição | Versões documentais (document-store) |
| AC10 | DTO de relação provável/confirmada | Plano e aviso (domain) |
| AC11 | Fact states distintos e ausência nullable | Qualidade (reader-ui) |
| AC12 | Não coberto por execução local | Replay e falha de ingestão (postgres-ingestion) |
| AC13 | Proibição de campos privados no DTO; não é teste de autorização | Revogação e isolamento (oidc-postgres-http) |
| AC14 | Não coberto por execução local | Interesses/candidaturas (tenant-ui) |
| AC15 | Filtro sintático de URLs; sem render/exportação real | Conteúdo e exportação (ui-security) |
| AC16 | Não coberto por execução local | Acessibilidade e estados (browser) |
| AC17 | Descrição/excerto e fonte em caso de truncagem | Descrição oficial (adapter) |
| AC18 | Filtro indisponível rejeitado; mapping continua pendente | Áreas pendentes (thematic-contract-pending) |
| AC19 | Limite de bytes UTF-8, sem benchmark | Volume e orçamento (performance) |
| AC20 | Não coberto por execução local | Migração e admissão (postgres-gate) |

## Clarificações registadas

- Boundary de expiração proposto para os futuros testes: válido se now < expiresAt; expirado se now >= expiresAt. G1 dizia «após» sem explicitar igualdade; G2 fixa o limite conservador. Não há token real nesta etapa.
- Meta asOf é o instante da emissão lógica do snapshot, enquanto generationId identifica a projeção publicada; expiresAt=asOf+900s. A geração pode ter sido publicada antes.
- Convenção de queries: strings no transporte; sem coerção automática, nenhuma autoridade fornecida pelo cliente.
- Os resultados G2 não certificam todo o contrato nem tornam os cenários acima executados.

Próximo passo: implementar o modelo/projeção compatível e preparar o gate de persistência isolado antes de ligar a API.
