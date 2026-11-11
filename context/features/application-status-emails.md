# Emails internos de mudança de estado da candidatura
State: Review
Data: 2026-11-02
Âmbito atual: implementação e validação isoladas autorizadas e realizadas; envio real e rollout não autorizados.
Aplicação de destino: GCNI_C4G. GCNI_UBI é apenas referência.

Estado consolidado: [prontidão e pendências de ativação](application-status-emails-readiness.md), 2026-11-03. As secções datadas seguintes preservam o histórico das etapas.

## Objetivo e origem
Recuperar o aviso por email existente na UBI, começando pelo responsável e equipa interna. Adaptar a seleção de destinatários ao isolamento organizacional e às permissões C4G. Não alterar estados, transições ou notificações internas existentes.

Evidência:
- UBI: ../GCNI_UBI/GCNI_C4G-main/backend/src/controllers/applicationController.js, emailApplicationStatusChanged e updateApplicationStatus; template em services/emailTemplates.js. Inclui coordenador/equipa e contactos externos, deduplica email e incorpora notas. O SMTP pode ocorrer antes do COMMIT.
- C4G: backend/src/applications/repository.js emite notify na transição; alerts.js seleciona responsável/participantes ativos, e composition.js revalida memberships e exclui o autor.
- Infraestrutura reutilizável: backend/src/async/outboxRepository.js, outboxRelay.js e worker existentes. Envelope fechado em async/envelope.js não admite emails, nomes ou documentos: transportar apenas referências opacas validadas, nunca afrouxar esse contrato.
- Resend consta de context/decisions/hosting-and-external-services.md. O adaptador/consumer específico de email não está implementado neste percurso. Reutilização não significa ativação imediata.

## Gatilho e limites
1. Uma transição efetivamente confirmada gera um evento interno de email na mesma transação da alteração. Rollback não deixa entrega elegível.
2. Abrange as transições já autorizadas na C4G, incluindo correções para fases anteriores e Arquivada. Não gera email por abertura de diálogo, cancelamento, edição de campos, repetição idempotente ou criação inicial da candidatura.
3. A seleção não é feita no browser. Não aceitar destinatários, organização de destino, template ou URLs arbitrárias enviados pelo cliente.
4. A falha do fornecedor não desfaz nem bloqueia a transição já confirmada. A falha ao persistir o evento transacional, quando a funcionalidade está ativa, deve falhar a transação de forma controlada; não perder silenciosamente avisos.
5. Sem recuperação retroativa de transições anteriores à ativação. Alertas dentro da aplicação mantêm o comportamento atual.

## Destinatários
| Caso | Regra |
|---|---|
| Responsável da candidatura | Candidato a destinatário se tiver membership ativa na organização no momento do evento. |
| Participantes da equipa | Apenas participações ativas e memberships válidas nessa organização no momento do evento. |
| Autor da transição | Excluído pelo utilizador global; excluir também o seu endereço normalizado se reaparecer por outra associação. |
| Responsável que também participa | Um destinatário lógico, sem duplicação. |
| Administrador da empresa cliente | Não recebe por ser administrador; recebe se for responsável ou participante elegível. |
| Super admin C4G/suporte | Não recebe por privilégio global nem por acesso de suporte. |
| Parceiro externo/contacto da ficha | Excluído; necessita de decisão e especificação separadas. |
| Suspenso, removido ou sem acesso | Não enviar. |

Fixar os candidatos por identificador no evento, sem incluir membros que entrem depois. Antes de cada tentativa, verificar novamente organização/utilizador/membership ativos, ligação atual à candidatura (responsável ou participante) e permissões de leitura da candidatura e dependências exigidas pelo domínio, como oportunidade e avaliação quando aplicável. Não usar a autoridade do autor para provar a do destinatário.

Resolver email na identidade central autorizada, nunca no contacto de parceiro ou num parâmetro do cliente. Sem endereço utilizável, não enviar; registar motivo controlado. Se a resolução/autoridade estiver indisponível, adiar em vez de tratar como autorização ou ausência definitiva. Não acrescentar silenciosamente um novo requisito de verificação de email sem verificar o contrato da identidade existente.

