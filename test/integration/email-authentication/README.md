# Personalização do email nativo de recuperação

Preparação local; não está publicada no Keycloak nem ligada ao editor da aplicação.

## Executar sem serviços externos

Na raiz do repositório:

```powershell
node --test backend/test/keycloakPasswordResetTemplate.test.js backend/test/emailTemplates.test.js
node backend/scripts/staging/preparePasswordResetEmail.js
$env:C4G_EMAIL_JAVA = 'C:/Program Files/Java/jdk-23/bin/java.exe'
node test/integration/email-authentication/message-format.cjs
```

O preparador escreve JSON com as três chaves nativas. Aceita opcionalmente o caminho de um JSON com exatamente `subject` e `html`; nunca publica, envia emails ou lê credenciais. Se a sanitização remover conteúdo, recusa a exportação para obrigar à revisão. O compilador de domínio devolve também a lista de elementos removidos para o futuro editor.

O probe Java verifica nove casos com `java.text.MessageFormat` real: apóstrofos, chavetas adjacentes, tentativas de introduzir argumentos posicionais/choice, acentos, duração e logótipos repetidos. Não prova FreeMarker, o sanitizador do Keycloak, a localização escolhida, SMTP ou receção. Requer JDK 11+; `C4G_EMAIL_JAVA` é opcional se `java` no PATH for um JDK funcional.

## Prova necessária antes de publicação

Usar Keycloak 26.8.0 e um capturador SMTP descartáveis, com autorização para esse âmbito. Não reutilizar realm, SMTP, volumes ou base de staging. Não enviar para Resend nesta prova.

1. Criar realm e utilizador fictícios, cliente OIDC e SMTP de captura; confirmar o tema de email nativo.
2. Publicar só `passwordResetSubject`, `passwordResetBody` e `passwordResetBodyHtml` na localização selecionada. Conservar outra chave sentinela e provar que permanece igual.
3. Iniciar a recuperação pelo formulário público. `execute-actions-email` usa outro template e **não** valida estas três chaves.
4. Inspecionar a mensagem capturada: assunto, HTML, texto, link real utilizável, validade formatada e logótipo público C4G quando fornecido. Repetir com apóstrofos, chavetas, conteúdo sanitizado e idioma efetivo do utilizador.
5. Concluir a recuperação; provar recusa de reutilização/expiração e resposta sem enumeração para conta desconhecida.
6. Provar publicação restrita antes de ligar o editor: a API nativa exige `manage-realm`. Não conceder essa função à aplicação. Ainda falta implementar a fronteira restrita, versionamento/auditoria e tratamento de falhas.

Não há alteração à base Central, runtime, conta de serviço ou tema de staging neste incremento. Histórico dos três tipos e retenção efetiva de destinatários por 90 dias permanecem pendentes; o código por email depende do componente externo ausente.

Referências oficiais verificadas (26.8.0):

- [Template HTML](https://github.com/keycloak/keycloak/blob/26.8.0/themes/src/main/resources/theme/base/email/html/password-reset.ftl)
- [Template texto](https://github.com/keycloak/keycloak/blob/26.8.0/themes/src/main/resources/theme/base/email/text/password-reset.ftl)
- [Provider de email](https://github.com/keycloak/keycloak/blob/26.8.0/services/src/main/java/org/keycloak/email/freemarker/FreeMarkerEmailTemplateProvider.java)
- [Permissões de localização](https://github.com/keycloak/keycloak/blob/26.8.0/services/src/main/java/org/keycloak/services/resources/admin/RealmLocalizationResource.java)
