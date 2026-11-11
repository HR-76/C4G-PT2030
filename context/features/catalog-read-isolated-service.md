# GCNI — serviço de leitura isolado

Estado: **Complete no âmbito funcional isolado**. Melhoria global In Progress. Data: 01/11/2026.

## Resultado

Implementado serviço e router para `/api/catalog-read/v1`: lista, ficha, opções e oito coleções (prazos, dotações, regras financeiras, documentos, conflitos, relações, histórico e evidências). O contrato G1/G2 foi preservado. A composição `createReadRuntime` recebe dependências e chave do servidor; não lê configuração do cliente, abre portas, cria pools, importa fontes ou monta rotas globais.

O serviço foi executado e testado em HTTP de loopback e PostgreSQL 18.3 próprios. O servidor de teste e os clusters foram encerrados no fim. Não foi alterada a APP habitual, o frontend, o manifesto ativo ou a base habitual. Nenhuma fonte foi reativada. As rotas existentes do GCNI mantêm-se.

## Comportamento verificado

| Área | Implementação e prova |
| --- | --- |
| Autoridade | Sessão assinada já existente; consultas centrais verificam utilizador, organização, membership, estados, validade e versões. Contexto nunca vem de query/body. Revalidação antes do trabalho e antes de devolver a resposta. |
| Separação de contas | Login de catálogo só assume a role de leitura das vistas/ledger; login de autoridade só assume a role de consulta das colunas necessárias à membership. Sem superuser, herança automática ou permissões de escrita. Leitor de membership não consulta email/perfil nem projeções. |
| Admissão | Verificação fresca de esquema, funções, triggers, ACLs, roles, memberships esperadas e ledger. Alteração de permissões resulta em 503, sem fallback. Pool com role residual ou identidade excessiva é recusado. |
| Snapshot | Token opaco cifrado/autenticado AES-256-GCM com geração, sujeito/âmbito/versões, asOf e expiração absoluta de 900 segundos. A chave é fornecida pelo servidor, sem valor padrão. O token não concede acesso. |
| Cursor | Autenticado e vinculado ao snapshot, rota, recurso, filtros normalizados, ordem e última chave. Não contém offset utilizável pelo cliente. Alteração de consulta/coleção é 409; adulteração é 400. |
| Paginação |25 itens por página, com orçamento de 1 MiB para lista e 512 KiB para ficha/coleções. Página pode ser mais curta e continuável. Um único item demasiado grande origina 503 explícito, sem truncagem silenciosa. |
| Consistência | Lista, ficha e coleções usam a revisão da mesma geração. Publicar outra geração, incluindo vazia, não mistura páginas antigas. Geração indisponível é 410. Não há escrita de snapshots em GET. |
| Expiração e revogação |410 na fronteira exata dos 15 minutos; não há renovação deslizante. Revogar membership na base real bloqueia a leitura seguinte, mesmo com snapshot válido. Outro sujeito/âmbito é 403. |
| Pesquisa | Filtros G1, normalização versionada com casefold Unicode e remoção de acentos, ordenação estável/ID e nulos no fim. Dinheiro é comparado com inteiros escalados, sem arredondamento ou câmbio. |
| Ficha/coleções | Schemas de resposta obrigatórios; referências de evidência são verificadas e relações só podem apontar para a geração autorizada. Sem notas/interesses/documentos privados de organizações. |
| HTTP | `private, no-store`, JSON UTF-8, sem ETag/304 e sem CORS adicional. Erros públicos não expõem SQL, tokens, credenciais ou exceções internas. |

## Modelo e migração

Projeção interna 1.2 acrescenta os inputs de origem e extensão, já validados, para reconstruir a derivação temporal no asOf do snapshot. Esses inputs não são transportados nos DTOs HTTP. O digest inclui os inputs; leitura reconstrói e compara o resultado original antes de derivar o resultado no novo asOf. Isto evita usar um estado temporal antigo durante toda a vida de uma geração. Uma página posterior mantém o mesmo asOf, mesmo que o relógio avance.

A migração candidata 048 aceita projeção 1.2, acrescenta a vista de gerações publicadas (incluindo vazias), leitura do ledger e role mínima de membership. As migrações anteriores não foram reescritas. O ensaio confirmou instalação em base nova e atualização do pacote isolado 047 para 048, com verificação da assinatura anterior e replay sem alterações. Os números 046–048 continuam locais ao manifesto isolado; não foram registados ou ativados no manifesto operacional.

Projeções 1.0/1.1 continuam preservadas na base; o novo serviço recusa-as com 503 se não tiverem inputs suficientes. Antes de utilizar uma geração antiga neste serviço é necessária reconstrução/publicação autorizada de projeções 1.2. O leitor habitual permanece independente.

GET usa transações READ ONLY, timeout SQL e lock partilhado de admissão, coordenado com o lock exclusivo da instalação. Não existe limpeza automática: as gerações publicadas são imutáveis e não elimináveis pelo modelo candidato, conservando o histórico para os snapshots. Uma futura política de eliminação terá de introduzir retenção/leases explicitamente; não está autorizada aqui.

