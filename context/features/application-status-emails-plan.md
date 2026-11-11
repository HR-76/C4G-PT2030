# Plano técnico — emails internos de mudança de estado

Data: 2026-11-02. Estado: plano preparado; implementação não iniciada.
Aplicação de destino: GCNI_C4G. Referência funcional: [especificação](application-status-emails.md).

## Âmbito e origem

Recuperar o aviso de mudança de estado da UBI para o responsável e a equipa interna. Preservar estados, permissões, confirmação de transições e alertas internos atuais. Parceiros externos ficam excluídos para decisão separada. Não criar preferências, painel de envios ou editor de templates.

Da UBI aproveitam-se a intenção funcional, a composição HTML/texto e o escaping do template. Não copiar o envio antes do COMMIT, os destinatários externos, a inclusão de notas ou o SMTP próprio. São adaptações novas necessárias à arquitetura C4G: persistência de entrega e resultado incerto, autoridade por organização, idempotência do fornecedor e confirmação explícita do contexto no link. Não são funcionalidades comprovadamente existentes na UBI.

## Evidência e pontos de integração

| Código existente | Utilização / diferença a resolver |
| --- | --- |
| `backend/src/applications/repository.js` | Gravar evento na transação da mudança efetiva, junto do histórico/auditoria, antes de finalizar o recibo idempotente. Repetição do recibo não recria evento. |
| `backend/src/applications/alerts.js` e `composition.js` | Reutilizar seleção de responsável/equipa e verificações de leitura. A seleção atual para alertas não constitui, por si, contrato de resolução de endereço e autorização de email. |
| `backend/src/async/outboxRepository.js`, `envelope.js` | Reutilizar outbox transacional e envelope fechado; payload só com identificador opaco. Não transportar endereços, títulos ou corpos. |
| `backend/src/async/workerProcessor.js`, `authorization.js`, `serviceActorRegistry.js` | Reutilizar inbox, fencing, retries e autoridade; criar composição específica, limitada à organização e operação. |
| `backend/src/async/productionRegistry.js` e `backend/src/worker.js` | O registry geral está vazio; não existe consumidor de email pronto. Registar explicitamente o job e o runner, sem substituir os runtimes existentes. |
| `backend/src/config/documentWorkerFactory.js` | Referência para construção, readiness, limpeza de recursos e shutdown do runtime dedicado. |
| `backend/test/support/doubles.js` | Reaproveitar o double Resend como base do transporte simulado determinístico. |
| `frontend/src/pages/Applications/navigation.js` e AuthContext | A rota da candidatura não identifica a organização. `selectOrganization` existe; a confirmação de contexto para este link precisa de integração explícita. |
| `backend/src/opportunities/migrationManifest.js` | Referência de manifestos/checksums, não local automático para alojar as novas migrações de candidaturas. |

Referência UBI: `../GCNI_UBI/GCNI_C4G-main/backend/src/controllers/applicationController.js`, `services/emailService.js` e `services/emailTemplates.js`. Todas as futuras alterações serão na GCNI_C4G.

## Contratos propostos

Os nomes seguintes são propostas de interfaces internas, não APIs já existentes.

