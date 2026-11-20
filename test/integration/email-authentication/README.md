# Personalização do email nativo de recuperação

Personalização nativa e ligação ao editor através de publicação restrita implementadas e validadas em Keycloak 26.8.0 local descartável em 15/11/2026. A integração fica desligada por omissão e não está publicada no staging.

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

O teste usa recuperação pública, partes MIME reais, duração do Keycloak, localização `pt`/`en`, caracteres especiais e HTML sanitizado. Verifica alteração efetiva da credencial (password grant exclusivo do cliente fictício), recusa de reutilização/expiração e igualdade da resposta para conta desconhecida sem novo email. Não mede resistência à enumeração por tempo. Verifica a referência HTTPS do logótipo no HTML, sem descarregar a imagem. Sem `--restricted-publisher`, a prova de permissões confirma apenas que uma conta sem funções é recusada.

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
6. Provar publicação restrita antes de ativar o editor: a API nativa exige `manage-realm`. Não conceder essa função à aplicação. O incremento abaixo usa uma extensão dedicada com versionamento/auditoria e erros fechados.

Não há alteração à base Central, runtime, conta de serviço ou tema de staging neste incremento. Histórico dos três tipos e retenção efetiva de destinatários por 90 dias permanecem pendentes; o código por email depende do componente externo ausente.

## Publicação restrita e editor — 15/11/2026

Compilar primeiro a [extensão própria](../../../dev/keycloak/email-templates/README.md) e executar a prova completa no mesmo âmbito local já autorizado:

```powershell
python -B dev/keycloak/email-templates/build.py
node dev/keycloak/email-templates/test/contracts.cjs
python -B test/integration/email-authentication/keycloak_gate.py --authorized-local --restricted-publisher
```

O gate instala o JAR na cópia nova, deixa o Keycloak criar apenas as tabelas próprias nessa base descartável e provisiona uma conta de serviço com audiência e função explícitas, sem administração nativa do realm. O cliente real Node e o serviço de templates são exercitados por `restricted-publisher-client.cjs`; a autorização Central usa um double de leitura, não uma base habitual. Credenciais chegam ao processo Node exclusivamente por stdin, sem ficheiro/argumento de comando. `restricted_probe.py` verifica o contrato HTTP do SPI e a publicação em mensagens realmente capturadas. Não é um teste do editor num navegador nem da Central real.

[Resultado H2](evidence-restricted-h2-20261115.json): 46 verificações aprovadas, seis emails capturados, serviços encerrados e base removida. SAVE/RESET, leitura, sanitização, revogação, cliente/realm/utilizador errados, ausência de administração do realm, conflito concorrente, repetição idempotente, recusa de revisão superada, alterações externas e preservação de SMTP/fluxos/outras traduções passaram. Esta primeira execução usou `fullScopeAllowed=true` sem papéis administrativos; o harness foi depois reforçado para provar `false` com scope mapping explícito e recusa de override nativo antes da primeira versão.

Na composição da aplicação, `EMAIL_AUTHENTICATION_RUNTIME=keycloak-restricted-v1` e `EMAIL_AUTHENTICATION_CLIENT_SECRET` ativam o adaptador, usando o issuer OIDC já configurado. O valor omitido/`disabled` mantém a funcionalidade indisponível. O segredo pertence exclusivamente ao backend. Só há acesso ao token endpoint e ao recurso restrito; nunca `/admin`. A lista e a rota de edição só ficam disponíveis se o estado publicado for verificável. HTTP apenas em loopback fora de produção; HTTPS exigido em produção. Não foram provisionadas credenciais nem alteradas configurações habituais.

### PostgreSQL temporário e regressão de concorrência