## Testes e matriz de aceitação

**Suite backend: 2442 testes — 2435 PASS, 0 FAIL, 7 SKIP**, aproximadamente 62 segundos. Os sete ignorados são registados como tal, não contam como sucesso. Treze testes novos do serviço cobrem paginação, contexto/tampering, expiração, filtros, consistência, coleções, temporalidade, revogação durante leitura e orçamentos de bytes. Os testes anteriores de projeção e paridade G2 continuam a passar. Sintaxe de todos os JS/CJS deste pacote verificada; a composição final foi exercitada pelo gate HTTP.

**Gate PostgreSQL 18.3/HTTP:36 verificações PASS**. Inclui as provas anteriores de migração/persistência/aprovação e novas provas de atualização 047→048,27 oportunidades sintéticas, dois logins reais limitados, cookies assinados carregados da store central, membership real, duas páginas 25+2, ficha/coleções/opções, zero escrita de GET no catálogo/sessão, expiração, revogação, publicação de nova geração e recusa de drift.

| Critério desta etapa | Resultado |
| --- | --- |
| Sessão/membership/versões atuais em todos os pedidos | PASS — SQL central e HTTP com revogação real |
| Admissão do esquema e leitura exclusivamente publicada | PASS — drift e privilégios limitados |
| Snapshot 15 min absoluto e cursor vinculado | PASS — fronteira, adulteração e contexto |
| Lista/ficha/opções/coleções dentro do contrato | PASS — schemas, filtros e limites de bytes |
| Derivação no asOf e revisão estável entre páginas | PASS — unitário e publicação real durante contexto HTTP |
| Sem fontes, alterações habituais ou escrita de GET | PASS — âmbito do diff, estado QUIESCED e contagens/registos |

Nenhum build frontend foi necessário: não houve alterações de interface. Os testes não constituem uma certificação da base habitual ou do fornecedor OIDC externo.

## Autorrevisão

Revisão feita pelo próprio autor, sem alegação de revisão independente. Veredicto: **pronto para fechar o serviço funcional isolado**; não pronto para ativação operacional.

1. Corrigida a fronteira temporal: TTL pertence ao snapshot, não à data de publicação da geração. A projeção 1.2 conserva inputs para recalcular no asOf e manter a consistência das páginas.
2. Acrescentada vista de metadados publicados para distinguir uma geração vazia válida de uma geração ausente.
3. Corrigida a admissão de atualização: o pacote verifica explicitamente 047 antes de aplicar 048; não exige reconstruir sempre do zero.
4. Separada a consulta de autoridade numa role própria após o ensaio demonstrar que a role central genérica não tinha os grants necessários. O resultado foi revalidado com dois logins limitados reais, sem alargar permissões das roles habituais.
5. Acrescentados testes de páginas curtas por bytes, item individual demasiado grande, valores temporais incertos no fim e revogação entre autorização inicial e resposta.
6. Adicionado lock partilhado de migração, timeout SQL, recusa de role residual e descarte da ligação se o rollback falhar. O leitor não continua com uma decisão antiga de admissão.
7. As primeiras fixtures HTTP não preenchiam timestamps obrigatórios e a suspensão da membership exigia suspended_at; a preparação passou a cumprir as constraints existentes. Um teste temporal inicial tinha rondas posteriores ainda abertas: foi corrigido para uma fixture de prazo único. Nenhuma constraint ou expectativa de produção foi relaxada.

## Limites materiais e integração seguinte

- O ensaio funcional usa 27 oportunidades e relógio controlado. Não foi executado o alvo G1 de 10000 oportunidades/10 pedidos concorrentes/p 95. A implementação atual carrega a geração dentro de limites de 10000 linhas/64 MiB e reconstrói as projeções em memória; ultrapassar limites dá 503. O desempenho e a estratégia de consulta têm de ser medidos/otimizados antes de ativação habitual. Não há promessa de capacidade operacional.
- Cookies e sessões foram exercitados com a biblioteca real e store PostgreSQL, mas identidades sintéticas: não houve autenticação externa no fornecedor OIDC, browser/frontend nem prova de todos os perfis administrativos. Esta rota exige membership; não cria bypass para administrador sem organização selecionada. As rotas administrativas atuais mantêm-se.
- O catálogo devolvido é comum e sem overlays privados. Foi provada a separação do contexto/snapshot entre organizações, não uma exportação de dados privados multi-tenant.
- A chave de tokens, os pools limitados, a integração com o middleware de sessão e o rate limit existente terão configuração explícita quando o router for integrado. Não existe novo login nem nova quota inventada. Alterar a chave invalida tokens anteriores; gestão operacional/rotação não foi ativada.
- Escritor operacional, aprovação humana/OIDC, ativação de migração e publicação de novas gerações reais continuam fora desta etapa. Não há recolhas, publicação automática de conflitos, deploy ou instalação habitual.

Próximo passo: integrar a barra de filtros, a tabela e a ficha com este serviço no ambiente isolado, incluindo estados de erro, revogação e expiração; manter a validação de carga como condição antes de ativação habitual.