1. **EventRecorder.record(client, transition)**: recebe contexto autorizado, organização, candidatura, revisão, estados anterior/novo, autor e instante confirmados pelo servidor. Guarda snapshot mínimo e candidatos por membership; usa o mesmo cliente/transação da mudança e da outbox. Nunca aceita destinatários ou conteúdo do pedido HTTP. Feature ativa e falha de persistência implicam rollback controlado; feature desativada mantém o comportamento atual.
2. **RecipientAuthority.resolve(event, candidate)**: devolve `ELIGIBLE`, `INELIGIBLE`, `NO_ADDRESS` ou `UNAVAILABLE`. Resolve identidade/endereço central e verifica organização, utilizador e membership ativos, validade temporal, pertença atual como responsável/participante e permissões de leitura da candidatura/oportunidade/qualificação aplicáveis. Não usa as permissões do autor como substituto. `UNAVAILABLE` adia; não transforma falhas de autoridade em ausência definitiva de destinatário.
3. **DeliveryRepository**: operações transacionais de reserva, comparação de versão/fence, deduplicação por endereço no evento, finalização e recuperação. Retorna decisões tipadas; atualizações de workers antigos não podem finalizar uma reserva nova.
4. **Template.render(snapshot, trustedLink)**: assunto, HTML e texto em português; versão explícita e determinística. Apenas organização, título, estados, data/fuso e aviso de que a mudança é um registo interno. Escapar dados; excluir notas, motivos, documentos e listas de pessoas.
5. **Transport.send(message, idempotencyKey, signal)**: retorna `ACCEPTED(providerId)`, `RETRYABLE_NOT_ACCEPTED`, `PERMANENT_REJECTED` ou `UNKNOWN`. Exceção/timeout após possível envio é `UNKNOWN`, não uma recusa comprovada. Não inventar consulta por chave no fornecedor: reconciliação por identificador só quando disponível; de outro modo repetir pedido idêntico dentro da janela garantida ou suspender para análise.

Job proposto: `application.status.notify`, versões job/payload 1, payload `{ deliveryId }`. O handler valida exatamente a versão suportada mesmo que o registry genérico admita versão anterior. Ator de serviço e operação restritos à organização na composição; nenhuma autorização global implícita. Serviço executa o aviso de uma transição já autorizada, mas revalida individualmente os destinatários. Saída do autor da organização não é, isoladamente, autorização nem veto ao envio.

Não alterar o contrato HTTP de mudança de estado nem criar endpoint público de envio. O resultado HTTP continua a representar a transição persistida, nunca a entrega do email.

## Persistência proposta

Adicionar migração incremental no esquema tenant, com manifesto/checksum e numeração determinados no momento de implementação. Não aplicar SQL nesta fase. Não prever novas tabelas centrais sem necessidade demonstrada pelo contrato de identidade/ativação.

| Registo lógico | Conteúdo e invariantes |
| --- | --- |
| Evento | ID, organização, candidatura, revisão de transição, estados, instante, autor, snapshot mínimo e versão de template. UNIQUE organização+candidatura+revisão. Referência ao histórico existente. |
| Candidato/entrega | Evento, membership e identidade, estado, motivo codificado, versão/fence, tentativas e datas. UNIQUE evento+membership. Candidatos fixados na transição; novos membros não recebem eventos anteriores. |
| Destino reservado | Endereço normalizado, conteúdo imutável do pedido na primeira tentativa e chave idempotente estável. Exclusividade por evento+endereço, com proteção de acesso equivalente aos dados tenant. Várias memberships elegíveis com o mesmo endereço convergem numa entrega. |
| Tentativa | Entrega, número, início/fim, resultado, ID do fornecedor quando conhecido e códigos controlados. Sem resposta bruta, tokens ou corpo em logs. |

Chaves estrangeiras/uniqueness incluem contexto organizacional onde aplicável; SQL deve testar acessos cruzados e papéis reais. Endereços e conteúdo ficam exclusivamente na persistência protegida necessária ao envio, nunca no envelope, métricas ou chaves expostas. Se for utilizado fingerprint para endereço, usar HMAC com segredo gerido fora da base; um hash simples não anonimiza emails. A implementação deve definir retenção mínima do destino/conteúdo separada da prova de deduplicação. Não eliminar essa prova enquanto o evento puder ser reexecutado; após purga de conteúdo, bloquear replay que exigiria reconstruir um pedido diferente.

Estados de domínio propostos: `PENDING`, `RESERVED`, `ACCEPTED`, `UNKNOWN`, `SKIPPED`, `FAILED`. Aceite não significa entregue. A decisão de skip inclui motivo, por exemplo acesso revogado, saída da equipa, autor, endereço ausente ou destino já coberto. Desconhecido após tentativa nunca se converte em “não enviado” por expiração de lease.

## Percurso e recuperação

