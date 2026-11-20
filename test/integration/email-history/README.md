# Histórico de envios — prova e implantação

## Provas isoladas

`node test/integration/email-history/gate.cjs` cria PostgreSQL 18 próprio em loopback, aplica o manifesto Central até 055 e instala 056 pelo runner registado. Repete a instalação, verifica fingerprints e permissões, prova concorrência/idempotência, recusa leitura direta da tabela, preservação de ACCEPTED e anonimização física de sucessos/falhas/replays. Não usa bases habituais. A pasta temporária fica para diagnóstico, com o servidor encerrado.

Variantes independentes: `ENTITY_TYPE_GATE_STAGING_LOGINS=1` e `ENTITY_TYPE_GATE_USER_DELETION=1`. Não combinar variantes sem nova prova. `EMAIL_HISTORY_GATE_CALIBRATE=1` serve exclusivamente para medir fingerprints na base descartável; não é um instalador.

Keycloak: `python -B test/integration/email-authentication/keycloak_gate.py --authorized-local --restricted-publisher --postgres-temporary`, com `C4G_EMAIL_POSTGRES_BIN` a apontar para os binários próprios PostgreSQL 17. A evidência em `evidence-keycloak-postgres17.json` inclui seis capturas SMTP, uma falha SMTP nativa, permissão de leitura separada da publicação, revogação, anonimização física via API e pelo temporizador autónomo do Keycloak. Contas/endereço `.invalid`, segredos em memória, nenhum email externo. Mantém as provas anteriores de publicação/recuperação.

