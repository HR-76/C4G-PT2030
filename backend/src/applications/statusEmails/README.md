# Emails internos — etapa local

Módulo isolado; nenhum import no produtor de transições, registry ou worker. Não aplica SQL, não envia email e não altera contratos HTTP. `createTransport()` devolve `DISABLED`; `real` é recusado. `simulated` exige `isolated: true` e só mantém memória da instância, não substitui o ledger persistente futuro.

## Contratos implementados

- `contracts.event`: snapshot fechado, versão de revisão positiva, mudança real de estado, IDs normalizados, instante UTC canónico e candidatos deduplicados/imutáveis. Inclui endereço do autor apenas como dado interno protegido para exclusão por endereço; nunca usar este objeto diretamente como envelope. O futuro produtor resolve candidatos e autor na autoridade central, não no pedido HTTP. `actorEmail: null` significa ausência confirmada, nunca indisponibilidade da autoridade.
- `contracts.payload`: apenas `deliveryId`. Ainda não regista job/envelope.
- `selectRecipients(event, {resolve, now})`: resolve cada membership congelada; devolve `READY` ou `UNAVAILABLE`, destinatários individuais e decisões codificadas. Qualquer indisponibilidade impede seleção parcial. A política deve ser repetida antes de cada tentativa; a consulta real à autoridade central permanece para a integração.
- O port `resolve({organizationId, applicationId, membershipId})` devolve `UNAVAILABLE`, `INELIGIBLE` ou `RESOLVED`. Neste último caso exige os mesmos três IDs, `userId`, `email`, os booleanos `organizationActive`, `userActive`, `membershipActive`, `isResponsible`, `isActiveParticipant`, `canReadApplication`, `canReadOpportunity`, `requiresEvaluation` e, quando aplicável, `canReadEvaluation`. `validFrom` e `validUntil` representam a validade da membership (fim nulo significa sem limite). Todas as permissões são do destinatário, incluindo restrições de unidade e recursos; não do autor/service actor. O port é injetado pelo servidor e não recebe flags do browser.
- `render(event, {publicOrigin})`: retorna templateVersion, subject, html e text. Origem HTTPS configurada, sem credenciais/path/query; link com organização. O guard de contexto do frontend ainda não foi implementado, pelo que estes links só integram simulações nesta etapa.
- `createTransport({mode, isolated, now, outcome})`: `now` devolve milissegundos e `outcome` é callback síncrono de cenário. `send(message, key, signal)` valida mensagem individual e chave, identifica sempre resultados simulados. `stats()` expõe apenas contagens. A chave deve ser derivada da entrega persistente e contexto pelo futuro consumidor, não do endereço. Timeout após aceitação é `UNKNOWN`; repetição idêntica recupera aceitação. Depois de 24h exige reconciliação, sem nova aceitação automática. Isto modela a regra conservadora da aplicação, não uma implementação completa do fornecedor.

Estrutura HTML/texto e escaping adaptados do template UBI, sem imagens CID dependentes de anexos, notas ou destinatários externos. Labels correspondem aos estados atuais da C4G. O double Resend existente é usado nos testes para fornecer cenários, sem dependência de código de teste em produção.

## Validação

`node --test test/applicationStatusEmails.test.js` no backend. Os testes locais não provam persistência, autoridade real, inbox/outbox, migrações nem entrega Resend. Próxima etapa: persistência aditiva e produtor transacional, mantendo ativação desligada.

## Persistência aditiva (etapa 2)

Migração 034 com manifesto/checksum próprio, fora dos installers automáticos. Evento imutável ligado à revisão histórica e entrega por membership, ambos com RLS forçada e permissões mínimas. Sem permissões UPDATE nesta etapa: o futuro consumidor terá de acrescentar permissões/estados de processamento em migração própria. Sem migração down destrutiva; desativar produtor e preservar os registos.

`createProducer` mantém disabled por defeito. O modo isolated exige indicação explícita e port capture interno que resolve o snapshot e candidatos ativos durante a transação. O repositório chama recordStatusEmail depois do histórico/auditoria/alerta e antes do recibo, no mesmo cliente. A composição admite injeção server-side opcional; nenhum bootstrap da APP a fornece. Captura central real e ativação por tenant ainda não estão ligadas. O port deve obter autor/endereço, nome da organização e candidatos ativos da autoridade central, nunca de input HTTP. Indisponibilidade lança erro e faz abortar a transação.

