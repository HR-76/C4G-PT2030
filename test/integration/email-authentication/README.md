# Personalização do email nativo de recuperação

Personalização nativa validada em Keycloak 26.8.0 local descartável em 15/11/2026. Não está publicada no staging nem ligada ao editor da aplicação.

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

## Gate nativo local autorizado em 15/11/2026

`keycloak_gate.py` cria uma instalação nova em `.tmp/email-keycloak-<aleatório>`, H2 `dev-file` exclusivo e SMTP de captura em memória. Só escuta e faz pedidos HTTP em `127.0.0.1`; o SMTP não tem relay e só aceita endereços `.invalid`. Não usa configuração nem variáveis Keycloak do ambiente habitual. Credenciais aleatórias, emails, cookies e tokens não são impressos nem gravados como evidência. A base é removida e os serviços são encerrados no `finally`, mesmo em falha.

Pré-requisitos: Python 3, Node, JDK em `C:/Program Files/Java/jdk-23/bin/java.exe` e [ZIP oficial 26.8.0](https://github.com/keycloak/keycloak/releases/download/26.8.0/keycloak-26.8.0.zip) guardado em `.tmp/email-authentication-download/keycloak-26.8.0.zip`. O gate exige SHA-256 `7ed1de3fda2598369262613bf682aab7e233d80a38c405e91588f7a7454370a1`, confirmado nos metadados oficiais da release, antes de extrair ou executar.

```powershell
python -B test/integration/email-authentication/test_gate_helpers.py
python -B test/integration/email-authentication/keycloak_gate.py --authorized-local
```

O parâmetro documenta o âmbito; não substitui autorização. O utilizador autorizou esta execução isolada nesta conversa. A evidência de cada execução fica em `evidence.json`, só com resultados, versões, contagens e confirmação de cleanup. Os binários ficam em `.tmp` para diagnóstico, sem a base e sem mensagens capturadas.

O harness tem seis testes próprios: destino HTTP limitado à origem de loopback, recusa de redirecionamento externo, política de cookies restrita a loopback, parsing dos formulários, SMTP sem relay/endereços não fictícios recusados e preservação de UTF-8 na saída do compilador Node no Windows. A exceção de cookies reproduz o contexto seguro de loopback do Keycloak; não desativa validações de domínio, caminho ou expiração. A preparação inicial do Quarkus (saída 10) e o arranque do servidor têm prazos separados. Credenciais inválidas no password grant são verificadas como HTTP 400 com `invalid_grant`.

O teste usa recuperação pública, partes MIME reais, duração do Keycloak, localização `pt`/`en`, caracteres especiais e HTML sanitizado. Verifica alteração efetiva da credencial (password grant exclusivo do cliente fictício), recusa de reutilização/expiração e igualdade da resposta para conta desconhecida sem novo email. Não mede resistência à enumeração por tempo. Verifica a referência HTTPS do logótipo no HTML, sem descarregar a imagem. A prova de permissões confirma apenas que uma conta sem funções é recusada; não implementa a futura fronteira restrita.

## Resultado da prova de 15/11/2026

[Evidência sem segredos](evidence-20261115.json): 14 verificações aprovadas, zero falhas, quatro mensagens capturadas, serviços encerrados e base removida. Os seis testes do harness também passaram. As tentativas de diagnóstico anteriores foram encerradas e as suas bases removidas; o resultado final vem de uma execução completa nova.

Confirmados: assunto, MIME HTML/texto, ligação em ambas as partes, duração formatada, localização `pt`/`en`, apóstrofos e chavetas, sanitização e referência do logótipo. A recuperação alterou a credencial: nova palavra-passe devolveu token; antiga foi recusada com HTTP 400 `invalid_grant`. Ligação reutilizada/expirada recusada. Conta desconhecida teve a mesma resposta visível e não gerou mensagem. Publicação preservou SMTP, fluxos e uma chave sentinela. Conta de serviço sem funções recebeu 403 e não alterou o texto.

Só foram necessários ajustes no harness: cookies de loopback, UTF-8 explícito entre Node/Python, código OAuth esperado e preservação dos campos do utilizador no PUT de mudança de idioma. O compilador da aplicação não precisou de alteração. O envio real por Resend, a base Central, o histórico e a extensão do código por email ficaram fora desta prova.

As cópias extraídas usadas na prova foram removidas após diagnóstico; ficaram o ZIP oficial verificado em `.tmp/email-authentication-download` e evidências sem segredos. O teste volta a criar uma cópia nova ao executar.

## Critérios da prova e limite de publicação

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
