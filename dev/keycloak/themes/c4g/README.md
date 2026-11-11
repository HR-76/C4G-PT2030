# Tema C4G

Login com formulário nativo à esquerda e painel verde-petróleo C4G à direita. O painel mantém o círculo animado original, com catálogo central, matching explicável, candidaturas, equipa e prazos. Até 900 px, o painel segue o formulário; com movimento reduzido, a órbita permanece estática. Campos, submissão e ações de autenticação continuam herdados.

11/11/2026: a proposta Corporate foi retirada a pedido do utilizador; repostos o círculo e a composição anterior. Preservados os estilos adicionais da verificação por email e dos botões. A instância ativa não chegou a ser alterada.

Compatibilidade verificada: Keycloak 26.8.0. `login` herda `keycloak`; `account` herda `keycloak.v3`. Mantêm-se os templates, ações e aplicação nativos. O tema não cria contas nem altera passwords, MFA ou recuperação.

O único complemento de template é `login/footer.ftl`: orientação expansível “Esqueci-me da palavra-passe”, apenas no formulário de login enquanto a recuperação nativa está desativada. Não envia email nem modifica a autenticação. Foi conferido contra o ponto de extensão `loginFooter.content` do template oficial 26.8.0. Quando os recursos não estão montados, atualizar também este ficheiro e o CSS de login no contentor local.

Idioma: português de Portugal. Keycloak 26.8.0 identifica a tradução europeia por `pt`, distinta de `pt-BR`; o tema herda esse catálogo e ajusta os textos em `login/messages/messages_pt.properties`. O realm deve ter `internationalizationEnabled:true`, `supportedLocales:["pt"]`, `defaultLocale:"pt"`; o cliente OIDC pede `ui_locales=pt-PT pt`. Não basta alterar o idioma do navegador. Instalações novas recebem estes campos em `optionalIdentity.js`. Referência: [localização de temas Keycloak](https://www.keycloak.org/ui-customization/localization).

Para atualizar o idioma de uma instalação existente, usar a operação restrita `applyLocalization` de `backend/scripts/localPlatform/identityLocalization.js`, que verifica ownership e preserva a restante configuração, com backup separado de localização. **Confirmar primeiro o destino ativo do proxy:** o CLI deste script administra a instância habitual 8080; em 29/10/2026 o realm ativo está encaminhado para `c4g-native-email-idp` na porta 8187. O tema dessa instância está montado só para leitura; atualizar os dois ficheiros de idioma na origem do mount, após backup. Configuração aplicada, destinos e provas estão em [login em português de Portugal](../../../../context/features/login-portuguese-portugal.md).

O compose F2 monta esta pasta em `/opt/keycloak/themes/c4g:ro` para instalações futuras. O contentor local anterior foi criado antes desse mount: os recursos `account` foram copiados para o mesmo diretório sem recriar o contentor. Não executar `compose down` nem reinstalar a identidade para atualizar aparência.

Para o ambiente local já preparado, verificar primeiro se o diretório do tema existe no contentor e atualizar apenas os recursos. Depois executar `node backend/scripts/localPlatform/identityBranding.js`. O comando confirma origem/realm/ownership locais, guarda apenas os nomes dos temas anteriores em `.tmp/local-platform/identity-branding-backup.json`, altera loginTheme/accountTheme e verifica que o resto da configuração do realm permanece igual. É idempotente; não imprime o realm nem credenciais.

O instalador `optionalIdentity.js` seleciona ambos os temas apenas para novos realms. Não reexecutar setup ou seed para aplicar esta alteração a um realm existente. Reversão visual: repor os dois nomes guardados no backup local, sem substituir a restante configuração.

Validação: `node --test backend/test/localIdentityBranding.test.js` e `node test/integration/local-platform/identity-branding.cjs`, com infraestrutura local pronta. O gate usa contas locais de ensaio existentes, não altera credenciais/MFA e não envia email. Confere tema, logótipo, ações, desktop/móvel e configuração antes/depois. Capturas em `output/playwright/c4g-access-identity`.

Ao atualizar Keycloak, repetir a inspeção visual e validar as classes PatternFly herdadas, CSS e carregamento do logo. Não substituir nem editar os temas distribuídos dentro dos JARs. [Documentação oficial](https://www.keycloak.org/ui-customization/themes).