1. A transição grava histórico, alertas existentes, evento, candidatos e outbox na mesma transação. Falha/rollback não deixa trabalho enviável. Congelar candidatos exige evidência válida de identidade; indisponibilidade não permite capturar posteriormente uma equipa diferente.
2. O worker recebe apenas a referência e carrega dados do tenant correto. Revalida autoridade antes de cada tentativa, exclui autor por identidade e endereço normalizado, elimina duplicados e verifica ordem por revisão para candidatura/destinatário.
3. Uma transação curta reserva a entrega/destino e fixa o pedido. Commit antes da chamada externa. O HTTP do fornecedor não fica dentro de transação SQL. Confirmar fence imediatamente antes da chamada; gravar resultado numa segunda transação condicional. Fencing não desfaz uma chamada externa já iniciada: a idempotência do transporte cobre essa janela.
4. Crash antes da chamada pode deixar reserva incerta; crash após aceitação pode perder resposta. Recuperar com a mesma identidade e pedido, nunca gerar nova entrega para contornar conflito. Se endereço ou autoridade mudou após a tentativa, parar novas chamadas e preservar a incerteza para reconciliação; não reenviar para um endereço novo silenciosamente.
5. Mapear decisão terminal persistida para `SUCCESS` do job (processamento concluído, não email entregue); falha transitória elegível para `RETRYABLE`; incompatibilidade/autoridade de execução/rejeição definitiva usam os resultados apropriados do worker. Persistir o resultado de domínio antes de confirmar a fila.
6. O prazo atual do envelope é até cinco minutos. Não o aumentar globalmente. Esgotamento vai para operação/dead-letter existente, mantendo evento/entrega recuperáveis. Replay deve criar apenas execução autorizada segundo os contratos existentes e preservar a chave lógica de entrega. O defer existente tem provas específicas de fonte; não presumir que já resolve adiamento de emails.
7. Uma revisão posterior aguarda uma anterior ainda processável para o mesmo destinatário. Falha terminal encerra o bloqueio; resultado incerto exige reconciliação antes de avançar. Não prometer ordem de chegada no correio.

