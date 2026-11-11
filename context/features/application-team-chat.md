# Chat da equipa da candidatura

Estado **Review** — ativo no ambiente habitual desde 11/11/2026.

Em «Equipa e tarefas», apresentar os participantes em cartões compactos com iniciais, nome e tarefas abertas já carregadas. Mostrar primeiro o responsável quando integra a equipa e manter o acesso às páginas seguintes de participantes.

- Uma conversa de grupo por candidatura, num painel lateral que funciona também em ecrãs pequenos. Histórico paginado com autor, data e hora de Lisboa e atualização automática enquanto o painel está aberto.
- Envio limitado a texto simples até 2000 caracteres. O mesmo envio pode ser repetido sem duplicar a mensagem.
- Só membros ativos da equipa com acesso à candidatura podem ler ou escrever. Um novo membro pode ler o histórico completo. A remoção da equipa ou a revogação de acesso impede novos pedidos. A edição da candidatura, das tarefas e dos documentos segue as permissões próprias.
- Isolar mensagens na base tenant, autorizar no servidor e auditar envios sem incluir o texto no evento.

A aceitação exige que dois membros possam trocar mensagens e consultar o histórico, incluindo um membro com acesso de consulta. O servidor recusa leitura e envio a quem está fora da equipa ou da organização e a membros removidos. Cada pedido repetido corresponde a uma só mensagem. A interface trata carregamento, ausência de mensagens e falhas de envio.

## Ativação

Em 11/11/2026, `createApplicationChatMigrationRunner` aplicou `036_application_team_chat` no tenant habitual a partir da versão 035, depois de verificar uma cópia de segurança. O diretório Central publicou a revisão 7 e a configuração local recebeu a mesma versão. A comparação dos dados antes e depois confirmou a preservação de candidaturas, participantes, tarefas e histórico de trabalho.

O botão aparece para membros ativos após o runtime verificar a capacidade `APPLICATION_TEAM_CHAT`. O painel repete uma vez a leitura quando o servidor devolve 503 durante uma atualização concorrente da sessão.

## Verificação

- Backend com 2904 testes aprovados e 7 ignorados. Frontend com 935 testes aprovados e build Vite concluído.
- PostgreSQL 18.3 descartável com o instalador e o preflight do projeto. Troca de mensagens entre dois participantes fictícios, isolamento entre candidaturas e organizações, repetição do envio e retirada de acesso após remoção.
- Chrome a 1440 e 390 px com API simulada, incluindo abertura, envio e fecho pelo teclado. [Computador](../../output/playwright/application-team-chat/chat-desktop.png) · [Telemóvel](../../output/playwright/application-team-chat/chat-mobile.png).
- Chrome no ambiente habitual a 1440 e 390 px com sessão OIDC. Histórico HTTP 200 para membro ativo, HTTP 404 fora da equipa, HTTP 401 para visitante e HTTP 400 para mensagem em branco. A prova de envio válido usou participantes fictícios.
