# Inventário e contratos de leituras centrais — preparação

Estado: em validação isolada. Objetivo: documentar chamadas de leitura, os dados necessários e os limites de autoridade sem alterar permissões, schema ou comportamento produtivo. A primeira fatia cobre o diretório organizacional e destinatários de alertas/avisos; não é inventário exaustivo nem concede privilégios novos.

Inventário de outros consumidores e distinção entre pool geral, autoridade e catálogo: [levantamento inicial](../reviews/central-reader-matching-wal-20261109.md). As colunas e identidades efetivas das restantes operações permanecem por inventariar; não usar a presente fatia como manifesto completo de grants.

## Contratos da primeira fatia

O contexto de organização e ator é obtido e autorizado pelo servidor. Estes contratos descrevem leituras internas; não criam uma fronteira de segurança SQL independente nem autorizam pedidos diretamente. Cada operação protegida conserva guardas, auditoria e revalidação existentes. A falha da base não deve tornar-se resposta bem-sucedida parcial.

| Operação | Entrada interna | Saída e semântica corrente | Fonte |
| --- | --- | --- | --- |
| Organização ativa | ID da organização validada | id, nome, nome legal e tipo; indisponível se não houver organização ativa | `organizationDirectory/composition.js` |
| Memberships do diretório | ID validado | memberships ACTIVE/SUSPENDED, nome, email, estado e revisão; ordem nome e ID; limite SQL 1001 | `organizationDirectory/composition.js` |
| Destinatários de alertas | ID validado, IDs candidatos e ator excluído | IDs ativos e válidos temporalmente, utilizador e organização ativos; lista vazia evita consulta | `applications/composition.js` |
| Destinatários de avisos | ID validado e IDs opcionais | memberships ativas e válidas, nome; ordem nome e ID; recusa se >1000 | `applications/composition.js` |

## Aceitação

Provar a consulta real equivalente de cada operação em PostgreSQL descartável, com duas organizações, ativos/suspensos, exclusão e validade, resposta de falha e recusa de escrita; manter SQL, limites e verificações existentes. As consultas filtradas não demonstram que uma role de tabela não pode ler outra organização: essa fronteira exige solução própria. Separar identidades de autoridade, catálogo e leitor geral no inventário; não alterar grants habituais. R2 real excluído.

## Resultado parcial em 09/11/2026

[Prova isolada](../reviews/central-read-contracts-20261109-b/results.json): PostgreSQL descartável, duas organizações sintéticas, SQL extraído das composições existentes, SELECT concedido apenas às três tabelas da fatia, recusa de escrita e da tabela de identidade. Testadas listagem de memberships, seleção de alertas e de avisos, incluindo organização estrangeira, suspensão, validade futura e exclusão do ator quando aplicável. A suspensão usa o coordenador existente. Contentor próprio removido. Testes focados de diretório, avisos, equipas e leitor de tenant: 23 PASS.

A primeira execução [falhou](../reviews/central-read-contracts-20261109-a/results.json) porque tentou alterar uma membership diretamente e a guarda central recusou; a fixture foi corrigida para usar o protocolo normal, sem desativar a guarda. O ensaio ainda não cobre a consulta de organização ativa, o limite de 1001, falha da base, autorização HTTP ou revogação concorrente. Não foi extraída uma interface produtiva nem modificada qualquer permissão produtiva. SELECT nas tabelas continua a permitir leituras diretas entre organizações; a prova dos filtros não estabelece isolamento ao nível SQL.

## Continuação — consultas e inventário

[Prova adicional](../reviews/central-read-contracts-20261109-c/results.json): PASS em PostgreSQL 18 descartável, com mais de 1000 memberships sintéticas. Consulta de organização ativa devolveu a organização e zero linhas para ID ausente; consultas de diretório e avisos devolveram no máximo 1001; revogar SELECT de uma tabela **apenas na fixture** fez a consulta de diretório falhar com 42501. A role voltou a receber o grant apenas no cluster descartável, depois removido. A prova não executou o controlador que transforma 1001 em recusa, nem simulou queda de ligação ou organização suspensa. O teste de erro HTTP usa doubles: não é prova ponta a ponta da falha SQL.

