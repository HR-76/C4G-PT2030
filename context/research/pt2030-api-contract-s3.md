# S3 — contrato observado da API pública Portugal 2030

Investigação em 30/10/2026, concluída às 23:30 UTC. Skill `code-hacks-ai:research`; consultas públicas sem credenciais, importações ou escritas na APP. Este documento complementa a [calibração de 28/10](opportunity-sources-calibration-2026-10-28.md), sem transformar a interface observada num contrato aprovado para produção.

## Recomendação

Implementar o adaptador XLSX central sobre as 177 linhas normativas. Manter a API de avisos como integração separada, por validar antes de implementar o respetivo adaptador. Já existe interface pública funcional; faltam garantias de cobertura, semântica temporal, financiamento e relação de identidade com o plano. Não substituir o Excel pelo resultado da primeira página nem usar o workflow privado existente como atalho central.

O código atual em `backend/src/opportunityImports/portugal2030Xlsx.js` apenas lê XLSX e produz v1; não contém cliente desta API. A [decisão de administração C4G](../features/portugal2030-platform-ownership.md) mantém upload/processamento central dependentes de composição e F11 próprios.

## Contrato observado

| Aspeto | Evidência |
| --- | --- |
| Endpoint | `https://portugal2030.pt/wp-json/avisos/query`, GET/POST; OPTIONS 200 anuncia ambos |
| Declaração OPTIONS | `pesquisaLivre`, `order_by_field`, `order_by_direction`, `wpml_language`; não documenta todos os filtros usados pelo frontend |
| Envelope | JSON com `avisos`, `status`, `balcao2030_cache`; HTTP 200 e `status:201` nas consultas positivas |
| Registo | `aviso`, `estrutura[]`, `calendario`, `documentos[]` |
| Identidade/título | `aviso.avisoGlobalId`, `codigoAviso`, `designacaoPT`/`designacaoEN` |
| Financiamento/classificação | `estrutura[]`: programa, fundo, objetivos/tipologias, `dotacao`, `marca`; sem moeda explícita na amostra |
| Calendário | `dataPublicacao`, `dataInicio`, `dataFim`, `dataFimAtual`; horas sem offset |
| Alteração | `aviso.dataUltimaAlteracao`, igualmente sem offset |
| Esgotamento observado | HTTP 200 com `status:404`, sem array `avisos`, na página 1 de pesquisa com único resultado |

Origem primária: [endpoint público](https://portugal2030.pt/wp-json/avisos/query). O exemplo consultado, ID 34324/código `COMPETE2030-2026-15`, contém dotação 25000000 e fim atual `2027-01-08T17:00:00`. Estes dados são amostras contratuais, não candidatos importados nem valores normalizados pela APP.

## Comportamento do frontend oficial

A [página Avisos](https://portugal2030.pt/avisos/) usa POST com formulário, `page` iniciado em 0, incremento por página e paragem com menos de 5 elementos ou `status:404`. Ordena por `publicacao`/`inicio`, ascendente/descendente. Os filtros incluem programa, fundo, NUTSII, natureza, entidade e modalidade. A taxonomia embutida associa 6 a Agendado, 7 a Aberto e 8 a Fechado; 7 é o filtro inicial. Nos registos observados, o estado não é repetido individualmente.

A interface apresenta `calendario.dataFimAtual`, reduzindo o texto à data. Reconhece cache `stale` e avisa que os resultados podem ter até 24 horas. O envelope observado acrescenta idade e atualização em curso. Links de documentos usam `/wp-json/avisos/download` com `container`, `path` e `filename`; não foi descarregado nenhum PDF. O widget Digital Fundos continua distinto desta API.

## Provas e limites da amostra

Foram executados: OPTIONS; GET simples; GET páginas 0/1; POST com pesquisa pelo código observado; GET de Agendado e Fechado; GET página 1 dessa pesquisa. As páginas 0/1 devolveram cinco IDs cada, sem sobreposição nessa amostra. A pesquisa retornou um resultado; Agendado retornou três, Fechado cinco. Isso não comprova total global nem ausência de mudanças/duplicados entre páginas numa recolha prolongada.

| Resposta amostrada | Bytes | SHA-256 dos bytes recebidos |
| --- | ---: | --- |
| GET `?page=0` | 17464 | `b726c63a06e120cee77d23cbc964c5cf1abdb9b4b127aae629626470e4a3855d` |
| GET `?page=1` | 16826 | `848952616e62ddfe9ffb5c2afc6d451f2ce9cc6cfa7a78cb25bcbef41b491c4f` |

Os hashes identificam a observação efetuada, não um fixture arquivado/reproduzível: os payloads não foram guardados e incluem metadados variáveis de cache. Os IDs, nomes de utilizadores internos e parâmetros de armazenamento de documentos recebidos não foram copiados para o corpus normativo nem para um catálogo. Não houve varrimento completo, ensaio de limites/429, retry, estabilidade de ordenação ou concorrência.

## Relação com o plano e implicações

A [página do Plano Anual](https://portugal2030.pt/plano-anual-de-avisos/) mostra 172 avisos previstos para setembro 2026–agosto 2027 e disponibiliza XLSX; o corpus fornecido pelo utilizador contém 177 linhas e foi fixado por hash em S0. A diferença permanece entre observações/edições. Não foi comprovada equivalência entre o ID da coluna A e `avisoGlobalId`, nem ligação dos resultados amostrados a essas linhas. Nenhuma contagem global da API foi medida.

Não unir plano e aviso por semelhança de título/programa. Usar identidade publicada verificável ou decisão editorial, mantendo previsões históricas. O campo `Agendado` da coleção de avisos não transforma todos os registos do plano em avisos publicados.

Antes de um adaptador API:

- Definir paginação limitada, ordem estável e verificação de cobertura; nenhuma das respostas observadas contém total, cursor ou identificador de snapshot.
- Confirmar timezone/semântica das horas e alterações de prazo. Não acrescentar `Z`, não usar timezone da máquina e não eliminar a hora para fazer passar o validador.
- Preservar dotações por estrutura e verificar agregação, moeda e referências; o total não pode ser repetido por programa/fundo. Ler números pelos lexemas originais.
- Vincular estado à consulta/evidência, distinguir cache de alteração do aviso e verificar lookup pela identidade exata; pesquisa textual não é um endpoint de identidade demonstrado.
- Fixar contrato de documentos e dados necessários; campos técnicos/pessoais de autoria não pertencem ao DTO público do catálogo.

Não foi localizada documentação versionada, SLA ou licença específica da API. Os [termos publicados](https://portugal2030.pt/termos-e-condicoes/) reservam direitos de conteúdo e admitem interrupção/desatualização do site; não demonstram autorização irrestrita de reutilização nem estabilidade da interface. A disponibilidade pública permite esta inspeção, mas não substitui a definição das condições de uma integração operacional.

Próximo passo: concluir S3 sobre o XLSX normativo e manter o adaptador API pendente de prova contratual dos pontos acima, sem recolha automática ou fusão com o plano.
