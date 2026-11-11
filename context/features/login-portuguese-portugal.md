# Login em português de Portugal

Estado: Review — 29/10/2026. Correção pedida pelo utilizador a partir do formulário de login em inglês, implementada e validada no Keycloak local ativo.

## Contrato e aceitação

- O login C4G deve apresentar título, nome de utilizador, palavra-passe, botão Entrar, ajuda de recuperação, mostrar/ocultar palavra-passe e mensagens de erro em português de Portugal, mesmo num navegador em inglês.
- Usar a tradução europeia nativa do Keycloak 26.8.0 (`pt`, distinta de `pt-BR`), com ajustes do tema C4G quando necessários. O pedido OIDC indica `pt-PT pt`; a configuração local seleciona `pt`.
- Aplicar a preferência a instalações locais novas e ao realm local existente por operação restrita e idempotente, com backup apenas dos campos de idioma e verificação de que a restante configuração permanece intacta.
- Preservar composição visual, fluxos de autenticação, utilizadores, credenciais, MFA, memberships e dados. Não executar setup, SQL, seed, recriação de contentores ou deploy.
- Documentar e executar primeiro regressões focadas; depois suites backend/frontend, build e sintaxe dos JavaScript alterados. Conferir o formulário real em desktop/móvel, nomes acessíveis, ajuda e erro de credenciais inválidas com identidade fictícia, sem iniciar sessão numa conta real.

## Diagnóstico

O tema login herda `keycloak`, sem tradução própria; o instalador não ativa internacionalização nem define idioma do realm e o cliente OIDC não envia preferência de idioma. O rodapé personalizado está em português, mas usa o estrangeirismo «password». O JAR instalado inclui bundles separados `messages_pt.properties` (português europeu) e `messages_pt_BR.properties`.

## Validação

- Regressões executadas antes da implementação: falha no rodapé ainda com «password», módulo de localização ainda ausente e cinco falhas OIDC por ausência de `ui_locales`.
- 10 testes de tema/localização/branding PASS; 60 testes focados OIDC/segurança, incluindo cinco novos, PASS. Sintaxe dos JavaScript alterados PASS.
- Suite backend: 1663 PASS, 6 FAIL, 7 SKIP. As seis falhas estão em `fundingEnrichmentPersistence.test.js`, fora dos ficheiros deste incremento (descoberta e validação de evidência de fontes).
- Suite frontend: 397 PASS, 1 FAIL. Falha anterior em `DirectLogin.test.jsx`: expectativa de repetição explícita com `authentication=expired`; o componente existente só trata `cancelled`. Nenhum ficheiro frontend foi alterado.
- Build frontend PASS. Logs em `.tmp/login-localization/{backend-suite,frontend-suite,frontend-build}.log`.
- Chrome real pelo Playwright CLI: navegador `en-US` e `pt-BR`, sem preferência OIDC e com `pt-PT pt`, ambos apresentam o bundle europeu `pt`. Título, rótulos, botão, nomes acessíveis de mostrar/ocultar palavra-passe, ajuda e erro de credenciais fictícias inválidas PASS. 1440/390 px sem overflow; capturas inspecionadas em `output/playwright/login-portuguese-portugal/`.
- Percurso reproduzível: `test/integration/local-platform/login-localization.cli.js`, através de `playwright-cli run-code --filename`. Não prepara infraestrutura, aplica SQL ou inicia sessão em contas reais.
- Expectativas de idioma nos gates anteriores `identity-branding.cjs` e `security-presentation.cjs` atualizadas com base no bundle público `keycloak.v3/account` 26.8.0: «Autenticação de Dois Fatores» e «Atualizar». Sintaxe PASS; esses gates completos não foram reexecutados.

## Aplicação local e limites

O proxy atual encaminha `/realms/c4g-native-local` para `c4g-native-email-idp` (porta local 8187), embora os scripts de administração anteriores apontem para `c4g-f2-integration-keycloak-1` (8080). Foram atualizados os recursos do tema e apenas os três campos de idioma nas duas instâncias. Não se recriou nem reiniciou nenhum contentor.

O tema ativo está montado só para leitura a partir de `C:/Users/Utilizador/c4g-local-demo/native-email/private/themes-before`; foram atualizados apenas `c4g/login/footer.ftl` e `c4g/login/messages/messages_pt.properties` na origem. As cópias anteriores estão em `.tmp/login-localization/{login-theme-before,active-login-theme-before}`. Backups de idioma: `.tmp/local-platform/identity-localization-backup.json` e `.tmp/login-localization/active-identity-localization-backup.json`. Nenhum backup inclui o realm completo ou segredos.

`applyLocalization` verifica ownership, destino local, tema C4G e invariância da restante configuração; aplicação repetida no fornecedor habitual devolveu `changed:false`. A instância ativa conservou o número de contas. O adaptador operacional pontual para a instância ativa está em `.tmp/login-localization/apply-active.cjs`, com credenciais apenas em memória. O CLI de `identityLocalization.js` mantém o destino administrativo habitual 8080; confirmar sempre o encaminhamento antes de o usar.

A aplicação em 3000 estava parada: a prova real incidiu no formulário servido pelo IdP e a construção dos URLs OIDC foi validada nos testes. Não se executou um login completo na APP. O idioma do realm também seleciona as traduções nativas da gestão de conta; não foi feita revisão integral dessa consola. Não houve SQL, setup, seed, alterações de credenciais/MFA/memberships, commit ou deploy.