Deduplicar destinatários lógicos e endereços normalizados no âmbito de organização + candidatura + revisão. Enviar mensagens individuais, sem CC/BCC partilhado nem exposição da lista. A normalização não pode transformar destinatários de outra organização em candidatos.

## Conteúdo
Assunto: «[Nome da organização] Candidatura atualizada — Estado novo».
Corpo em português:
- Nome da organização e título da candidatura;
- Estado anterior → estado novo, com rótulos da aplicação;
- Data/hora do evento, com timezone identificado;
- Botão «Abrir candidatura»;
- Indicação de que se trata de um registo interno e que o email não constitui submissão ao financiador.

Usar os dados históricos da transição confirmada, não o estado mais recente à hora do envio. Não incluir notas, motivo interno, contactos pessoais, documentos/anexos, orçamentos nem segredos. Reaproveitar a estrutura HTML/texto e o escaping da UBI, adaptados à marca C4G e à organização cliente; não copiar o cliente SMTP.

O link usa exclusivamente a origem pública configurada e a rota autenticada da candidatura. Deve identificar o contexto organizacional de forma suportada pela APP, sem conceder acesso ou mudar de organização silenciosamente. Se o utilizador estiver noutra organização, pedir seleção/reautenticação do contexto correto antes de mostrar dados. Não criar links públicos, tokens de acesso ou URLs diretas de documentos. Confirmar o contrato de navegação existente no plano técnico; qualquer nova experiência de seleção deve ser descrita antes da implementação.

## Persistência, entrega e recuperação
- Evento lógico: organização + candidatura + revisão de transição. Guardar referências aos candidatos e à evidência histórica, com política de acesso da organização; envelopes da fila contêm apenas referências compatíveis com o contrato existente.
- Entrega lógica: evento + destinatário; deduplicação adicional por endereço no evento. Persistir a decisão de envio e os resultados sem expor dados pessoais em logs, métricas ou chaves públicas.
- Worker processa apenas eventos confirmados. Aplicar as políticas existentes de autoridade, isolamento, execução, prazo, tentativas e replay; não conceder permissões globais para contornar recusas.
- Usar idempotência persistente e o mecanismo do fornecedor que vier a ser verificado no plano técnico. Não prometer entrega exatamente uma vez.
- Distinguir pendente, aceite pelo fornecedor, resultado incerto, recusado por elegibilidade e falha definitiva, mapeando-os aos estados existentes do worker sem os redefinir aqui.
- Timeout após possível aceitação não significa falha confirmada: reconciliar ou repetir com a mesma identidade idempotente dentro das garantias verificadas do fornecedor. Não criar um segundo evento para o mesmo envio.
- Aceitação pelo fornecedor não equivale a entrega na caixa de correio. Não mostrar «entregue» sem evidência própria.
- Processar eventos em ordem de revisão por candidatura/destinatário sempre que controlável; não prometer ordem de chegada das mensagens. Incluir data e estado histórico para distinguir avisos atrasados.
- Falhas definitivas/replay seguem a operação existente do worker; sem novo painel, preferências de notificações, newsletters ou editor de templates nesta fase.

## Ativação
Começar com transporte simulado e testes locais. Produção/envio real requer etapa separada: adaptador Resend, remetente/domínio verificados, credenciais fora do repositório, destinos de teste controlados e teste de ponta a ponta. Não ler credenciais nem enviar emails nesta fase. Configuração ausente não pode produzir falso sucesso.

## Critérios de aceitação
- CA01: transição confirmada cria exatamente um evento lógico; rollback/no-op/edição/repetição não geram novos eventos.
- CA02: responsável + equipa recebem segundo regras; autor, privilégio global e parceiros externos ficam excluídos; responsável-participante não duplica.
- CA03: duas organizações com utilizadores/email em comum continuam isoladas; tentativas de indicar destinatários externos são recusadas.
- CA04: revogação, remoção da equipa, suspensão e alteração de responsável entre evento e envio impedem envio ao antigo destinatário; novos membros não recebem histórico.
- CA05: indisponibilidade da autoridade adia; ausência de email é motivo registado; não há bypass de autorização.
- CA06: assunto/corpo usam snapshot histórico e escaping; nenhuma nota, motivo, anexo ou lista de destinatários é divulgada.
- CA07: retries, duplicação do job, crash antes/depois do envio e resposta perdida mantêm identidade idempotente e estado honesto, sem multiplicação de eventos.
- CA08: link exige autenticação e contexto certo; conta sem acesso não abre candidatura, mesmo tendo recebido mensagem anteriormente.
- CA09: integração mantém alertas internos, transições e permissões existentes; falha externa não altera o estado da candidatura.
- CA10: testes automatizados usam double; envio real permanece desligado até validação separada.

