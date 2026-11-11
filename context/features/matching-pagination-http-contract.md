# Contrato HTTP de paginação do matching — proposta

Estado: **proposta não implementada**. O endpoint atual `GET /api/organization-directory/matching` aceita `personId`, ou `opportunityId` com `origin`; rejeita outros parâmetros, ordena o conjunto completo e recusa fontes acima de 1000. O cliente atual espera um único `items` completo. Não alterar silenciosamente esse contrato.

## Interface proposta para evolução

Disponibilizar um contrato explicitamente identificado por versão, com coexistência ou migração coordenada do endpoint atual; o caminho e a duração de coexistência ainda precisam de ser escolhidos. A primeira consulta usa os mesmos filtros funcionais validados. As continuações usam cursor opaco autenticado e não aceitam uma organização ou identidade fornecida como autoridade. O servidor resolve sessão, organização, membership e autorizações em todos os pedidos e revalida antes de publicar a página.

Resposta de página para estado READY: `state`, `items`, `areaCatalogVersion`, `explanation`, `person` quando aplicável e objeto `page` com `nextCursor` (nulo apenas no fim) e `hasMore`. Propor tamanho fixo de 25 e ordenar globalmente por número de áreas descendente e, para oportunidades, prazo, identificador e origem; para pessoas, nome e identificador. O ordenamento exato tem de ser verificado contra o runtime existente, incluindo null e collation. Resultados não são apresentados como completos antes da leitura integral de todas as fontes autorizadas.

O cursor deve vincular organização, identidade, sessão/autoridade, filtros, modalidade, versão do algoritmo, snapshot ou versões das fontes e prazo absoluto. Uma continuação adulterada, expirada, com filtros diferentes ou dados/autoridade alterados é recusada, sem retornar itens parciais. Definir formalmente código e HTTP status antes da implementação; não confiar em códigos propostos como implementados. A indisponibilidade de qualquer fonte ou auditoria obrigatória falha fechada. Não incluir dados sensíveis nem segredos no cursor ou logs.

Estados `PROFILE_NOT_LINKED` e `NO_AREAS` permanecem distintos e não devem induzir pedidos de continuação. O frontend deve descartar resultados e cursores quando muda o utilizador, organização ou filtro, e não concatenar páginas de snapshots diferentes. Uma página vazia com continuação só é aceitável se o protocolo a especificar e limitar; não inferir fim por ausência de itens.

## Pré-requisitos e aceitação

O protocolo deve demonstrar consistência das fontes Central e tenant, cobertura de todas as escritas relevantes, limites de tempo/memória/concorrência e limpeza ou expiração de snapshots. O ensaio sintético com marcadores é apenas candidato; não garante participação das escritas reais. A autorização e auditoria existentes não podem ser removidas, e deve existir revalidação por página.

Gate: mais de 1000 pessoas e oportunidades em PostgreSQL descartável; comparar concatenação das páginas à ordenação global de referência; incluir múltiplas fontes, empates, filtros, mudanças dentro e fora da página, adulteração e expiração de cursor, duplicados, falha de fonte, revogação e tentativa entre organizações. Testar versão antiga e nova em conjunto e o cliente real. Não considerar o ensaio sintético de ordenação como aceitação deste contrato.

Portas centrais: [inventário e provas parciais](central-read-contract-inventory.md). Não presumir que filtros de aplicação ou grants por coluna garantem isolamento SQL de linha. Sem acesso às bases habituais; R2 real adiado.
