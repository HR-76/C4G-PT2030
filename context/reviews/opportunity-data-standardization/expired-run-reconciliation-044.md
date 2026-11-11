# Reconciliação do run EU expirado — 044

31/10/2026. Estado: Review — reconciliação habitual concluída e verificada às 18:37:28 UTC. [Contrato congelado](../../references/opportunity-v2/expired-run-reconciliation-contract.md) e [descritor final](../../references/opportunity-v2/expired-run-reconciliation-044.json). Este relatório continua a [janela043](writer-execution-043.md); as provas anteriores permanecem históricas.

O run expirado foi encerrado por uma operação autenticada e auditada, com alteração exata de quatro registos. EU permanece `QUIESCED`, fence 7, agora com zero runs pendentes, zero runs expirados/não recuperáveis e zero leases ativas. Não houve retoma, novos jobs ou alteração dos alvos. A capacidade Central044 está instalada; tenant034 e configurações foram preservados.

## Âmbito

Encerrar por expiração o run `75b462ed-a399-4bdb-bd96-ed18507761c9` do ciclo `7266ad6b-8880-4ec1-9399-4751187831c5`, com EU `QUIESCED` e fence 7. O prazo original do envelope terminou em `2026-10-31T16:44:48.588Z`. O preview inicial confirmou uma única pendência e nenhuma lease ativa; reiniciar os serviços locais necessários à autenticação não mudou esse preview.

A política automática EU continua limitada à atualização de oportunidades já em v2 sem perdas ou conflitos. Esta operação não aceita migrações v1, resolve conflitos ou inicia recolhas. Os 393 alvos ainda não tratados permanecem por conferir; expiração do transporte não é evidência de erro nos dados da fonte.

## Alteração implementada

Pacote aditivo `opportunity-eu-expired-reconciliation-v1`, versão `044_opportunity_eu_expired_reconciliation`, instalado exclusivamente pelo migrador registado. SQL036–043 e o tenant034 são preservados. O pacote acrescenta uma capacidade administrativa estreita, dois registos imutáveis de autorização/efeito e uma guarda de commit.

O plano vincula preview, código, configurações, backup/restauro, validação e validade máxima de uma hora. A aprovação passa pelo percurso OIDC habitual e pela autoridade administrativa persistida, com autenticação recente. A execução verifica a aprovação e acrescenta um evento crítico de auditoria na mesma transação dos efeitos. Revogação, drift, leases ativas, prazo válido ou intenção divergente impedem a operação; replay da mesma intenção não duplica efeitos.

| Registo | Estado anterior | Efeito aplicado e verificado |
|---|---|---|
| Run filho | RUNNING, lease expirada | ERROR / FUNDING_EXECUTION_EXPIRED, fim, lease nula, fence +1 |
| Ciclo | RUNNING | ERROR / FUNDING_EXECUTION_EXPIRED, fim |
| Inbox | PROCESSING, lease expirada | FAILED / EXPIRED, fim, lease nula, fence +1 |
| Execution | QUEUED, prazo expirado | EXPIRED, atualização, lease nula, fence +1 |
| Outbox | PUBLISHED | Preservação integral |
| Fonte EU | QUIESCED, fence 7, uma pendência | Controlo preservado; contadores derivados de pendências passam a zero |

O `outbox_id` nulo na projeção INITIAL é legítimo no percurso existente. A correspondência é comprovada pela identidade, linhagem, tentativa, content/envelope digests, job e deadline originais; não é preenchida artificialmente. A capacidade não permite republicar, prolongar prazos, criar sucessores, alterar alvos ou escrever genericamente durante a suspensão.

## Revalidação do código

As cinco remoções de módulos são intencionais e constam do [contrato de limpeza](../../features/repository-cleanup.md). Os bytes no ZIP recuperável foram conferidos contra os hashes da prova043; nenhuma cópia ativa foi restaurada. A otimização do fingerprint tenant é comparada em PostgreSQL real com a implementação anterior, incluindo bytes serializados e drift de ACL/RLS. Os preflights normais verificam o código atual e as versões043/044.

As primeiras tentativas falhadas são conservadas: erro sintático de geração do candidato SQL, drift de inputs durante desenvolvimento e fixtures unitários que ainda não admitiam044. Não são usadas como aprovação do código final. A evidência `INCOMPLETE_CODE_DRIFT` da janela043 não é reescrita.

Dois ensaios completos chegaram a40 verificações PASS e recusaram o efeito antes do teste de rollback. O diagnóstico isolado identificou `FORCE ROW LEVEL SECURITY` em `audit.event`: a política existente ocultava os eventos PLATFORM ao helper executado como owner. A correção exige uma política SELECT apenas para o owner da auditoria e apenas para os eventos críticos de aprovação/aplicação desta reconciliação. Mantêm-se RLS forçado, ausência de SELECT geral nos runtimes e verificação exata de ator, plano e digests. Os flags e a política entram no fingerprint de segurança044; não se altera a política histórica nem se concede BYPASSRLS.

