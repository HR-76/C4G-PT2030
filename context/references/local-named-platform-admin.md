# Conta administrativa C4G nominativa — operação local

Pedido de 18/10/2026: criar uma conta administrativa com o email indicado pelo utilizador, para posteriormente tratar os acessos das entidades.

Âmbito: uma nova identidade no realm local C4G existente, ligada a um utilizador global e à atribuição `C4G_ADMIN`. Não criar memberships, entidades ou candidaturas; preservar as contas `admin` e `hugo`. A conta nominativa não herda os acessos privados da conta Hugo anterior.

Critérios: recusar colisões de email/identidade, criação retomável sem redefinir passwords existentes, password temporária com alteração obrigatória no primeiro login, segredo apenas em ficheiro local com ACL restrita, vínculo OIDC e papel central verificados, dados e memberships anteriores inalterados. Não enviar email ou credenciais por chat.

A administração atual permite fontes/API e catálogo. O percurso de criação de entidades/primeiro administrador na interface permanece por implementar; não declarar essa capacidade disponível ao criar a conta.

## Resultado — 18/10/2026

Conta nominativa criada no realm `c4g-native-local`, com vínculo OIDC e papel `C4G_ADMIN` verificados. Sem memberships privadas. Ficheiro de acesso em `.tmp/local-platform/named-admins/`, protegido por ACL do titular Windows e SYSTEM e excluído do Git. Não copiar o conteúdo para documentação ou mensagens.

Comparação automática confirmou contas, atribuições anteriores, memberships e grants preservados. Chrome aceitou a password temporária e apresentou alteração obrigatória no primeiro login; a alteração não foi concluída pelo agente. A leitura administrativa de fontes passou. [Prova sem credenciais](../../output/playwright/c4g-internal-access/named-admin-verification.json).

O comando explícito `backend/scripts/localPlatform/createNamedAdmin.js` verifica colisões antes de criar e nunca redefine passwords existentes. A criação na Central é transacional; uma falha após criar a identidade deixa-a sem acesso à aplicação até completar o vínculo. Conflitos de identidade desconhecida são recusados para revisão, sem associar automaticamente por email. Nenhum serviço reiniciado ou configuração do realm alterada.
