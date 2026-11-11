# Prontidão — emails internos de mudança de estado

Data: 2026-11-03. Aplicação: GCNI_C4G. Estado: **validado em simulação isolada; não pronto para ativação real**.
Este documento consolida o estado atual e prevalece sobre indicações históricas de etapas «a preparar» na especificação. Não autoriza migrações na APP, configuração de fornecedor, deploy ou envios.

## Decisão atual

Manter os emails reais desativados. Há implementação reutilizável e provas robustas de domínio, persistência, recuperação e navegação. Ainda falta integrar e validar a composição produtiva completa. Não confundir aprovação dos gates com prontidão de produção ou garantia de entrega exatamente uma vez.

Âmbito confirmado: responsável e equipa interna elegíveis. Autor excluído, contactos/parceiros externos fora do âmbito. Administradores clientes e superadmin C4G não recebem por privilégio. Estados, transições, alertas internos e links oficiais existentes permanecem preservados.

## O que está implementado e o que a prova cobre

| Componente | Situação atual | Limite relevante |
| --- | --- | --- |
| Evento e produtor | Hook na transação da candidatura, antes do recibo; evento/revisão e entregas por membership; rollback e replay testados. | Produtor não ligado no bootstrap normal; guard do comando e auditoria usam ports de fixture no gate. |
| Captura central | Consulta fechada admitida por hash; candidatos ativos congelados; identidade/endereço obtidos no servidor. | Candidato SQL e executor real testados sobre fixture, não sobre instalação integral da versão produtiva. |
| Persistência/outbox | Migração 034 e função limitada de enqueue; runtime sem DML direto na outbox; RLS e contexto testados. | Manifestos gerais, fingerprints e compatibilidades do deployment ainda não admitem o pacote completo. |
| Seleção/autoridade | Motor real, catálogos reais, identidade do destinatário, leituras de candidatura/oportunidade/avaliação e revalidação por tentativa. | Ports de identidade/snapshot/recurso usam dados de teste; não são toda a composição coordenada e auditada produtiva. |
| Consumidor | Handler/registry isolado, recusa de transporte não simulado, reserva e resultado em transações separadas. | Não registado no worker global; pipeline de dispatcher/inbox/lifecycle completo não foi ativado para este job. |
| Worker SQL | Papel restrito sem acesso à outbox ou escrita na candidatura; grants mínimos no ledger. | Papel e tabela são explicitamente de simulação, não infraestrutura de entrega real. |
| Recuperação | Concorrência, leases, fence, resposta perdida e SIGKILL/reinício comprovados. | Tempo controlado; fornecedor simulado sobrevive no pai. Não simula perda simultânea de todos os serviços nem certifica fornecedor externo. |
| Template | HTML/texto, escaping, dados históricos, origem pública configurada, sem notas/documentos/CC. | Não testado em clientes reais de email ou com domínio/remetente real. |
| Link autenticado | Rota da APP exige confirmação organizacional e bloqueia detalhe até contexto correspondente. | Login/HTTP nos gates são controlados; não há prova OIDC produtiva de ponta a ponta. |
| Percurso nos perfis | ORG_ADMIN e CONTRIBUTOR recebem/abrem com grants explícitos; revogação recusa leitura. | Perfis testados como destinatários/leitores; não prova que membro possa executar a transição. |

## Evidência consolidada

- [Percurso integrado nos dois perfis](../reviews/application-status-emails-journey.md): PostgreSQL descartável, mensagem persistida, Chrome, confirmação organizacional e revogação. 56 testes backend e 32 frontend focados aprovados.
- [Janela aceitação/commit](../reviews/application-status-emails-acceptance.md): chave/conteúdo idênticos; duas chamadas ao fornecedor simulado e uma aceitação após reinício. Última suite backend completa nesta sequência: 2650 aprovados, 7 ignorados, zero falhas (2657 total).
- [Link autenticado](../reviews/application-status-emails-link.md): última suite frontend completa, 715 aprovados em 83 ficheiros; build aprovado. Não corresponde a nova execução nesta consolidação.
- [Worker e motor real](../reviews/application-status-emails-worker.md), [protocolo/outbox](../reviews/application-status-emails-security.md), [processos](../reviews/application-status-emails-process.md) e [concorrência](../reviews/application-status-emails-recovery.md) detalham os limites das provas.
- Código de execução: `backend/src/applications/statusEmails/`; UI: `frontend/src/pages/Applications/ApplicationLinkGate.jsx`; gates: `backend/scripts/testStatusEmailTransaction.js`, `statusEmailProcessProbe.js` e `statusEmailBrowserProbe.js`.