Outbox existente recebe apenas deliveryId. Não há registry/consumidor registado; não executar dispatcher contra o ambiente descartável. Os testes do produtor usam ports controlados; o gate SQL testa a migração real sobre pré-requisitos mínimos, não o provisioning completo da APP.

Gate isolado: `node scripts/testStatusEmailSchema.js` cria/remove PostgreSQL Docker próprio, sem portas publicadas ou credenciais da APP. Valida migração, runtime role, unicidade, isolamento de leitura e rollback. A conclusão não equivale a validar ainda toda a autoridade central nem processamento assíncrono real.

## Captura central e percurso transacional

`capture.js` consulta os campos reais primary_email/display_name da identidade central, num único snapshot SQL para organização, autor e memberships candidatas. Candidatos provêm apenas do responsável e participantes ativos do tenant; valida o histórico da transição e o guard antes/depois da consulta. Exclui autor e memberships inativas, suspensas ou expiradas. Não confundir captura de candidatos com autorização de envio: o consumidor ainda deve verificar permissões de leitura e pertença atual.

A composição liga esta captura apenas quando a opção interna statusEmailIsolatedCapture é true; nenhum bootstrap a define. Continua desligada por defeito. Não existe flag HTTP/ambiental para ativar envios.

`node scripts/testStatusEmailTransaction.js` cria duas bases num container descartável, com porta aleatória ligada apenas a loopback e password efémera. Usa o repositório real da candidatura, captura real SQL, produtor e OutboxRepository reais, migrações tenant 021 (sem extensão de catálogo audit externo), 001 async e 034. Fixtures centrais usam nomes/colunas reais. Verifica commit, replay do recibo, rollback após outbox, indisponibilidade da autoridade e suspensão de membro.

Limites: guard/auditoria de domínio são doubles nesta prova; não substitui o gate completo de sessão/authority coordinator. O gate concede localmente SELECT/INSERT/UPDATE(logical_id) na outbox ao papel de teste. Não instala esses grants na APP. Antes de ativação real é obrigatório provisionar/admitir a consulta central no protocolo fechado e os grants mínimos da outbox no pacote de segurança; não ampliar o pool/role para contornar essa admissão. Não foi criado consumidor nem efetuado qualquer envio.

## Admissão e privilégios — prova restrita

A consulta de captura está registada no allowlist JavaScript do protocolo. O candidato central `application_status_capture.up.sql` acrescenta o CASE correspondente, verificando owner, SECURITY DEFINER, search_path e ponto de patch. `securityPackage.js` fixa checksums dos candidatos; não os adiciona aos installers gerais nem altera fingerprints de produção.

A composição isolada usa coordinator.withAuthority e o pool do coordinator para esta observação. A consulta rejeita listas superiores a 1000 candidatos também em SQL. O gate instala a definição executável real de authority_api.execute da migração 025 sobre fixtures mínimas e aplica o candidato; liga como c4g_authority_runtime e seleciona c4g_authority_coordinator. Não é uma instalação integral de todas as migrações centrais nem prova do fingerprint final da versão atualmente instalada.

A outbox passa por StatusOutbox e pela função enqueue_status_delivery. O runtime só recebe EXECUTE; não recebe SELECT/INSERT/UPDATE/DELETE na tabela async_exec.outbox. A função tem search_path fixo, execução PUBLIC revogada, limita o job/ator/payload a uma entrega pendente da organização corrente e não permite alterar jobs existentes. Owner não-login recebe INSERT na outbox; a função não faz UPDATE nem DELETE. Repetição idempotente continua a ser resolvida pelo recibo da candidatura.

Esta prova substitui os grants amplos e a consulta central direta da fixture anterior. Foram comprovadas recusas de leitura central direta, SQL não admitido, leitura/update/delete diretos da outbox e enqueue cruzado. O teste mantém guard/audit doubles; a integração final do pacote no manifesto/fingerprint de segurança deve ocorrer num rollout próprio, antes de qualquer ativação. Emails continuam desativados.

## Consumidor exclusivamente simulado

`createSimulatedConsumer` devolve handler e registry isolados para application.status.notify v1. Só aceita transporte criado como simulado pelo módulo (marca interna WeakSet), organização fixa e ports explícitos. Não é registado no productionRegistry, worker global ou bootstrap; emails reais permanecem desativados.

