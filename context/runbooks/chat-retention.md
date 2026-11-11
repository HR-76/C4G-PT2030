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

## VPS (produção) — por implementar

Exige, antes de ativar:

1. Um adaptador de produção para `listTenants`/`openTenant` (organizações e credenciais de tenant a partir do diretório Central) que ainda não existe.
2. Um login de base de dados por tenant, só com o papel `c4g_chat_retention_runtime` (a função não está acessível a mais ninguém), provisionado como os restantes logins de serviço. Não reutilizar o login do worker de importações.
3. A migração 040 aplicada em cada tenant, com cópia de segurança e autorização.

Modelo do timer (a ajustar ao comando de produção):

```ini
# /etc/systemd/system/c4g-chat-retention.service
[Service]
Type=oneshot
ExecStart=/usr/bin/node /opt/c4g/backend/scripts/chatRetentionRun.js
User=c4g
# /etc/systemd/system/c4g-chat-retention.timer
[Timer]
OnCalendar=*-*-* 03:00:00 Europe/Lisbon
Persistent=true
[Install]
WantedBy=timers.target
```

## Verificar e operar

- Ver o último resultado: `Get-Content .tmp/local-platform/logs/chat-retention.log -Tail 20`; procurar `CHAT_RETENTION_RUN_DONE` com `failures: 0` e `incomplete: 0`.
- Alerta mínimo: saída ≠ 0 ou ausência de `CHAT_RETENTION_RUN_DONE` há mais de 36 horas.
- As eliminações ficam em `opportunity_catalog.application_chat_purge` (candidatura, contagem, datas; sem texto).
- A primeira execução cria um registo, mesmo com 0 mensagens, para cada candidatura final com mais de 90 dias; é esperado e não se repete.