Testes focados de diretório HTTP, avisos, faturação e leitor de diretório: 24 PASS, incluindo recusa por organização/workload e revogação durante leitura de faturação; os detalhes de infraestrutura são simulados. Os [gates anteriores de identidade e revogação](../reviews/threat-model-identity-isolation-20261109.md) exercitaram HTTP/OIDC e concorrência com PostgreSQL/Keycloak descartáveis, mas não cobrem especificamente todos os quatro contratos acima.

| Consumidor adicional | Identidade/pool observado | Contrato e limites de segurança observados | Evidência |
| --- | --- | --- | --- |
| Faturação da plataforma | `centralPool` para `centralRead`; escrita usa coordenador | READ ONLY, timeout, autorização antes e depois da consulta; o repositório também contém comandos de escrita, que não devem ser atribuídos ao leitor. | `backend/src/platformBilling/service.js` e `platformBilling/sql.js` |
| Faturação da organização | `centralPool` para dados; coordenador de autoridade para contexto | REPEATABLE READ READ ONLY, timeout, contexto organizacional e permissão; revalidação antes da resposta. | `backend/src/customerBilling/service.js` e `customerBilling/repository.js` |
| Diretório de tenants com coordenador | pool do coordenador | Operação fixa `resolve`, organização e workload numa allowlist de configuração, no máximo uma linha; não concede autorização funcional. | `backend/src/security/tenantDirectoryReader.js` |
| Importação assíncrona | pool central e pool de autoridade separados | Leitura de organização ativa e binding WORKER para descoberta; worker também usa fila e repositórios de membership. Não é uma identidade de leitura genérica única. | `backend/src/config/opportunityImportWorkerInfrastructure.js` |
| Document worker | pool central dedicado ao perfil de fila | Verifica perfil, versão e nomes de filas; não inferir privilégios necessários dos restantes workers. | `backend/src/config/documentWorkerInfrastructure.js` |
| Captura isolada de email de estado | coordenador no caso de captura ligada em `applications/composition.js` | Uma consulta agrupa organização, ator e memberships candidatas; revalida autorização. Modo isolado/desativado por omissão; não inferir envio produtivo. | `backend/src/applications/statusEmails/capture.js` |

O inventário continua parcial: falta decompor queries indiretas, colunas e funções por operação, medir identidade SQL real de cada configuração e realizar gates integrados de falha, revogação e limite nos contratos afetados. As leituras de tabela observadas não constituem isolamento SQL por organização. Não houve alteração de runtime nem de privilégios de ambientes habituais.

## Experiência de privilégio por coluna

Em cluster sintético exclusivo, repetir as quatro consultas da primeira fatia com SELECT limitado às colunas efetivamente usadas; recusar SELECT de coluna não concedida, `SELECT *`, escrita e tabela de identidade; manter testes de filtros e limite. A experiência não altera grants de runtime, não prova permissões suficientes para todas as operações centrais e não impede leitura de outras organizações por SQL direto. Confirmar remoção do contentor e documentar resultado antes de propor integração.

Resultado: [prova](../reviews/central-reader-columns-20261109-a/results.json) PASS com PostgreSQL 18 descartável, duas organizações e mais de 1000 memberships; `SELECT *`, escrita e tabela de identidade recusados; container próprio removido. As quatro consultas selecionadas funcionaram com grants apenas às colunas usadas. Nenhum grant de ambiente habitual foi alterado. A prova não cobre HTTP, todas as operações nem isolamento de linha: não existe ainda um contrato produtivo completo ou correção do leitor geral.

## Incremento delimitado — organização ativa

