# Utilizadores e acessos por entidade — 18/10/2026

## Âmbito

Retoma autorizada do painel administrativo: adicionar utilizadores a entidades existentes e gerir os respetivos perfis e estado. A criação de uma nova entidade e do primeiro administrador continua a ser uma operação distinta; não se usa esse agregado para cada utilizador adicional.

Na ficha C4G da entidade e no ecrã Acessos: nome, email e perfil; revisão antes da criação; preparação retomável; ligação temporária entregue manualmente; substituição/revogação e consulta da ativação. C4G e administrador podem criar os três perfis; gestor apenas técnicos. A inclusão numa equipa de candidatura mantém o percurso existente. Alterar ou suspender um acesso exige confirmação e não altera outros vínculos da conta.

## Implementação e limites

- Migração Central 021, com operações e convites próprios, protocolo SQL fechado, auditoria e idempotência. A membership central permanece a fonte de autoridade. A gestão C4G não simula uma membership organizacional.
- Identidade reutilizada por issuer/subject validado. Contas desconhecidas no Keycloak não são adotadas apenas por coincidência de email. Fichas de pessoa já existentes com o email exigem verificação explícita da associação; o processo não as substitui nem duplica.
- Worker IPC com conta técnica de identidade e bindings físicos explícitos. Sem provisionamento de bases no pedido de um utilizador adicional.
- Password definida no Keycloak. O módulo local revalida a ligação antes da escrita; OIDC com PKCE, state, nonce e browser binding. A ativação dos grants, membership, consumo do convite e auditoria é atómica. Ligação de uso único, 24 horas; contexto de ativação de 10 minutos.
- A página de ativação usa CSRF, cookie HttpOnly, CSP com origem explícita do Keycloak e Referrer-Policy same-origin; a ligação é retirada do fragmento antes de continuar. O segredo só é apresentado na emissão, sem armazenamento no browser ou logs.
- Composição local apenas. Ponte Docker limitada ao endpoint local e configuração privada. Email, armazenamento e antivírus continuam adiados. Não foi validado rollout de produção.

## Verificação

PASS: 12 verificações de serviço com PostgreSQL descartável; 39 testes backend focados, mais 26 de preflight/programas; 16 testes frontend; build Vite e verificação sintática. Cobertura inclui autorização por perfil/entidade, replay, concorrência, falha de auditoria, retoma, emissor suspenso e preservação de grants de trabalho.

PASS: composição real Keycloak/PostgreSQL/browser, criação pela interface, definição nativa de password, login normal, catálogo acessível e administração recusada ao técnico. A mesma identidade aceitou uma segunda entidade e manteve os dois vínculos. Revogar com o formulário de password aberto impediu a gravação da password e a ativação. A regressão conservou candidatura/tarefa anteriores e isolamento físico.

PASS habitual: Central 019 → 021, backup restaurado numa base descartável própria, registo do binding físico da entidade existente, configuração da conta técnica e clientes dedicados. Keycloak conservado no mesmo contentor, com cópia a frio dos dados antes da instalação do módulo; sem redefinir passwords nem recriar a instalação. Corrigido o reconhecimento cumulativo de 020/021 no preflight do catálogo; continuaram a ser recusadas tabelas em falta ou inesperadas. API 5000 e worker retomados, health 200.

PASS browser habitual: login C4G, formulário com três perfis e lista de acessos em 1440/390, sem overflow; nenhuma criação ou alteração de acesso durante esta conferência. Digests de contas, memberships, grants, catálogo e dados tenant mantidos. Capturas revistas visualmente. A criação/ativação com escrita foi provada no ambiente isolado; não se criaram contas fictícias na instalação habitual.

Evidência: `output/playwright/c4g-member-onboarding/{service-verification,real-verification,local-upgrade,native-verification}.json`; `native-form-1440.png`, `native-form-390.png`, `access-1440.png`, `access-390.png` e `native-password.png`. Configuração e backups privados ficam em `.tmp/local-platform/members/`, sem segredos nos relatórios.

Estado: Review, disponível localmente para revisão pelo utilizador. Próximo passo: abrir a ficha da entidade e usar Adicionar utilizador para um acesso real. Criação de entidades, email e publicação de produção não são declarados concluídos por esta entrega.
