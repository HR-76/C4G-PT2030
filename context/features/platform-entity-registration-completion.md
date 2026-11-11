# Conclusão da ficha e preparação da entidade

Estado: Review / prova isolada PASS (18/10/2026). Recorte D autorizado em 18/10/2026, apenas em composição isolada. Segue o plano `platform-entity-invited-registration-plan.md` e preserva os percursos atuais de utilizadores.

## Contrato e aceitação

- O titular autenticado submete a revisão persistida; o servidor valida todos os campos portugueses. Não aceitar campos, identidade, permissões ou parâmetros de infraestrutura no comando de conclusão.
- Uma transação congela o snapshot, reserva PT+NIF, cria organização PROVISIONING, membership PENDING_PROJECTION, ficha central e trabalho durável. Nenhum grant operacional nesta fase.
- Unicidade fiscal cobre preparação e entidades ativas, suspensas ou arquivadas. Conflito não revela a outra entidade. Falha técnica ou cancelamento não liberta automaticamente a reserva.
- Replay exige sessão/titular atuais e a mesma intenção/revisão. IDs e snapshot não mudam numa retoma; nova intenção após submissão é recusada.
- Worker retoma fases com lease/fence, reutilizando os adaptadores privados existentes. API não executa DDL. Depois da evidência de tenant, credenciais API/worker e projeção, ativação de entidade, membership, grants e auditoria é atómica.
- Cancelamento C4G antes da ativação impede workers tardios; mantém recursos, histórico e reserva. Entidade concluída usa gestão de acessos, não cancelamento da adesão.
- Interface conserva quatro passos e marca C4G. A conclusão exige rascunho guardado e revisto, mostra preparação/retoma e permite entrar apenas quando o servidor confirma ativação. Sem registo público, email ou armazenamento de ficha no browser.
- Provas: NIF concorrente, replay, falha de auditoria, snapshot imutável, perda de resposta, fence, cancelamento, identidade/sessão revogada, duas bases e credenciais reais, perfil completo e tarefas antigas preservadas. Build, sintaxe, testes focados e revisão visual desktop/mobile antes de Review.

## Limites

Sem instalação ou migração no ambiente habitual. Sem alterações de password, novas regras de produto, faturação, SMTP, anexos ou antivírus. Campos históricos do administrador descrevem a adesão; não representam para sempre o administrador atual.

## Implementação

- Central 025 adiciona a reserva fiscal e o trabalho de conclusão, sem alterar migrações publicadas nem inventar NIF nas entidades antigas. Snapshot e IDs não têm comandos de edição; a ficha atual continua em `organization_registration`.
- `completionService.submit` recebe apenas `expectedRevision` e `requestId`, revalida o titular e valida o rascunho persistido. O conflito fiscal não devolve nome, ID ou dados da entidade encontrada.
- Fases duráveis TENANT → PROJECTION → ACTIVATION → COMPLETE, com lease/fence e retoma pelo `completionWorker.runOnce`. O worker é uma composição privada; nenhuma rota pública permite executar DDL ou escolher um tenant técnico.
- Portas reais de provisionamento/projeção reutilizam `postgresProvisioner` no processo privado existente. A composição isolada publica e testa credenciais API/WORKER e volta a publicá-las antes de ativar. As configurações habituais não são montadas automaticamente: o agendamento e resolvedor privados habituais continuam para a instalação posterior.
- Cancelar preserva a reserva fiscal, organização em preparação e eventual base já criada. Reativação/reconciliação não é inferida. Após COMPLETE, cancelar a adesão é recusado e a gestão de acessos existente mantém autoridade.
- POST `/api/admissions/:id/submit` e GET `/api/admissions/:id/status` só são montados quando a conclusão está composta. CSRF/sessão existentes mantêm-se; a sessão limitada aceita apenas estes caminhos/métodos exatos.
- O formulário exige gravação antes de concluir, mantém a intenção em memória perante resposta incerta e retoma o estado após recarregar. Só mostra entrada quando o servidor confirma acesso ativo; seleção de organização reutiliza o percurso de sessão atual.

## Verificação concluída

47 testes focados backend, 18 testes frontend e dez grupos PostgreSQL PASS, incluindo provisionamento/projeção reais e ativação após rollback de auditoria. Migração medida/aplicada em base descartável, build frontend e sintaxe PASS. A transação de ativação declara POLICY/ORG/MEMBER/SUBJECT; a migração conserva a restrição de lease e substitui apenas a antiga proibição de COMPLETE.

`member-real-gate.ps1 -SkipBuild -Completion` terminou com código zero. Keycloak/OIDC, bases de entidades separadas, credenciais API/WORKER, respostas perdidas após tenant e projeção, reinício do worker, rollback de auditoria e retoma foram exercitados. O administrador entrou no perfil com NIF, morada, contactos e dimensão provenientes da ficha. Memberships anteriores permaneceram intactas; os percursos existentes e tarefas passaram nas regressões. Cancelar a adesão concluída foi recusado; suspender a nova membership retirou `canEnter` no estado atual.

Preparação/entrada conferidas em 1440/390 px sem overflow; perfil completo conferido em desktop. Evidência: `output/playwright/c4g-completion/service-verification.json`, `real-verification.json`, `preparing-1440.png`, `preparing-390.png`, `ready-390.png`, `complete-profile-1440.png`; resultado global em `output/playwright/c4g-onboarding-real/verification.json`. Recursos descartáveis limpos pelo ensaio. Sem instalação habitual.

Próximo passo: compor o agendamento e resolvedor privados no ambiente habitual e ligar o percurso C4G/convidado, com backup/restauro e revisão local do recorte E.