Introduzir um leitor interno vinculado à organização validada na composição, que recusa identificador diferente antes da consulta e mantém a mesma projeção, SQL, erros e guarda externa. Não substitui isolamento SQL nem completa o leitor central. Regressão deve confirmar que tentativa cruzada não chama a base, organização própria é lida, inexistente falha e erros SQL propagam; executar testes de diretório e gate SQL descartável. Sem alterações a grants ou bases habituais.

Implementado em `organizationDirectory/centralOrganizationReader.js` e integrado na composição: rejeição prévia de ID diferente da organização validada; SQL e projeção preservados. Regressão inicial falhou por módulo inexistente e passou após implementação. Testes focados: 26 PASS. [Prova SQL de grants por coluna](../reviews/central-reader-columns-20261109-b/results.json) PASS com duas organizações e mais de 1000 memberships, contentor removido. [Gate de sessões HTTP/OIDC](../reviews/central-bound-reader-sessions-20261109/results-sessions.json) PASS, com PostgreSQL e Keycloak descartáveis; não prova especificamente o caminho HTTP do diretório com o novo leitor. Backend completo 2742 PASS/7 SKIP, frontend 815 PASS e build PASS. A prova por coluna testa as queries, não o helper através de HTTP. A role com SELECT continua capaz de ler linhas de ambas as organizações diretamente: leitor geral e isolamento SQL não estão concluídos.

Continuação: [prova com o helper real e SQL](../reviews/central-bound-reader-real-sql-20261109/results.json) PASS em PostgreSQL descartável e grants por coluna: organização própria devolvida e pedido por outra organização recusado antes de emitir SQL. Não é prova HTTP nem um controlo de isolamento SQL para outras consultas; o leitor geral permanece aberto. Container próprio removido.

## Incremento — porta de memberships do diretório

Extrair a consulta existente para uma porta interna vinculada à organização validada e sem parâmetro de organização fornecido pelo chamador. Preservar SQL, ordenação, limite 1001, tratamento de erros, autorização e auditoria da composição. Testes de contrato antes da mudança; repetir proof de SQL e role com PostgreSQL descartável, suites e build. Isto não estabelece isolamento SQL por linha nem completa as portas centrais.

Resultado: porta de memberships integrada em `centralOrganizationReader.js`, mantendo a consulta e as guardas da composição. Regressão falhou antes da extração e passou depois; 27 testes focados PASS; backend 2744 PASS/7 SKIP; frontend 815 PASS e build PASS. [Prova PostgreSQL isolada](../reviews/central-membership-port-20261109/results.json) validou o helper real com duas organizações, grants por coluna e recusas SQL; após inserir mais de 1000 memberships, testou o limite diretamente na consulta SQL. Contentor próprio removido. A prova não cobre HTTP nem bloqueio por linha: a paginação do matching e as restantes portas centrais continuam abertas.

## Incremento — destinatários de alertas e avisos

Extrair ambas as consultas da composição de candidaturas para portas internas associadas à organização validada, preservando SQL, limites, regras de filtragem e autorização externa. Testar lista vazia, identidade e propagação de erros, limite dos avisos e consultas reais com permissões isoladas. Não afirmar isolamento SQL por linha nem conclusão das demais portas.

Implementado em `applications/centralRecipientReaders.js`, com composição e guardas existentes. Regressão RED/GREEN; 9 testes focados PASS; backend 2746 PASS/7 SKIP, frontend 815 PASS e build PASS. [Prova PostgreSQL isolada](../reviews/central-recipient-ports-20261109-b/results.json) passou com duas organizações, grants por coluna e chamadas aos leitores reais; o limite SQL foi testado com mais de 1000 memberships. Contentor próprio removido. Não é teste HTTP integrado nem validação de isolamento SQL por linha. O contrato HTTP e a paginação de matching não foram implementados; demais portas permanecem abertas.