Atualização de 15/11: [PostgreSQL 17.11](evidence-restricted-postgres17-20261115.json) também aprovado, 51 verificações, seis capturas, serviços encerrados e base removida. Binários ZIP EDB `postgresql-17.11-3-windows-x64-binaries.zip`, SHA-256 observado `4b8db0930c38f6ef845db919551dedda3b6b845aeb0927b3d79a6e8e9e4537cf`; selecionados com `C4G_EMAIL_POSTGRES_BIN` apontando para `.tmp/postgres17-email/pgsql/bin`. O helper aceita versões 17/18. A primeira tentativa falhou na inicialização durante a extração ainda incompleta; a prova aprovada usou uma instalação completa e base nova. Implantação autorizada condicionalmente pelo utilizador, mas SSH expirou antes da autenticação; continuação pela consola VPS operada pelo utilizador, sem alteração remota até agora.

Com os binários PostgreSQL 18 em `C:/Program Files/PostgreSQL/18/bin`:

```powershell
python -B test/integration/email-authentication/test_temporary_postgres.py
python -B test/integration/email-authentication/keycloak_gate.py --authorized-local --restricted-publisher --postgres-temporary
```

O helper cria um cluster próprio dentro da pasta aleatória do gate: porta de loopback, conta/base/password aleatórias e SCRAM. Não lê PGDATA, serviços ou credenciais habituais, não regista um serviço Windows e não persiste logs. Confirma o diretório real do servidor e a posse da pasta/PID antes de parar/remover. Os oito testes dos guards não iniciam PostgreSQL. As queries de evidência devolvem apenas contagens e booleanos, sem conteúdos, IDs ou endereços.

**[Resultado final](evidence-restricted-postgres-20261115.json): 51 PASS, zero falhas, PostgreSQL 18.6, seis emails capturados; serviços encerrados e base removida.** Uma cabeça e três versões, auditoria da conta dedicada, intenções únicas, colunas `text` e igualdade das mensagens nativas confirmadas diretamente na base. A prova de rollback introduz temporariamente uma constraint apenas nesta base: a publicação falha, a constraint é removida no `finally` e a revisão/textos mantêm-se.

A prova de concorrência mantém uma escrita SQL de uma chave não gerida (`probeSentinel`) aberta, confirma em `pg_blocking_pids` que a publicação espera e só depois confirma a escrita. No [artefacto anterior](evidence-restricted-postgres-red-20261115.json), 50 verificações passaram e a preservação dessa chave falhou. Com o bloqueio ordenado das linhas de localização antes do refresh, a mesma prova passou. A [primeira execução PostgreSQL](evidence-restricted-postgres-initial-20261115.json), com 49 verificações, antecedeu a inclusão destes casos. Cada ficheiro identifica o SHA-256 do JAR efetivamente usado.

Para repetir a comparação nesta cache, o gate aceita `--provider-jar .tmp/email-templates-build/c4g-email-templates-before-locale-lock.jar`; só aceita artefactos sob `.tmp` e exige `--restricted-publisher`. Esse JAR é a versão anterior guardada nesta sessão, não o artefacto para implantação. As cópias de runtime desta prova foram removidas após arquivar os resultados; ficam o ZIP verificado e a cache de compilação.

Limites: não prova PostgreSQL 17, tema/configuração de staging, Central real ou navegador. O runtime local habitual tem configuração própria e não encaminha automaticamente as flags acima. Histórico de versões não é histórico de envios: este último e os 90 dias continuam pendentes.

Referências oficiais verificadas (26.8.0):

- [Template HTML](https://github.com/keycloak/keycloak/blob/26.8.0/themes/src/main/resources/theme/base/email/html/password-reset.ftl)
- [Template texto](https://github.com/keycloak/keycloak/blob/26.8.0/themes/src/main/resources/theme/base/email/text/password-reset.ftl)
- [Provider de email](https://github.com/keycloak/keycloak/blob/26.8.0/services/src/main/java/org/keycloak/email/freemarker/FreeMarkerEmailTemplateProvider.java)
- [Permissões de localização](https://github.com/keycloak/keycloak/blob/26.8.0/services/src/main/java/org/keycloak/services/resources/admin/RealmLocalizationResource.java)