## Plano técnico a preparar — não aprovado para execução
1. Mapear evento de transição, seleção de candidatos e persistência isolada de entregas à infraestrutura existente; identificar migrações e compatibilidade com tenants antigos.
2. Definir contratos/versionamento do job e prova de autoridade no worker, sem emails ou conteúdo pessoal no envelope.
3. Confirmar navegação do email para organização/candidatura e adaptar o template existente.
4. Definir adaptador de transporte, idempotência, reconciliação de resultados incertos e semântica de entrega, verificando as garantias atuais do fornecedor apenas nessa etapa.
5. Detalhar testes CA01–CA10, ativação controlada e rollback operacional, sem duplicar envios nem perder eventos já confirmados.

## Decisão separada
Parceiros externos: destinatários, consentimento/preferências se aplicáveis, conteúdo permitido e acesso ao destino precisam de avaliação própria. Nada nesta especificação autoriza o envio a esses contactos.

## Estado da entrega
Especificação concluída. Não foi implementado código, criado esquema, configurado fornecedor ou enviado email. Ready significa pronta para planeamento técnico; não constitui autorização de implementação.

## Plano técnico preparado

O [plano de integração](application-status-emails-plan.md), de 2026-11-02, concretiza contratos, persistência, transporte simulado, navegação e testes. Substitui a indicação anterior de plano a preparar; não constitui implementação nem ativação.

## Implementação local — etapa 1 (2026-11-02)

Implementados contratos, seleção por autoridade injetada, template adaptado da UBI e simulação isolada em `backend/src/applications/statusEmails`. 29 testes focados aprovados; sintaxe validada. Suite geral registou oito falhas em testes HTTP de outras áreas e foi interrompida sem resumo após ausência de progresso: não validada integralmente, causas por diagnosticar. Sem alteração de frontend, SQL, produtor ou worker; funcionalidade desativada e nenhum email real. A captura persistente de candidatos, autoridade central real, recuperação durável e guarda de organização continuam pendentes das etapas seguintes.

## Revalidação HTTP — 2026-11-02

Diagnóstico posterior substitui a limitação de validação acima: oito falhas causadas por bloqueio EACCES de HTTP loopback no ambiente restrito. Execução permitida: 47 testes focados aprovados e suite backend com 2623 aprovados, 7 ignorados, zero falhas. Sem correções de código necessárias. Ver [diagnóstico](../reviews/application-status-emails-http-diagnosis.md). Emails continuam desativados; persistência e produtor não integrados.

## Persistência e produtor isolado — 2026-11-02

Adicionada migração 034 com manifesto/checksum, evento ligado à revisão histórica, entregas por membership e RLS. Produtor usa mesmo cliente transacional e outbox existente com referências apenas. Hook no repositório antes do recibo; composição aceita injeção server-side, sem ativação no bootstrap. Sem grants de processamento para futuro consumidor.

Cinco testes novos aprovados; suite backend: 2628 aprovados, 7 ignorados, zero falhas. Gate PostgreSQL descartável aprovou migração, unicidade, isolamento de leitura, papel runtime e rollback sobre fixture mínima. Nenhuma migração na APP ou envio real. A prova integrada da autoridade central, snapshot dos candidatos e transação completa com outbox permanece pendente; não confundir teste do port controlado com essa prova.

Próximo passo: captura central real e validação integrada isolada, mantendo emails desligados.

## Captura central ligada e transação validada

Captura implementada, disponível apenas na composição isolada. PostgreSQL descartável confirmou commit, replay idempotente e rollback integrado com outbox real. 37 testes focados aprovados; suite backend 2631 aprovados, 7 ignorados, zero falhas. Consulta central ainda requer admissão no protocolo fechado e grants da outbox antes de ativação; fixture não substitui esse gate. Ver [evidência](../reviews/application-status-emails-capture.md). Emails desativados.

