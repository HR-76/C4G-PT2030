# S5 — contrato aditivo de leitura

31/10/2026. Implementação local em Review. Este documento descreve a API de leitura; não altera o contrato factual S0 nem autoriza publicação de revisões v2. O [relatório S5](../../reviews/opportunity-data-standardization/s5.md) identifica provas e gates pendentes.

## Origem e compatibilidade

As rotas existentes `/central-opportunities` e `/admin/central-opportunities`, incluindo detalhe por ID, acrescentam `readModel` derivado de `opportunity.current_revision_id` e `revision.snapshot`. As tabelas de candidatos S2–S4 não são fontes alternativas de leitura. O leitor histórico de revisão conserva o snapshot original e valida a sua versão.

O DTO tem `version: "opportunity-read-v2.0"` e `sourceVersion: 1 | 2`. Um DTO comum de origem v1 não é um snapshot factual v2. O detalhe preserva `snapshot`, e o envelope conserva identidade, revisão, lifecycle, validação e metadados autorizados pelo servidor. A lista v2 mantém aliases simples apenas quando não perdem significado: programas plurais não são reduzidos ao primeiro nem dotações convertidas num intervalo legado.

| Propriedade | Semântica |
| --- | --- |
| `revisionId` | Revisão aceite ou histórica que originou os factos; não é a revisão de um candidato |
| `asOf` | Instante UTC canónico usado no cálculo temporal; comum à página e aos filtros SQL dessa leitura |
| `identity` | Tipo e referências publicadas/editoriais; ID de plano distinto de referência definitiva de aviso |
| `sourceRecords` | Registos e namespaces do snapshot v2; vazio em v1, sem fabricar proveniência |
| `projection` | Projeção compatível S1: descrição, programas, fundos, entidades, classificação, publicação, estado, calendário, financiamento, elegibilidade, modalidades, projeto e ligações |
| `temporal` | Estado efetivo, estado publicado, próximo/último prazo e candidatos ambíguos, precisão e motivos; previsão não é prazo confirmado |
| `quality` | Versão de regra, contagens de estados, cobertura observada, motivos e necessidade de revisão; `verification: "NOT_CERTIFIED"` |
| `warnings` | Limitações da projeção compatível, incluindo enriquecimento histórico parcial |
| `freshness` | Observação, idade em segundos e revisão da fonte; observação futura é sinalizada |

Os factos de leitura conservam `state`, `value`, `candidates`, `complete`, `representation`, `sourcePaths` e `reason`, conforme S1. V1 conserva os seus valores e gramática histórica; apenas o cálculo temporal normaliza instantes históricos válidos para UTC. `LEGACY_TEMPORAL_SEMANTICS` identifica essa distinção. `NOT_FOUND`, `NOT_COLLECTED`, `NOT_APPLICABLE`, `CONFLICT` e `UNSUPPORTED` não são equivalentes.

## Dinheiro, calendário e qualidade

Dinheiro continua a ser string decimal canónica exata, conforme S0; não é convertido para `Number`. Moeda pertence ao facto monetário. A dotação 11145 é `"120000"` com moeda `NOT_FOUND/null`; o apoio mensal `"1500"`/EUR é outro facto. Financiamento multiprograma não é somado ou repetido por associação a programas/fundos. Zero continua explícito, incluindo interpretação `ZERO_UNEXPLAINED`.

V2 preserva DATE, INSTANT e PERIOD. A data civil não recebe hora inventada. Próximo e último prazo podem divergir; ambiguidades mantêm candidatos sem escolher arbitrariamente o primeiro. `PLANNED` é distinto de `UPCOMING` e `OPEN`; plano não se torna aberto com a passagem do tempo. A revisão da fonte pode tornar o estado efetivo `UNKNOWN`, preservando os factos anteriores.

As contagens de qualidade incluem factos aninhados, como moeda numa dotação PRESENT, e não são uma percentagem de exatidão. A revisão documental pendente da 10.ª POCTEP continua visível. Nenhum valor de qualidade confirma elegibilidade ou concordância universal com o portal atual.

## Filtros, paginação e exportação

Pesquisa, referências, programas plurais, estado e datas confirmadas são filtrados antes do limite SQL. As facetas respeitam ausência/conflito observado em v1, sem recuperar um alias contraditório. Filtros de fecho não usam previsões PT2030 como fechos oficiais.

A lista devolve até 25 elementos, reduzindo a página para respeitar 1 MiB. O cursor aponta para o último elemento efetivamente emitido; os seguintes permanecem acessíveis. O detalhe fica limitado a 512 KiB. Reserva-se margem de 4096 bytes para o envelope HTTP. Elemento/envelope excessivo produz erro explícito; não se corta um facto. O catálogo sanitiza `OPPORTUNITY_READ_LIMIT_EXCEEDED`/versão incompatível sem expor payloads internos.

O frontend consome o DTO sem parsing de fontes. A ação **Exportar página** produz CSV dos elementos carregados, preservando factos plurais e estados em células JSON, decimais e calendário. Não promete exportar todo o catálogo. As células escapam aspas e prefixos de fórmulas; o cliente HTTP existente continua a transmitir o envelope sem selecionar ou transformar os campos.

## Consumidores e persistência histórica

Dashboard distingue planeadas e abertas, aceita prazo desconhecido e partilha o instante de referência entre catálogo central e privado. Matching usa uma projeção compacta e palavras-chave; não determina elegibilidade. O percurso de lista central reutiliza o DTO, evitando um detalhe por oportunidade, e revalida a autoridade antes de responder.

Candidaturas e interesses conservam o snapshot bruto da revisão escolhida. A leitura gera o DTO sem substituir esse snapshot por dados atuais. Criação de candidatura v2 confirma identidade, revisão e lifecycle atuais. Título e prazo confirmado v2 alimentam browse, reporting, parceiros e alertas; previsão não é usada como prazo oficial. Regras de organização, membership e autorização existentes permanecem aplicáveis.

O limite ativo de `application.central_snapshot` continua em 32 KiB JSONB. O repositório recusa snapshots maiores com `SCHEMA_UPGRADE_REQUIRED` antes da escrita, sem reduzir evidência. A expansão aditiva e a ativação de escritores pertencem a S6. Interesses mantêm listas compactas e aplicam o limite do detalhe ao envelope com snapshot, DTO e capacidades, incluindo leitura/replay e preparação anterior à escrita.

## Fronteira da prova

Testes JavaScript, SQL gerado, HTTP com dependências isoladas e browser com fixtures não provam execução PostgreSQL nem desempenho. Antes da ativação: matriz SQL→DTO para precisão, cut-offs, ambiguidades, ano ISO 0000, correções v1 e meia-noite; medição dos joins laterais; permissões, CAS, persistência e preservação de vínculos. A consulta SQL usa helpers para representar ISO 0000 como 1 BC em PostgreSQL, conservando a notação ISO nos factos; esta fronteira exige o gate real S6.