Referência do ponto de captura: [ResetCredentialEmail do Keycloak 26.8.0](https://github.com/keycloak/keycloak/blob/26.8.0/services/src/main/java/org/keycloak/authentication/authenticators/resetcred/ResetCredentialEmail.java). O listener só observa os dois eventos nativos de resultado; não fornece autenticador. A persistência JPA participa na transação nativa: uma falha/rollback dessa transação pode impedir o recibo mesmo após aceitação SMTP. Não prometer um comprovativo de entrega nem recuperar esse caso reenviando o email.

## Ordem de implantação pela VPS

Sem implantação automática. Usar uma revisão enviada para o remoto e checkout de release isolado, preservando `/srv/c4g-staging/src`, imagens atuais, configurações Compose, frontend e backups. Os scripts abaixo já pertencem ao código da release; não estão presentes nos contentores antigos.

1. Confirmar a versão Central e as imagens API/worker efetivamente ativas. Admite 055 nas variantes medidas. Se houver outra migração ou uma combinação de variantes não medida, parar no preflight. Preparar backup Central e Keycloak e guardar as imagens/configurações ativas.
2. A partir da raiz da release, preparar o artefacto sem tocar no Keycloak em execu��o:

   ```bash
   docker build -f dev/keycloak/email-templates/Dockerfile -t c4g-email-history-provider:build dev/keycloak/email-templates
   ARTIFACT=$(docker create c4g-email-history-provider:build unused)
   docker cp "$ARTIFACT:/c4g-email-templates.jar" ./c4g-email-templates.jar
   docker rm "$ARTIFACT"
   sha256sum ./c4g-email-templates.jar
   ```

   Compilar o novo JAR com as bibliotecas oficiais Keycloak 26.8.0 e JDK 21 ou superior (`--release 21`). Preservar `c4g-manual-activation.jar` e os mounts existentes. Instalar o novo JAR de templates e recriar só o serviço Keycloak. Verificar realm acessível e recurso restrito a recusar anónimos. Esta instalação acrescenta a tabela do listener, mas ainda não ativa a recolha no realm.
3. Construir imagens API **e worker** com o código desta release e as alterações específicas do staging preservadas. Arrancar ambos com `EMAIL_HISTORY_RUNTIME=disabled`; a versão nova aceita 055 e 056. Não deixar o worker antigo ligado depois de migrar: os leitores antigos não reconhecem 056. Validar saúde antes da migração.
4. No contexto privado do migrador (não com as credenciais runtime), executar `node backend/scripts/installEmailDelivery.js` para preflight e depois `node backend/scripts/installEmailDelivery.js --apply`, com `CENTRAL_MIGRATION_DATABASE_URL` apenas no ambiente. Os dois comandos não imprimem a ligação. O runner recusa deriva e aplica a migração atomicamente; nunca executar o SQL candidato à mão na VPS.
5. No checkout isolado, executar o configurador abaixo. Acrescenta apenas o listener e o papel `read-delivery-history` à conta já existente, preservando os restantes listeners, SMTP, fluxos e temas. O backup contém configuração privada, tem modo 0600 e não deve ser enviado ao chat.

   ```bash
   python3 backend/scripts/staging/configureEmailHistory.py
   python3 backend/scripts/staging/configureEmailHistory.py --apply \
     --backup-directory /srv/c4g-staging/patches/EMAIL_RELEASE/keycloak-history-before
   ```

   `EMAIL_RELEASE` é a pasta nova desta implantação. O primeiro comando apenas valida a configuração de base. O segundo deve terminar em `KEYCLOAK_EMAIL_HISTORY_READY`; não envia mensagens. Se o armazenamento nativo de eventos já estiver ligado, limita também a sua expiração a no máximo 90 dias; não o liga se estiver desligado.

6. Ativar `EMAIL_HISTORY_RUNTIME=central-keycloak-v1` apenas na API, mantendo o publicador já configurado e o respetivo segredo privado. A readiness executa a limpeza nas duas origens antes de aceitar a ativação. A API repete a limpeza a cada minuto; o Keycloak tem temporizador independente com a mesma frequência. Uma API desligada recupera a limpeza Central ao arrancar. Leituras ocultam imediatamente endereços vencidos, mesmo antes da passagem seguinte do executor.
7. Construir/publicar o frontend desta release, com backup da configuração Caddy e verificação da página servida. Confirmar Administração → Email → Histórico de envios. Começa sem retrocarga inventada. Um convite/teste e uma recuperação iniciados explicitamente pelo utilizador devem aparecer com destinatário e resultado; não enviar mensagens reais automaticamente como smoke test.

## Recuperação de implantação

Antes de 056, é possível repor as imagens anteriores. Depois de 056, manter imagens compatíveis com 056 e desligar `EMAIL_HISTORY_RUNTIME`; não repor cegamente imagens antigas que só reconhecem 055. A migração é aditiva mas marcada irreversível para preservar os recibos. Não apagar a tabela nem restaurar bases automaticamente. Conservar o JAR com a entidade JPA mesmo que se desligue o listener. Qualquer reposição de backup requer avaliar os dados escritos depois dele.

## Limites

- `ACCEPTED` é aceitação Resend/SMTP, não entrega nem abertura. Sem webhooks de entrega neste incremento.
- Recuperação administrativa por `execute-actions-email` e teste SMTP não são classificados como recuperação pública.
- Sem histórico retroativo. Endereços de contas ativas e convites operacionais têm finalidades próprias; não são a tabela de histórico. Backups/logs têm política própria de acesso e retenção.
- Sem verificação de navegador ou implantação remota nesta prova. Operações na VPS continuam a ser executadas pelo utilizador.

15/11/2026: VPS build at 20d96098 failed because the root .dockerignore excludes dev. Use the provider directory as context and COPY src/main. No installation occurred. Central 055 confirmed; worker Compose differs from API: /srv/c4g-staging/releases/billing-c262040-RWzaGlYY/deploy/staging/compose.yaml.

VPS preparation confirmed by user: /srv/c4g-staging/patches/email-history-20d96098-FXARJJ; Linux JAR SHA256 f180737541932956b7271fbbe485a63075ac976662993a0f0bf920521f4c8d91. Build succeeded with the provider directory context. Keycloak installation and collection activation not yet confirmed.