Os 7 testes ignorados da suite geral não são prova de aprovação desses casos. Antes do rollout, identificar a sua aplicabilidade no relatório da versão final. Números acima são resultados já registados, não testes repetidos nesta tarefa documental.

## Pendências obrigatórias antes de envio real

| Ordem | Trabalho a concluir | Critério objetivo para fechar |
| --- | --- | --- |
| 1 | Composição produtiva de autoridade e recursos | Ports carregam identidade/membership/grants/recursos pelas fontes coordenadas reais; testes cobrem unidades, equipa, grants por recurso, revogação, versões, indisponibilidade e ausência de MFA fabricado. Sem consultas privilegiadas de fixture. |
| 2 | Pacote de esquema e segurança | Registrar a sequência central/tenant no mecanismo de migrações, validar predecessor, checksums, fingerprints, roles/ACLs e compatibilidade do runtime. Prova sobre clone isolado representativo da instalação alvo, sem sobrepor migrações existentes. |
| 3 | Persistência de entregas reais | Definir ledger/attempts produtivos e grants próprios; não reutilizar ACCEPTED da tabela de simulação como evidência real. Preservar pedido/chave, estados incertos, dedupe, leases/fences e ordem por revisão. |
| 4 | Runtime completo do job | Ligar produtor por organização apenas após readiness; registar job/ator/operação no worker real, dispatcher, inbox, retry/dead-letter/replay e shutdown. Provar execução sob roles reais sem permissões globais adicionais. |
| 5 | Retenção e operação | Definir prazo e limpeza de endereço/conteúdo, retenção da prova idempotente, logs sem PII e procedimento de reconciliação de UNKNOWN, alteração de endereço e expiração da janela do fornecedor. Não requer painel novo. |
| 6 | Adaptador real | Implementar o fornecedor aprovado com semântica de aceitação/erro/incerteza e idempotência verificada à data; configuração ausente falha fechada. Domínio, remetente, segredos e destinatários controlados só numa etapa autorizada. |
| 7 | Percurso real em teste | HTTP e OIDC reais, transição com guard/auditoria reais, organização correta/errada, sessão expirada/outro utilizador e admin/membro. Integrar o fornecedor apenas depois das provas anteriores, inicialmente com destinos de teste. |
| 8 | Rollout reversível e autorização | Readiness de todas as dependências, registo da versão/evidências, âmbito de organizações e autorização explícita para ativar. Não fazer backfill automático de estados antigos. |

A ponte IPC e os helpers de processo são ferramentas de prova; não devem transformar-se em transporte produtivo. O identificador da organização no link nunca concede autorização.

## Sequência de ativação futura proposta

1. Preparar composição e pacote integrado em ambiente isolado, ainda com transporte simulado e sem tocar nas bases da APP.
2. Executar gates completos de segurança/runtime/navegação; resolver todas as pendências aplicáveis da tabela.
3. Após pedido específico, configurar fornecedor em ambiente de teste e destinatários controlados. Aceite pelo fornecedor não significa entregue na caixa de correio.
4. Apresentar evidência concreta e âmbito do rollout antes de ligar os envios reais.

Se houver falha após ativação futura: desligar novas produções, parar/drenar worker de forma controlada e preservar eventos, recibos, mensagens reservadas e resultados incertos. Não apagar tabelas, trocar chaves ou reenviar automaticamente para «resolver» uma incerteza. Definir a retoma dentro da política de replay validada.

## Confirmação de que permanece desligado

Verificado no código em 2026-11-03:
- `productionRegistry` continua vazio; não há consumidor de email ativo no worker global.
- `statusEmailProducer` é nulo e `statusEmailIsolatedCapture` é falso por defeito; nenhum bootstrap observado os ativa.
- O transporte normal começa em disabled e recusa modo real. O consumidor aceita apenas transporte simulado.
- Pacotes SQL adicionais mantêm-se candidatos/manifestos locais, sem rollout nas bases da APP.
- A navegação do link está integrada na UI; isso não ativa o envio.

Esta consolidação só altera documentação. Não lê segredos, aplica SQL, envia mensagens ou altera configuração.

## Próximo passo

Preparar a composição produtiva de autoridade e o pacote integrado de esquema/runtime para validação isolada, mantendo o transporte simulado. Se esta componente ficar em espera até ao deployment final, este documento é o ponto de retoma; não há necessidade de repetir as provas já concluídas sem mudanças relevantes.
