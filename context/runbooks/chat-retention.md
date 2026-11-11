# Retenção do chat — executor periódico

Decisão de 11/11/2026: **comando de uma só execução, todos os dias às 03:00 (Lisboa)**, lançado pelo agendador do sistema. Regra de negócio e critérios: [contrato](../features/application-chat-retention.md).

## Como funciona

`runChatRetention` (`backend/src/applications/chatRetentionRunner.js`) percorre as organizações que o adaptador lista, chama `createChatRetentionService` em lotes de 50 candidaturas até não haver mais (limite de 200 lotes por organização) e escreve uma linha JSON por evento. Uma organização que falha não impede as seguintes. Os registos têm só contagens e identificadores, nunca texto de mensagens. A função SQL é a autoridade: mínimo de 90 dias, só estados finais, uma organização por chamada. Repetir o comando é seguro.

Códigos de saída: `0` concluído, `1` falhas ou trabalho por terminar (lote cheio no limite), `2` não preparado (migração 040 em falta ou destino diferente do esperado).

## Perfil local (Windows)

`backend/scripts/localPlatform/chatRetentionRun.js`, para `c4g_tenant_dev` na 5432. Liga-se com o administrador PostgreSQL local e atua como `c4g_chat_retention_runtime`.

```powershell
npm --prefix backend run retention:chat:local -- --check     # só verifica destino e esquema; não elimina
npm --prefix backend run retention:chat:local                 # executa a eliminação agora
npm --prefix backend run retention:chat:local:schedule        # regista a tarefa diária 03:00
powershell -NoProfile -File backend/scripts/localPlatform/scheduleChatRetention.ps1 -Remove   # remove a tarefa
```

A tarefa chama-se «C4G chat retention», acrescenta ao registo `.tmp/local-platform/logs/chat-retention.log` e usa a hora do Windows: manter o PC no fuso de Lisboa. `StartWhenAvailable` corre a tarefa em atraso se o PC estava desligado às 03:00; não corre em paralelo consigo própria.

## VPS (produção)

Executor: `backend/src/chatRetention.js` (`npm --prefix backend run retention:chat`), com a infraestrutura em `backend/src/config/chatRetentionInfrastructure.js`. Mesmo modelo de confiança do worker de documentos:

- **Organizações e credenciais:** lista explícita em `CHAT_RETENTION_CREDENTIALS_JSON` (um objeto por organização, `workload: 'WORKER'`, com `organizationId`, `tenantId`, `connectionVersion`, `credentialRef`, `databaseGenerationId`, `host`, `port`, `database`, `login`, `password`, `ssl`; máximo 100). Guardar no gestor de segredos, nunca no Git.
- **Identidade:** é o login WORKER que o diretório Central já tem registado para o tenant; não há login novo nem workload novo. O executor confirma o binding com a Central (`AUTHORITY_DATABASE_URL`, `AUTHORITY_COMMIT_PERMIT_SECRET`), que o login é limitado (sem herança, superutilizador, `BYPASSRLS`, etc.), que a cadeia de papéis é exatamente a esperada e que o esquema está na 040 com a capacidade `APPLICATION_CHAT_RETENTION`. Qualquer falha conta como falha dessa organização e não corre nada nela.
- **Opcionais:** `CHAT_RETENTION_DAYS` (por omissão e mínimo 90), `CHAT_RETENTION_BATCH_SIZE` (50, máx. 500), `CHAT_RETENTION_MAX_BATCHES` (200).

### Provisionamento (uma vez por tenant, como administrador, depois de aplicar a 040)

```sql
GRANT c4g_chat_retention_runtime TO c4g_tenant_worker_capabilities WITH SET TRUE, INHERIT FALSE, ADMIN FALSE;
```

Contrapartida aceite (decisão de 11/11/2026): o agregador é partilhado, por isso **todos os logins WORKER desse tenant** (documentos, importações, receitas, retenção) passam a poder executar a função de eliminação através de `SET ROLE`. Está limitada a candidaturas fechadas há 90 ou mais dias, só apaga o chat e nunca texto de outros dados. Os restantes workers toleram a presença deste papel (`validateLocalTenantRoleChain`) sem o exigirem. Para retirar: `REVOKE c4g_chat_retention_runtime FROM c4g_tenant_worker_capabilities;`.

### Timer (systemd)

```ini
# /etc/systemd/system/c4g-chat-retention.service
[Service]
Type=oneshot
WorkingDirectory=/opt/c4g/backend
EnvironmentFile=/etc/c4g/chat-retention.env
ExecStart=/usr/bin/node src/chatRetention.js
User=c4g
# /etc/systemd/system/c4g-chat-retention.timer
[Timer]
OnCalendar=*-*-* 03:00:00 Europe/Lisbon
Persistent=true
[Install]
WantedBy=timers.target
```

`/etc/c4g/chat-retention.env` (permissões 600) contém as variáveis acima. Ativar com `systemctl enable --now c4g-chat-retention.timer`.

### Ainda não validado

Não há VPS nem diretório Central de produção neste ambiente: a infraestrutura foi testada com portas simuladas (binding, login limitado, esquema, recusas) e a identidade com um login real num PostgreSQL 17 descartável (cadeia de papéis validada pela função existente e eliminação por `SET ROLE`). Falta correr contra o diretório Central real e um tenant real, com autorização própria.

## Verificar e operar

- Ver o último resultado: `Get-Content .tmp/local-platform/logs/chat-retention.log -Tail 20`; procurar `CHAT_RETENTION_RUN_DONE` com `failures: 0` e `incomplete: 0`.
- Alerta mínimo: saída ≠ 0 ou ausência de `CHAT_RETENTION_RUN_DONE` há mais de 36 horas.
- As eliminações ficam em `opportunity_catalog.application_chat_purge` (candidatura, contagem, datas; sem texto).
- A primeira execução cria um registo, mesmo com 0 mensagens, para cada candidatura final com mais de 90 dias; é esperado e não se repete.
