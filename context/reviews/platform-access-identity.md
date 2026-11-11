# Login inicial e identidade de conta C4G

## Atualização visual pela referência do utilizador — 18/10/2026

Build Vite, `node --check` do gate e revisão visual das capturas finais desktop/móvel PASS. A primeira tentativa de build encontrou `spawn EPERM` no sandbox; repetição autorizada fora dessa restrição concluída com sucesso.

Aplicado ao Keycloak habitual: fundo branco/formulário à esquerda (58%) e apresentação C4G em verde-petróleo à direita (42%), logótipo no topo e textura circular discreta. Em móvel, formulário antes do painel. Campos e ações continuam nativos. Sem serviços sociais ou registo público adicionais. Recursos CSS/FTL copiados ao contentor existente, sem recriação.

Gate Chrome/OIDC repetido PASS: login a partir de `/` e `/login`, sessão existente, recuperação adiada, alternância de visibilidade da password e tema de conta. Layout 1920/1440/900/390 sem overflow; formulário e painel separados no desktop e ordenados no móvel. Configuração do realm e número de contas inalterados. Inspeção visual corrigiu contraste de parágrafos herdado do tema base. [Desktop](../../output/playwright/c4g-access-identity/split-login-1920.png) e [móvel](../../output/playwright/c4g-access-identity/split-login-390.png).

18/10/2026 · Review do primeiro incremento da [feature de entidades/utilizadores/acesso](../features/platform-entities-users-and-access.md).

Correção após captura do utilizador: a exceção de `/login` ainda mostrava o botão intermédio. Removida; tanto `/` como `/login` iniciam agora diretamente o formulário nativo. Retorno interno do React Router preservado, com recusa de destinos externos/malformados. **7 testes DirectLogin, gate de navegação, gate OIDC real 1440/390 e build PASS**. `/login`, reload do formulário, entrada autenticada e visitas a ambas as rotas com sessão existente conferidos. [Captura da rota corrigida](../../output/playwright/c4g-access-identity/login-alias-1440.png). A referência anterior à compatibilidade de `/login` não implica conservar a página com botão.

## Implementado e verificado

- `/` abre diretamente o formulário C4G do Keycloak, conforme confirmação posterior do utilizador, sem botão intermédio. `DirectLogin` inicia uma única transação em StrictMode e substitui a entrada no histórico. Sessão existente mantém o destino por perfil, sem novo formulário. `/login` também abre diretamente o formulário. Interceptor 401 não expulsa visitantes de `/` e `/recuperar-password`.
- “Esqueci-me da password” permanece disponível no formulário nativo através de um rodapé herdado com disclosure acessível; quando a recuperação nativa for ativada, esta orientação deixa de aparecer. A rota de orientação na aplicação mantém regresso ao login direto. Não recolhe email/password nem afirma envio. `resetPasswordAllowed=false` e SMTP intactos, conforme decisão de manter email para o final.
- Tema Account C4G herdado de `keycloak.v3`: logótipo existente em superfície branca, cabeçalho #075B59, marca #5FAD2F, ações/seleção verdes, fundo claro e foco visível. Cabeçalho móvel em duas linhas para não esconder nem ultrapassar os controlos. Password/MFA permanecem ações da aplicação nativa de conta; não foram alterados para testar aparência.
- Seleção `loginTheme=c4g` e `accountTheme=c4g` no realm habitual, através de operação local com verificação de ownership, backup apenas dos nomes anteriores e comparação da restante configuração. Instalador seleciona ambos os temas para novos realms. O contentor existente não tinha o mount atualmente declarado no compose; copiados apenas os recursos de conta, sem recriar contentor/realm. [Operação e manutenção](../../dev/keycloak/themes/c4g/README.md).

## Provas

- `backend/test/localIdentityBranding.test.js`: 3 testes PASS — escrita só de apresentação, backup sem segredos, repetição sem nova escrita, destino/ownership recusados e alteração concorrente de configuração detetada.
- `AccountSecurity.test.jsx`: 3 testes PASS — política MFA e acesso às ações preservados.
- Após confirmação da entrada direta: `DirectLogin.test.jsx`, 2 testes PASS — uma navegação em StrictMode e repetição explícita em caso de falha. Gates de login e identidade atualizados e repetidos PASS: raiz abre OIDC uma vez, recuperação regressa ao formulário, OIDC real entra na aplicação e visita posterior à raiz mantém a sessão. Build e sintaxe repetidos PASS.
- `test/integration/login-runtime.cjs`: PASS — sessão anónima 401, login em `/`, recuperação, regresso, alias e reload, sem erros React.
- `test/integration/local-platform/identity-branding.cjs`: PASS — OIDC real, conta de ensaio existente, tema/logo/título/cores computados, ações de password/MFA presentes, configuração/contagem de contas inalteradas, zero mutações de conta ou negócio. [Resultado](../../output/playwright/c4g-access-identity/verification.json).
- Chrome 1440/390: [entrada](../../output/playwright/c4g-access-identity/home-1440.png), [recuperação](../../output/playwright/c4g-access-identity/recovery-390.png), [conta](../../output/playwright/c4g-access-identity/keycloak-account-1440.png), [conta móvel](../../output/playwright/c4g-access-identity/keycloak-account-390.png). Inspeção visual e ausência de overflow horizontal PASS. Menu recolhível, sem alteração do motor de autenticação.
- `npm run build`, sintaxe dos scripts alterados e health local `ready/workerReady=true`: PASS.

## Limites

Não é recuperação de password operacional: falta SMTP e prova de entrega/reset. Nenhum email enviado. A entrada direta no formulário nativo foi confirmada e implementada; `/login` também abre diretamente o formulário após correção verificada. Textos do Keycloak mantêm o idioma do realm. Capturas de entrada direta e orientação nativa atualizadas e revistas a 1440/390, sem overflow.

A feature de criação está especificada, com [plano operativo](../features/platform-entities-users-operational-plan.md), mas não está concluída nem ligada ao ecrã habitual. Não foram criados utilizadores/entidades, instaladas migrações, modificados grants ou publicados serviços. O gate isolado anterior não substitui a composição operacional pendente.

Próximo passo: composição operacional de criação da entidade/primeiro administrador, seguida do formulário e da extensão para utilizadores adicionais.