A prova seguinte detetou `55P03` na instalação: a leitura do ledger na transação de autoridade conservava um lock incompatível com `CREATE POLICY` noutra ligação. A reprodução mínima em PostgreSQL18 confirmou a causa. A leitura/validação do histórico imutável passa por um savepoint, cujo rollback liberta só os locks adquiridos nessa leitura. Os locks da sessão e do administrador são adquiridos depois e mantidos durante o DDL; a revalidação imediatamente antes da aplicação conserva os locks anteriores ao savepoint. Uma regressão RED→GREEN cobre leitura adulterada e revalidação repetida; o gate também exige que uma revogação concorrente continue bloqueada.

Uma leitura real como `c4g_catalog_reader` encontrou depois `42501`: o cast nominal `audit.event::regclass` exigia acesso ao schema da auditoria. A consulta usa agora `pg_class`/`pg_namespace`, com o mesmo resultado e ordenação. A comparação owner/leitor, na mesma transação READ ONLY habitual043, confirmou bytes e digest iguais, sem novos grants. O ensaio em curso nessa altura foi interrompido, e os seus recursos próprios removidos, antes de repetir com a correção; o relatório conserva esse motivo explícito.

O ensaio seguinte passou instalação, locks, leitores, RLS e rollback, e obteve200 na execução e no replay. Falhou depois uma asserção do harness que concatenava a string `bigint` da fence (`'1'+1`) em vez de somar numericamente. A correção limita-se ao ensaio e usa aritmética `BigInt`. As suites de produto mantêm validade porque os respetivos inputs não mudaram; a prova final identifica separadamente a revisão do harness e a nova execução integral.

## Recuperação

Antes da instalação, a janela exige cópia coordenada Central043, tenant034, globals e sete ficheiros privados, com ACL restrita e restauro num cluster próprio. A exceção de pausa só admite o run/envelope expirado do preview; qualquer outro trabalho pendente impede a cópia. A fronteira entre backup e SQL compara dados, sequências, configuração, ausência de sessões externas e processos parados. Autoridade e plano são novamente conferidos imediatamente antes do DDL.

Se a preparação falhar antes do SQL, os serviços conhecidos são repostos e EU continua suspensa. Se uma instalação puder ter sido parcialmente confirmada, os consumidores ficam parados para diagnóstico; não há downgrade044 ou restauro destrutivo automático. O instalador admite replay limitado após conferir a versão física e todas as invariantes. Uma falha da reconciliação dentro da transação faz rollback de efeitos, recibo e auditoria; uma resposta incerta exige primeiro consultar recibo/auditoria e conservar a identidade do pedido.

Um restauro efetivo do ambiente habitual requer nova janela explícita: preservar os dados posteriores ao backup, restaurar primeiro num destino próprio, validar versões, identidade/generation, configuração e logins, e só então decidir a reposição coordenada. A prova de restauro lógico não certifica por si só todos os logins num novo destino. A leitura física pelo login API é conferida separadamente no ambiente habitual.

## Evidência operacional

Todos os passos abaixo terminaram com sucesso. O diretório [da janela habitual](../../../output/opportunity-eu-reconciliation-e20d478b-c6b4-4b3a-87cb-25e29bf789ba/window.json) reúne os artefactos imutáveis. O estado `INSTALLED_AWAITING_RECONCILIATION` do instalador é o seu resultado histórico correto: execução e verificação posteriores são artefactos separados.