Resend conserva chaves idempotentes por 24 horas. Repetições nesse intervalo devem manter chave e pedido idênticos. Após a janela, uma entrega incerta fica suspensa para reconciliação: não repetir automaticamente nem trocar de chave. Isto não fornece garantia de “exatamente uma vez”. Fonte oficial consultada em 2026-11-02: [Idempotency Keys](https://resend.com/docs/dashboard/emails/idempotency-keys).

## Navegação do email

Proposta mínima: rota autenticada `/candidaturas/:id?organizacao=<id>`, construída apenas com origem pública configurada e identificadores validados. O parâmetro é contexto, nunca autorização.

Antes de qualquer carregamento privado, comparar a organização da sessão. Se coincidir, usar o percurso atual. Se diferir, apresentar confirmação explícita apenas para organização disponível ao utilizador, chamar a seleção existente e carregar após confirmação do servidor. Se indisponível, resposta genérica sem título/dados da candidatura. Sem sessão, conservar apenas destino relativo validado no percurso de autenticação existente. Não redesenhar o login nem mudar de organização silenciosamente.

A confirmação de contexto é uma adaptação nova, descrita antes da implementação. Testar rejeição de origem externa, IDs inválidos, acesso revogado e mudança de utilizador durante autenticação.

## Transporte simulado e configuração

Modos propostos: `disabled` por defeito, `simulated` exclusivamente em ambiente isolado, `real` reservado para etapa posterior. Configuração inconsistente falha na inicialização; nunca trocar automaticamente real por simulado.

O double deve simular aceitação, recusa, falha transitória, timeout antes/depois de aceitação, resposta perdida, duplicação, conflito de pedido/chave, expiração da janela e cancelamento. Relógio e IDs controláveis; contagem de aceitações separada da contagem de chamadas. Captura de mensagens apenas em memória/dados de teste, sem rede, credenciais, SMTP ou emails reais. A evidência deve identificar claramente simulação; nunca marcar produção como aceite pelo Resend com o double.

## Sequência de implementação futura

| Etapa | Entrega | Condição de conclusão |
| --- | --- | --- |
| 1 — contratos e simulação | Módulo isolado de política/template/transporte e testes unitários; reutilizar double existente. | CA02/03/05/06 e cenários de transporte demonstrados sem ativar produtor. |
| 2 — persistência e produtor | Migração aditiva, repositório, integração transacional na candidatura, feature desativada por defeito. | Rollback, unicidade, recibos idempotentes e permissões SQL validados em base isolada autorizada. |
| 3 — consumidor | Registry, autoridade de serviço, runtime, reservas/fencing e recuperação. | CA01–07/09/10 com integração simulada; nenhum efeito real. |
| 4 — link e percurso completo | Guarda de organização e confirmação mínima; validação nos perfis administrador e membro. | CA08, isolamento e regressões de transições/alertas aprovados. |
| 5 — ativação real separada | Adaptador Resend, domínio/remetente e segredos geridos, destinos controlados. | Pedido específico de ativação e teste real; fora da execução agora solicitada. |

Não criar antecipadamente migrations executadas, serviços ou configuração real. Para rollback futuro: desligar produtor, parar/drenar consumidor de forma controlada e conservar eventos/entregas. Reverter código não deve apagar histórico nem permitir reenvios; confirmar compatibilidade antes de reativar.

## Matriz de testes prevista

| Critérios | Prova necessária |
| --- | --- |
| CA01 | Commit/rollback, no-op, edição, cancelamento do diálogo, repetição HTTP, concorrência na mesma revisão e falha de outbox. |
| CA02–03 | Responsável também participante, autor por ID/email, mesmo email em duas pessoas, admin sem pertença, superadmin, parceiro externo, dois tenants com IDs/destinos em comum. |
| CA04–05 | Revogar membership/leitura, remover participante, mudar responsável, suspender utilizador/organização, email ausente/alterado, autoridade indisponível antes de cada tentativa. |
| CA06 | Snapshot apesar de estado/título posteriores, HTML malicioso, texto equivalente, fuso explícito, ausência de notas/motivos/PII no envelope e logs. |
| CA07 | Duplicação, workers concorrentes, lease/fence expirado, crash em cada fronteira, aceitação com resposta perdida, replay, janela 24h e pedido alterado com mesma chave. |
| CA08 | Sessão na organização correta/incorreta, acesso indisponível, sessão expirada, outro utilizador, URL manipulada; nenhum GET privado antes da confirmação do contexto. |
| CA09–10 | Alertas internos e transições atuais preservados; disabled sem novos envios; simulação sem rede; configuração real incompleta falha sem falso sucesso. |
| SQL/runtime | Uniqueness e FKs compostas, isolamento por papel, atomicidade, recuperação após restart, retenção/replay, shutdown e readiness; usar PostgreSQL isolado, não apenas mocks. |

Na implementação executar regressões primeiro, testes focados, suites aplicáveis completas, `node --check` dos JS alterados e build do frontend quando alterado. Os gates SQL externos exigem ambiente isolado e autorização própria; testes unitários não os substituem.

## Verificações obrigatórias antes de ligar o produtor

Confirmar os campos de identidade/endereço realmente disponíveis e o contrato de resolução central sem impor silenciosamente email verificado; concretizar a captura consistente de candidatos; escolher o módulo/manifesto tenant correto; testar operação/ator de serviço e boundary de transações no lifecycle; definir retenção/replay; validar retorno autenticado e seleção de organização. São tarefas técnicas da implementação, não evidência de infraestrutura já pronta.

## Resultado desta fase

Plano documental baseado no código existente. Nenhum código executável, SQL ou configuração de envio foi alterado; nenhum teste de entrega foi executado. Próximo passo: implementar primeiro os contratos, a política de destinatários, o template e o transporte simulado, com testes locais, mantendo a funcionalidade desativada.
