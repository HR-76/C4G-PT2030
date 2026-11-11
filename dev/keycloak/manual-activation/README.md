# Ativação manual C4G

Módulo Keycloak 26.8.0 para o acesso inicial por convite, derivado da prova isolada e empacotado num namespace Java próprio. Herda a ação nativa `UpdatePassword`; não recebe, guarda ou devolve passwords à aplicação. O browser mantém OIDC com PKCE, state e nonce. Um convite de conta existente exige autenticação normal.

Exige `/opt/keycloak/conf/c4g-activation.properties`, privado, com realm, client, endpoint e segredo da ponte. A implementação aceita a ponte local Docker `http://host.docker.internal:5285/bridge/check`; apenas o realm descartável `c4g-manual-proof` pode usar a porta alternativa 5295 para não colidir com o ambiente habitual. Não constitui publicação de produção. Realm e cliente são conferidos em cada desafio e submissão; a autorização do convite é novamente conferida antes de concluir a escrita de password. Os segredos não pertencem ao repositório.

O instalador explícito configura clientes próprios e conta técnica de gestão de utilizadores, sem alterar passwords, MFA, recuperação, registo público ou o fluxo de login normal. O worker IPC lê as credenciais técnicas fora do processo HTTP. O módulo antigo `pt.c4g.proof` só existe na imagem descartável de regressão; nunca copiar essa imagem para o ambiente habitual.

Build: `docker build --tag c4g-manual-activation:26.8.0 dev/keycloak/manual-activation`. Prova completa: `test/integration/platform-onboarding/member-real-gate.ps1`, depois de construir a imagem descartável indicada em `member-real.Dockerfile`. Atualizar recursos do contentor local existente, sem recriar a instalação de identidade.