| Etapa | Resultado e evidência |
|---|---|
| Código atual | Backend: 2331 PASS, 7 SKIP, zero falhas; frontend: 496 PASS em 63 ficheiros, build PASS; operacional: 69 PASS; sintaxe: 26 módulos PASS. [Checks e hashes dos logs](../../../output/opportunity-eu-reconciliation-validation-42188168-9e32-4928-bf44-6d38e94388b7/checks-release.json). |
| Gate PostgreSQL/PgBoss isolado | 43 verificações PASS, 892 inputs sem drift, cleanup confirmado. Inclui autoridade, recusas, instalação, rollback, replay, leitores limitados e preservação. [Prova final](../../../output/opportunity-v2-reconciliation-03c3b15b565f47aa8645935e89dc6cb0/verification.json). |
| Congelamento | [Validação final](../../../output/opportunity-eu-reconciliation-validation-42188168-9e32-4928-bf44-6d38e94388b7/validation.json): 1360 inputs atuais; único delta face às suites é a correção BigInt do harness, comprovada pelo gate integral posterior. O plano acrescenta sete hashes de configuração. |
| Preparação | Preview `24feec07…81fa` renovado; backup/restauro `65770b8e-3902-4bee-be0d-1c669306826f` PASS, serviços recuperados. Plano `e20d478b-c6b4-4b3a-87cb-25e29bf789ba`, criado às 18:33:41.618 UTC e válido até 19:33:41.618 UTC. |
| Aprovação | [OIDC habitual](../../../output/opportunity-eu-reconciliation-e20d478b-c6b4-4b3a-87cb-25e29bf789ba/approval-2fea460d-95ce-4a16-8ed3-8d9e8c45f2bc.json) com administrador persistido, sessão não fabricada, replay conferido e evento crítico vinculado ao plano. |
| Instalação | [044 instalada](../../../output/opportunity-eu-reconciliation-e20d478b-c6b4-4b3a-87cb-25e29bf789ba/installation.json) às 18:36:18.390 UTC; preflight e ligação física API antes/depois PASS. Backup próprio novamente renovado após aprovação. Autoridade revalidada e bloqueada durante DDL; histórico Central até043 e todas as linhas/colunas anteriores preservados. |
| Antes da reconciliação | [Verificação READ ONLY](../../../output/opportunity-eu-reconciliation-e20d478b-c6b4-4b3a-87cb-25e29bf789ba/before-reconciliation.json) PASS, preview idêntico, uma pendência expirada e nenhum recibo prévio. |
| Execução | [OIDC e execução](../../../output/opportunity-eu-reconciliation-e20d478b-c6b4-4b3a-87cb-25e29bf789ba/execution.json) PASS às 18:37:17.614 UTC. Pedido `01a19340-4131-7bb0-94f9-bd61cc938285`, efeito e replay da mesma intenção confirmados. |
| Depois da reconciliação | [Verificação independente READ ONLY](../../../output/opportunity-eu-reconciliation-e20d478b-c6b4-4b3a-87cb-25e29bf789ba/after-reconciliation.json) PASS às 18:37:28.164 UTC. Quatro linhas exatas, recibo/permit/auditoria concordantes, código/configuração atuais conferidos e saúde pronta. |

O segundo [backup/restauro](../../../output/opportunity-v2-window/fb103a50-07fc-4e9b-a7a2-20c1a6c856a8/backup-restore-852911f3-a763-4c72-8a04-234c35a4e529.json), `852911f3-a763-4c72-8a04-234c35a4e529`, cobre 239 tabelas e 60 842 linhas: 97/46 178 Central e 142/14 664 tenant. Restauro lógico isolado, dados, schemas043/034, globals e sete configurações coincidem; ACL restrita e limpeza confirmadas. A fronteira imediatamente anterior ao SQL confirmou dados/sequências/configuração iguais, processos conhecidos parados e zero sessões externas. A pausa dos serviços durou cerca de 71 segundos; a suspensão da fonte EU manteve-se continuamente.

Foram preservados os 538 heads, 1502 revisões, 138 arquivos, 138 decisões, todos os 536 alvos do ciclo e 129 tabelas de dados privados. Os alvos continuam com 137 `REVIEW`, cinco `CONFLICT`, 391 `DISCOVERED`, dois `PENDING` e um `UNCHANGED`. A tabela de decisões conserva 137 `REVIEW` e uma decisão histórica `ACCEPTED`; esse estado não equivale a uma nova aceitação nesta janela.

A chamada11145 mantém UUID, revisão5/rowVersion5 e digests anteriores. O montante continua armazenado como SQL `numeric`, valor `120000`, e os sete prazos coincidem com o snapshot canónico. A moeda permanece `NOT_FOUND`/NULL; esta reconciliação não inferiu EUR nem fez nova recolha oficial. O outbox publicado, o envelope, a linhagem e os jobs PgBoss permaneceram idênticos. Run/inbox passaram a fence2 e execution a fence1; o run raiz já concluído manteve-se intacto.

O transporte conserva um registo histórico PgBoss em estado `active`, com digest idêntico ao anterior. Este estado não representa uma lease operacional ativa, e não foi reclassificado pela capacidade limitada. A verificação confirma zero leases e zero runs pendentes; não declara as filas globalmente vazias. Qualquer tratamento desse registo pertence à conferência anterior a uma futura retoma.

O evento de aprovação `01a1933e-4e4e-729a-a849-e0efe4adbc1e` e o de execução `01a19340-4131-7bb0-94f9-bd61cc938285` estão ligados ao mesmo ator humano, plano e preview. Todas as cadeias e eventos históricos conferem; existem exatamente dois eventos desta operação, sem duplicação no replay. A revisão independente de ficheiros confirmou os vínculos e hashes da evidência operacional.

## Limites e seguimento

Esta prova certifica a reconciliação e o código capturado, não a completude da recolha EU. Os 137 casos em revisão, cinco conflitos e 393 alvos por tratar continuam pendentes. As sessões do gate são sintéticas; o OIDC habitual é comprovado separadamente pelos artefactos operacionais. O runtime local não constitui certificação de privilégio mínimo em produção. Os snapshots READ ONLY por base não são um lock distribuído permanente.

Nenhuma futura retoma está autorizada por este plano. Uma nova janela exige estado, código, autoridade e recuperação novamente conferidos. Os resultados falhados ou incompletos anteriores, incluindo a janela043, foram preservados sem reclassificação.