## Protocolo e outbox restritos — 2026-11-02

Consulta admitida por hash no protocolo; candidato central e função tenant de enqueue com checksums. Runtime recebe EXECUTE apenas, não DML direto na outbox. Gate com papéis restritos passou casos positivos e recusas de SQL/acesso direto/contexto cruzado. 2633 testes backend aprovados, 7 ignorados, zero falhas. Emails desativados. O pacote permanece candidato sem alteração de fingerprints/installers de produção. Ver [relatório](../reviews/application-status-emails-security.md).

## Consumidor simulado — 2026-11-02

Handler/registry isolado e ledger de simulação implementados. Revalidação antes de cada tentativa e após reserva; falhas de autoridade adiam, revogação bloqueia e incerteza preserva recuperação. Testes: 52 focados, suite backend 2646 aprovados/7 ignorados/zero falhas; gate PostgreSQL aprovado. Port de direitos ainda é controlado no teste e store usa owner apenas na fixture; composição real de autoridade/papel worker é a etapa seguinte. Emails reais continuam desligados. [Relatório](../reviews/application-status-emails-consumer.md).

## Motor real e worker restrito — 2026-11-02

PolicyEngine real ligado à identidade do destinatário; papel de simulação com grants mínimos e RLS validado em PostgreSQL descartável. 55 focados e suite backend com 2649 aprovados, 7 ignorados, zero falhas. Fontes de autoridade são fixtures; sem rollout nem emails reais. [Relatório](../reviews/application-status-emails-worker.md).

## Concorrência e recuperação — 2026-11-02

Duas conexões worker restritas provaram reserva única, bloqueio antes da expiração, takeover com novo fence e recusa de atualizações antigas. Reconstrução de conexão/store/consumer recupera persistência sem duplicar aceitação simulada. Gate aprovado; 2649 testes backend aprovados, 7 ignorados, zero falhas. Sem kill de processo SO nesta prova. [Relatório](../reviews/application-status-emails-recovery.md). Emails reais desligados.

## Processo worker — 2026-11-02

Host isolado do consumer executado em processos OS separados, SIGKILL e reinício validados sobre PostgreSQL persistente. Reserva interrompida recuperada, lease e revogação respeitadas, ACCEPTED persistido não reenviado. Gate repetido e suite backend aprovados (2649 pass, 7 skip, zero falhas). Janela entre aceitação e persistência continua pendente; sem ativação do worker global ou emails reais. [Relatório](../reviews/application-status-emails-process.md).

## Aceitação antes do commit local — 2026-11-03

Fornecedor simulado independente do filho conserva estado após SIGKILL entre aceitação e finish. Gate confirma RESERVED antes/depois da interrupção, mesma chave/pedido no reinício, 2 chamadas/1 aceitação e ACCEPTED persistido sem nova chamada no terceiro processo. 56 focados aprovados; backend 2650 aprovados, 7 ignorados, zero falhas. Sem emails reais ou deploy. [Relatório](../reviews/application-status-emails-acceptance.md).

## Link autenticado integrado — 2026-11-03

Gate na rota /candidaturas/:id valida organizacao e exige seleção explícita quando difere da sessão. Detalhe privado só monta no contexto confirmado; erros e indisponibilidade não revelam título. Retorno OIDC relativo preservado. Frontend 715 testes aprovados, build aprovado; backend contratos/template 29 aprovados. Sem envio ou OIDC real. [Relatório](../reviews/application-status-emails-link.md).

## Percurso integrado nos dois perfis — 2026-11-03

Gate PostgreSQL e Chrome passou com ORG_ADMIN e CONTRIBUTOR como destinatários/leitores: mensagem persistida fornece link, organização exige confirmação, detalhe usa dados da fixture e motor real; grants revogados recusam leitura. HTTP/sessão interceptados, não OIDC/servidor produtivo. Fixture ORG_MEMBER corrigida para CONTRIBUTOR. 56 backend e 32 frontend focados aprovados. Emails reais desligados. [Relatório](../reviews/application-status-emails-journey.md).
