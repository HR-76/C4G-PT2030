# Runbook: cópias de segurança do staging para o R2

Contrato: [staging-backups](../features/staging-backups.md). Tudo corre na VPS, como `root`, em `/srv/c4g-staging/`. Nenhum comando imprime segredos. Pasta no R2: `backups/staging/` no bucket de documentos (`C4G_R2_DOCUMENTS_BUCKET` do `/srv/c4g-staging/r2.env`).

Pressupostos: R2 e imagem da API já ligados (runbook «Armazenamento privado» do `deploy/staging/README.md`); a imagem tem de conter `scripts/staging/r2Backup.js`, ou seja, ser construída de um commit que inclua esta feature.

## 1. Código e imagem

```bash
cd /srv/c4g-staging/src && git fetch origin && git checkout staging-vps && git pull --ff-only
export C4G_RELEASE=$(git rev-parse --short HEAD); echo "$C4G_RELEASE"
docker compose -f deploy/staging/compose.yaml build
```

Não é preciso reiniciar a API para os backups; o `build` basta para a imagem existir. (Se também quiser a API nova, siga o README.)

## 2. Chave de cifra (uma vez)

```bash
install -d -m 700 /srv/c4g-staging/backup
[ -e /srv/c4g-staging/backup/backup.key ] || (umask 077; openssl rand -base64 48 > /srv/c4g-staging/backup/backup.key)
ls -l /srv/c4g-staging/backup/backup.key
```

**Guarde já uma cópia da chave fora da VPS** (gestor de palavras-passe). Sem ela, perdida a VPS, as cópias no R2 não se abrem. Para a ver e copiar, num terminal que ninguém esteja a ver (não a cole em chats nem tickets):

```bash
cat /srv/c4g-staging/backup/backup.key
```

A chave nunca deve ser mudada sem decidir o que fazer às cópias antigas: cada cópia só se abre com a chave com que foi cifrada.

## 3. Primeiro ensaio manual

```bash
bash /srv/c4g-staging/src/deploy/staging/backup/backup.sh
```

Esperado: linhas JSON `dump`, `upload`, `prune` e `status`; no fim, para cada base, `"ok":true`. Se algo falhar, aparece só um código (por exemplo `BACKUP_KEY_MISSING`, `BACKUP_IMAGE_MISSING`, `R2_BACKUP_FAILED BACKUP_R2_FAILED`). `BACKUP_R2_FAILED` quase sempre é permissão do token: precisa de leitura e escrita (e apagar) de objetos no bucket de documentos.

Veja o que ficou no R2:

```bash
docker run --rm --user 0:0 --env-file /srv/c4g-staging/r2.env c4g-staging-api:$C4G_RELEASE node scripts/staging/r2Backup.js list --database c4g_central_staging
```

## 4. Teste de restauro

```bash
bash /srv/c4g-staging/src/deploy/staging/backup/restore-test.sh
```

Descarrega a última cópia de cada base, decifra e restaura num PostgreSQL 18 descartável (contentor `c4g-restore-test-*`, sem rede, removido no fim). Esperado, por base, uma linha como:

```json
{"database":"c4g_central_staging","restore":"ok","auditEvents":758,"manifestAuditEvents":758,"tables":40,"manifestTables":40}
```

e `restore-test-ok` no fim, com código 0. Qualquer `RESTORE_FAIL <base> <passo>` indica onde falhou (`no-copy-in-r2`, `decrypt`, `copy`, `roles`, `create`, `pg_restore`). Em `pg_restore` mostram-se até 5 linhas do erro (nomes de objetos, sem dados). Cole-me essa saída se falhar.

O teste não toca nas bases do staging. Prova que a cópia abre e que os dados voltam; não prova um ensaio de recuperação completo (rede, API, Keycloak).

## 5. Agendamento

Diário às 02:30 UTC (cópia, limpeza e estado) e semanal ao domingo às 05:30 UTC (teste de restauro):

```bash
cd /srv/c4g-staging/src/deploy/staging/backup
cp c4g-staging-backup.service c4g-staging-backup.timer c4g-staging-restore-test.service c4g-staging-restore-test.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now c4g-staging-backup.timer c4g-staging-restore-test.timer
systemctl list-timers 'c4g-staging-*'
```

Os temporizadores têm `Persistent=true`: se a VPS estiver desligada à hora, correm no arranque. Os serviços usam o commit em `/srv/c4g-staging/src`, por isso a imagem `c4g-staging-api:<commit>` desse checkout tem de existir. **Depois de cada `git pull`, construa a imagem** (passo 1) ou a próxima cópia falha com `BACKUP_IMAGE_MISSING`.

Verificar a última execução e o estado:

```bash
journalctl -u c4g-staging-backup.service -n 30 --no-pager
docker run --rm --user 0:0 --env-file /srv/c4g-staging/r2.env c4g-staging-api:$C4G_RELEASE node scripts/staging/r2Backup.js status --database c4g_central_staging --database c4g_tenant_staging
```

`status` devolve código 1 se uma base não tiver cópia ou a última tiver mais de 36 h.

## Retenção

14 cópias diárias e 8 semanais (a mais recente de cada semana ISO), por base; a mais recente nunca se apaga. Simulação, sem apagar:

```bash
docker run --rm --user 0:0 --env-file /srv/c4g-staging/r2.env c4g-staging-api:$C4G_RELEASE node scripts/staging/r2Backup.js prune --database c4g_central_staging --database c4g_tenant_staging
```

O `backup.sh` aplica-a (`--apply`) no fim de cada cópia, só sobre objetos que o código reconhece sob `backups/staging/`.

## Recuperar numa emergência

1. Num servidor com Docker e a chave de cifra, descarregar a cópia: `r2Backup.js latest --database <base> --out /b/x.enc --manifest-out /b/x.json` (com `-v <pasta>:/b`).
2. Decifrar: `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass file:<chave> -in x.enc -out x.dump`.
3. Restaurar com `pg_restore` para uma base nova (UTF8, ICU `und`, UTC) depois de criar os papéis `c4g_*` listados em `x.json`.

Use o mesmo procedimento do `restore-test.sh` como referência. Não restaure por cima das bases em uso sem decisão sua.

## Limites

- Não cobre a base do Keycloak (`c4g-staging-keycloak-db-1`): perdê-la significa perder as contas de login. Seguimento a decidir.
- A cópia e a credencial partilham o bucket de documentos; quem tiver o token pode apagar cópias. Recomenda-se um bucket e um token só para backups, com versionamento ou bloqueio de objetos.
- Cópia de um objeto de cada vez, até 500 MB; as bases do staging têm alguns MB.
