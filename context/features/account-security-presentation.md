# Apresentação da segurança da conta

Estado: Review. Pedido de melhoria visual de 18/10/2026.

## Consola de definições com Metronic 9 — 11/11/2026

Âmbito: tema `account` C4G do Keycloak. Usar os cartões, as linhas de métodos e os botões do exemplo local `account/home/settings-sidebar` como referência. Manter a tipografia Segoe UI e aplicar a paleta C4G de verde-petróleo #075B59, texto #273534, texto secundário #5F706C, borda #DFE7E5, superfície #FFFFFF e fundo #F7F9F8.

Critérios de aceitação: cabeçalho e navegação distinguem a página ativa, categorias de credenciais têm cabeçalhos próprios e estados por método ficam junto à ação correspondente. Rever Informação pessoal, Entrar na Conta, Atividade dos dispositivos e Aplicações a 1440, 768, 390 e 320 px. Confirmar foco visível, menus móveis e rótulo português da ação por email. Preservar formulários e ações nativos, incluindo destinos e gestão de credenciais.

Resultado: cartões de credenciais mais compactos, formulário com campos alinhados, estados de configuração junto dos métodos e navegação em verde-petróleo. A consola conserva as ações nativas do Keycloak. [Implementação de referência do Keycloak 26.8.0](https://github.com/keycloak/keycloak/blob/26.8.0/js/apps/account-ui/src/account-security/SigningIn.tsx).

O proxy local devolvia os textos de outra instância no caminho `/resources/c4g-native-local/account/pt`. A instância do realm já devolve `email-authenticator-display-name` como «Verificação por email». O ficheiro local `.tmp/f2-integration/demo-nginx.conf` encaminha agora o prefixo de traduções da conta para a instância do realm. O Nginx reconheceu a regra montada e passou o teste de sintaxe.

Validação: 16 combinações de página e largura passaram em Chrome com Playwright. Confirmados foco visível, menus por teclado, ligação de retorno e ação de email traduzida. O navegador substituiu o CSS e a resposta de tradução durante o ensaio. Capturas em `output/playwright/metronic-account/`. Suite frontend com 944 testes e build concluídos. Fica pendente aplicar o CSS no Keycloak local e recarregar o Nginx.

## Reposição de palavra-passe no laboratório — 11/11/2026

Critérios deste ensaio: uma conta fictícia recebe a ligação no Mailpit, conclui a reposição e entra com a nova palavra-passe. A reutilização e a expiração não podem alterar a credencial. Ensaio realizado em Keycloak 26.8.0, realm descartável `recovery-proof`.

A configuração inicial gravava a nova palavra-passe antes de pedir nome e apelido às contas com perfil incompleto. Nesse estado intermédio, a mesma ligação permitiu substituir a credencial. No realm descartável, a ação `VERIFY_PROFILE` foi colocada imediatamente antes de `UPDATE_PASSWORD` através da operação de prioridade das ações obrigatórias. A correção é uma alteração de ordem das ações do realm e requer validação dos restantes percursos de autenticação antes de qualquer aplicação ao realm habitual.

- **Perfil incompleto:** o formulário de perfil apareceu primeiro e a conta ainda não tinha credencial. Após preencher o perfil, a reposição foi concluída, a nova palavra-passe permitiu entrar e uma nova apresentação da ligação deixou a credencial intacta.
- **Duas sessões:** com perfil completo, as duas sessões abriram o formulário antes da primeira submissão. A primeira alteração foi gravada. A segunda sessão apresentou erro e manteve a credencial da primeira, confirmada por leitura administrativa e novo login.
- **Expiração:** com prazo de 20 segundos no laboratório, a ligação expirada mostrou a indicação de expiração sem formulário de reposição nem nova credencial. O prazo do realm foi reposto em 300 segundos.

A reposição continua desativada no ambiente habitual.

### Ensaio com a extensão C4G — 11/11/2026

Chrome e cliente OIDC de ensaio com PKCE, Keycloak 26.8.0, extensão C4G, PostgreSQL descartável, chave de ensaio e Mailpit. As verificações de estado foram feitas sobre as credenciais no Keycloak.

- Com a verificação adicional ativa e o perfil incompleto, o formulário de perfil apareceu antes da reposição. A nova palavra-passe foi aceite num novo início de sessão com código por email. A reutilização da ligação não apresentou o formulário nem mudou a credencial e a preferência por email manteve-se ativa.
- Ativar e desativar com código alterou a preferência no Keycloak e concluiu o retorno OIDC. Após desativar, um novo início de sessão terminou sem desafio por email.
- Cancelar a ativação manteve a preferência desativada. Cancelar a desativação manteve a credencial de email ativa. O retorno ocorreu sem código de autorização.
- Na simulação de perda de acesso à caixa, a palavra-passe levou ao desafio de email. Sem fornecer o código, a conta não recebeu código de autorização nem sofreu alterações na preferência. O formulário indica a necessidade de um procedimento operacional de recuperação aprovado.
- A sequência longa atingiu o limite de envios por conta. O ciclo de desativação foi confirmado separadamente, com outra conta descartável e os limites da extensão ativos.

A prova de navegador usa um cliente OIDC de ensaio. O retorno da aplicação em caso de cancelamento tem teste automatizado próprio. A [recuperação assistida](../runbooks/assisted-email-recovery.md) foi definida e ensaiada num ambiente descartável, com confirmação de identidade simulada por um meio independente e aprovação separada.

## Orientação de recuperação — 10/11/2026

A rota pública `/recuperar-password` apresenta orientação estática, sem recolher identificadores ou iniciar recuperação; regressa ao login. No realm local pertencente à instalação, a leitura administrativa confirmou `resetPasswordAllowed=false` e proteção contra força bruta ativa, sem alterações à configuração. Teste de regressão da rota e percurso Chrome com API simulada PASS; frontend 838 testes PASS e build PASS. A recuperação por email, validade e utilização única de tokens continuam por validar antes de qualquer ativação.

## Ajuste do cabeçalho — 2026-11-06

Pedido: melhorar os botões e o menu das páginas de configuração com referências Metronic. Referências locais: `metronic-tailwind-react-demos/typescript/vite/src/components/ui/button.tsx` (outline, ghost, primary) e `src/partials/topbar/user-dropdown-menu.tsx` (menu compacto e avatar).

Direção: branco #FFFFFF, fundo #FAFBFA, texto #343434, borda #DCE3DE, verde #48752A e hover #395F20; Segoe UI existente, controlos de 14px/600, altura mínima 40px (44px em móvel), raio 8px. Cabeçalho alinhado horizontalmente: logótipo | retorno com contorno | utilizador e avatar. Menu branco com opções espaçadas e foco visível. Preservar toda a navegação e comportamento nativos do Keycloak. Aplicar hierarquia primary/secondary às ações do conteúdo, sem transformar todas em botões verdes.

Aceitação: retorno e menu distinguíveis, estados hover/aberto/foco, controlos móveis legíveis, sem alterações a autenticação, dados ou destinos. Alteração limitada ao CSS do tema account, com verificação visual do menu aberto e da página.

Validação Playwright de 2026-11-06: PASS em 1440, 768, 390 e 320px; contexto móvel adicional com toque a 390px. Foco de teclado, Enter/Escape, clique fora, menu dentro do viewport, retorno à aplicação e atualização da página confirmados; sem erros JavaScript. Corrigidas compressão do retorno, substituição móvel do nome por menu sem identificação e divisão excessiva do título Dispositivos autenticados. O posicionamento assíncrono nativo do menu é aguardado antes da medição. Capturas inspecionadas em `output/playwright/account-controls/`; prova reutilizável em `test/integration/local-platform/account-controls-ui.cjs`.

Recursos locais: o proxy encaminha `/resources/` para `c4g-f2-integration-keycloak-1`, embora a conta seja servida por `c4g-native-email-idp`. CSS sincronizado nos dois; backups em `.tmp/account-controls-backup/`. Build PASS. Suites gerais: frontend 783 PASS/14 FAIL; backend 2666 PASS/3 FAIL/7 SKIP, reproduzindo os totais de falhas anteriores a este ajuste. Logs `.tmp/account-controls-frontend-tests.log` e `.tmp/account-controls-backend-tests.log`.

Âmbito: reformatação do ecrã Segurança da conta e do tema account C4G do Keycloak existente. Preservar login, rotas, política MFA, credenciais, sessões e recuperação por email adiada. Não afirmar que MFA está ativo: a API expõe política, não inscrições do utilizador. Continuar a abrir o destino nativo existente de gestão de credenciais.

Direção frontend-design: petróleo #075B59, verde #39751F, lima #5FAD2F, branco #FFFFFF, fundo #F6F8F8, texto #20262B. Segoe UI/sistema existente, título 28px, secções 18px, corpo 14px. Uma superfície branca com linhas distintas Password e Dois fatores; ação principal no rodapé. Orientação curta à direita, sem simular definições editáveis. No Keycloak manter navegação nativa e reforçar painéis, hierarquia, foco e espaçamento.

```text
Segurança da conta
Password                 Como gerir
Dois fatores             Orientação breve
Gerir password e MFA
```

Revisão prévia: a hierarquia serve duas tarefas concretas, sem cartões de métricas ou estados de proteção inventados. Não refazer a composição do login já aprovada. Ecrã móvel numa coluna, foco visível e sem animações.

Aceitação: loading/erro com tentativa novamente; política MFA real; gestão nativa funcional; revisão 1440/390 do frontend e account Keycloak; build e testes existentes; atualizar apenas recursos do tema local após backup, sem recriar contentor ou alterar o realm.

## Resultado

Ecrã com secções Password/MFA, política apresentada sem inventar estado de inscrição, ação de gestão destacada, instruções curtas e tentativa novamente em erro. Tema account com painéis nativos, espaçamento, largura controlada, tipografia e controlos C4G; o login aprovado foi preservado.

14 testes frontend existentes PASS, build PASS. Prova Chrome real em 1440/390 PASS, sem overflow; tema/logo/ação Update e secção de dois fatores visíveis. Configuração do realm e número de contas iguais antes/depois, sem alterações de credenciais ou MFA. CSS anterior guardado em `.tmp/keycloak-account-style-backup/c4g-account-before.css`; atualizado apenas o recurso CSS do contentor local existente. Textos nativos do Keycloak mantêm o idioma configurado.

Capturas e verificação em `output/playwright/c4g-security-presentation/`. Gate: `test/integration/local-platform/security-presentation.cjs`.

Próximo passo: rever Segurança da conta e o acesso à gestão nativa com o utilizador.

## Correção de consulta expirada — 2026-11-06

A expiração da credencial de consulta do fornecedor não deve bloquear toda a página. A API devolve as definições gerais e `emailVerification: { available: false, reauthenticationRequired: true }` quando falta uma credencial válida (incluindo 401 do fornecedor). O cliente pede confirmação apenas nessa secção, sem inferir ativa/desativada nem renovar automaticamente credenciais. Erros inesperados do fornecedor mantêm 503.

Aceitação: consulta expirada responde 200/no-store sem preferência inventada; gestão nativa permanece acessível; confirmação explícita volta à página; credenciais válidas preservam estado confirmado; indisponibilidade real mantém erro.

Validação desta correção: regressão backend reproduziu 409 antes da alteração; 8 testes backend e 7 frontend PASS após correção, incluindo credencial ausente/inválida/expirada e Cache-Control no-store; node --check e build PASS. Suite frontend: 782 PASS/14 FAIL em áreas não alteradas (router, dashboard e oportunidades). Suite backend geral registou 10 falhas fora dos ficheiros alterados e não terminou; tentativa de interrupção após ausência de progresso. Logs em `.tmp/account-expiry-{backend,frontend,build}.log`. Sem validação na sessão real do navegador, nem publicação.