Antes de cada tentativa resolve novamente as memberships congeladas e os direitos de leitura da candidatura, oportunidade e avaliação, incluindo pertença atual à equipa. `createRecipientAuthority` passa a identidade do destinatário ao port authorize; não usa autor nem service actor como autoridade de leitura. ALLOW/DENY são resultados explícitos; falha/resultado desconhecido adia. O port de autorização deve aplicar o motor real e os âmbitos de unidade/recurso na futura composição produtiva.

Reserva é confirmada numa transação curta. Nova verificação ocorre antes da chamada simulada; nenhum transporte opera dentro da transação SQL. Simulação usa tabela separada application_status_simulation, identificada como tal, sem alterar registos de entregas reais. Guarda mensagem/chave estáveis, lease e fence; resultado incerto não é apagado por revogação ou alteração de endereço. Depois de 24h ou alteração de pedido fica para reconciliação. A ordem por candidatura/membership e deduplicação por destino/evento são verificadas na reserva. Conteúdo permanece só na base isolada; não vai para logs ou envelopes.

O gate descartável inclui SQL real para identidade/equipa, mas os direitos funcionais são fornecidos por port de teste explícito. Ledger de simulação é operado pelo owner num contexto tenant, não por um novo worker produtivo. Portanto não demonstra ainda a composição completa do motor de autorização com o papel worker restrito. Reutiliza a instância do fornecedor simulado ao reconstruir consumidor; perda da memória desse fornecedor não representa garantia de idempotência real.

Próxima etapa: ligar os ports de identidade/autorização ao motor real no contexto do destinatário e validar o consumidor sob o papel restrito de worker, ainda sem transporte real. Antes de envio real continuam pendentes a admissão de pacote/fingerprints, retenção de dados pessoais, configuração Resend e navegação autenticada com organização.

## Motor real e papel worker restrito

`policyAuthority.js` usa createPolicyEngine com os catálogos reais da APP. Recarrega membership/snapshot em cada decisão, fixa a identidade do destinatário, filtra bindings explícitos de recurso/tipo e só admite as três operações de leitura necessárias. Não fabrica MFA nem reutiliza a autoridade do autor. Os ports load/resource continuam a ser interfaces internas: a fixture PostgreSQL fornece snapshots representativos e os recursos de teste; ligação produtiva às fontes coordenadas depende do rollout posterior.

Novo candidato simulation_worker: papel NOLOGIN/NOINHERIT, SELECT em evento/entrega/ledger, INSERT no ledger e UPDATE apenas de state/reason/lease_until/fence. Sem acesso à outbox ou escrita nas candidaturas; mensagem reservada não é atualizável. RLS continua a limitar a organização. Gate liga com login restrito próprio e este papel, substituindo o owner na execução do store. A identificação/equipa e os snapshots de autorização da fixture ainda são carregados pelos ports de preparação do teste; não se declara que todo o backend de autoridade execute com o papel SQL tenant.

Provas adicionais: grants reais exigidos, bindings de recurso, revogação sem cache, versão/validade/identidade divergente, operações fora de leitura recusadas; worker sem SELECT da outbox, DELETE do ledger, alteração da mensagem ou candidatura e sem leitura cruzada. Motor real aprovado, com transporte exclusivamente simulado.

## Reinício do processo OS

O gate chama statusEmailProcessProbe, que inicia hosts isolados statusEmailWorkerChild via fork/IPC, termina-os com SIGKILL e aguarda saída. Worker filho usa login restrito, ledger real e consumer real. Autoridade é resolvida por IPC no pai com motor real sobre fixtures; tempo controlado. Prova crash após reserva, lease ocupada, revogação, recuperação e supressão após resultado ACCEPTED persistido. Estado do transporte simulado é recriado em cada filho: por isso não se afirma coberta a janela após aceitação e antes da persistência local. Nenhum worker global ou transporte real é ativado.

## Janela aceitação/commit local

Gate ampliado em 2026-11-03: createIpcSimulationTransport só funciona num filho IPC explicitamente isolado. O pai mantém createTransport simulado e a sua memória idempotente entre reinícios de worker. Checkpoint após aceitação, antes de finish, permite SIGKILL com ledger RESERVED. Recuperação confirma mesma chave/conteúdo, duas chamadas e uma aceitação; terceiro processo não envia depois de ACCEPTED persistido. Prova não cobre reinício/perda do pai-fornecedor nem equivale a validação Resend. Emails reais continuam desativados.
