# Integração APP — verificação adicional por email

A preferência e os desafios pertencem exclusivamente ao Keycloak. A APP consulta o estado e inicia ações protegidas; não gera códigos nem mantém uma preferência paralela. Isto não atribui assurance equivalente a TOTP e não altera a política de revisão documental.

## Configuração

- Integração explícita: `OIDC_EMAIL_VERIFICATION=keycloak-account-v1`. Ausência apresenta indisponibilidade; valores desconhecidos são recusados.
- Usar a configuração OIDC server-side existente, SESSION_SECRET externo, TLS confiável, cookies seguros, state, nonce e PKCE S256. Não incluir segredos nos ficheiros declarativos.
- Keycloak validado: 26.8.0 com `c4g-email-verification-26.7.2-c4g.1-rc4.jar`, SHA-256 `1B42592628DBA8E02D6F56031F0B52802FD2C3704727FC189EBF126D8BC951DE`.
- Registar o callback exato da APP e as ações `c4g-email-enable` / `c4g-email-disable`, com reautenticação recente exigida pelo componente. Manter o autenticador de email obrigatório após a resolução da identidade, incluindo Cookie/SSO, e o listener de invalidação aprovado.
- O cliente usa `fullScopeAllowed=false` e apenas `account:view-profile` para a API Account do próprio utilizador. Não requer administração do realm nem `manage-users`. Os grants da APP continuam na autoridade Central.
- O SMTP é configurado no IdP. A prova usa apenas captor local; entrega externa e credenciais de SMTP de implantação permanecem fora desta validação.

## Percurso e estado

GET `/api/auth/account-security` consulta `/account/credentials?type=email-authenticator` no issuer configurado. Exige resposta JSON inequívoca, limita a leitura a 64 KiB e o prazo a 5 segundos; redirecionamentos são recusados. Falha não significa opção desativada.

O access token fica exclusivamente na sessão server-side, cifrado com AES-256-GCM e ligado a issuer/subject. A chave deriva de SESSION_SECRET por HKDF. A validade é limitada ao menor valor entre a expiração emitida e 300 segundos; não é guardado refresh token. Expiração produz `ACCOUNT_REAUTH_REQUIRED` e uma ação explícita de confirmação de sessão. Mudança de SESSION_SECRET invalida esta credencial. Não exportar o conteúdo das sessões para diagnóstico.

POST `/api/auth/account-security/email` aceita apenas a ação enable/disable, sob sessão, origem e CSRF. O retorno é fixo em `/conta/seguranca`; a identidade do callback deve corresponder à iniciadora. A UI consulta novamente o estado: redirect e parâmetros de retorno não comprovam ativação/desativação.

O cancelamento de um novo login não cria uma sessão autorizada e apresenta um link para nova tentativa, sem ciclo automático. Uma sessão previamente autorizada não é invalidada só por cancelar uma ação de conta. Erros e expiração são apresentados sem assumir sucesso. Não há códigos/tokens em localStorage nem códigos em URLs.

## Operação e limites

Usar o entrypoint normal `npm start` em backend, com os perfis funcionais e configuração da composição autónoma. Não instalar extensões nem provisionar realms no arranque da API. O ensaio não injeta ports funcionais no processo.

Recuperação após perda do email continua sem procedimento aprovado: não existe bypass informal. Não alterar contas existentes automaticamente. Compatibilidade de upgrades do Keycloak, SMTP externo, múltiplos nós e operação na VPS exigem validação própria. Preservar a chave do componente segundo o procedimento da extensão; a chave da sessão APP não a substitui.
