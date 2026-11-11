# Janela controlada e backups renovados

Pedido de 30/10/2026 concluído: **PASS**. Consumidores habituais pausados, backups renovados e restaurados sem divergência, serviços retomados. **Ativação não executada.**

## Evidência

- Janela: `output/organizational-opportunity-interest/window-f6ac2800-1138-4ca4-a2d3-143f73776a82.json`.
- Restauro: `output/organizational-opportunity-interest/backup-restore-ce08320b-bd74-45a9-b64b-1a5fa090a85d.json`.
- Pacote protegido renovado: `.tmp/local-platform/interest-backup-ce08320b-bd74-45a9-b64b-1a5fa090a85d/`.
- Pausa confirmada às **22:03:02 UTC**; backup/restauro concluídos às **22:03:17 UTC**; saúde restabelecida às **22:03:39 UTC**. Aproximadamente 37 segundos entre pausa confirmada e prontidão.

Conferida a árvore do supervisor35388 por executável, argumentos, filiação, instante de criação e propriedade dos endpoints3000/5000. Seis processos identificados: supervisor, nodemon, API, worker de recolha, Vite e worker de admissões. Não foram terminados processos desconhecidos, sessões PostgreSQL, PostgreSQL ou Keycloak.

Antes da paragem, locks SHARE transitórios nas tabelas das duas bases impediram novas escritas e aguardaram transações concorrentes. Contagens de recolhas RUNNING, execuções CLAIMED/RUNNING, inbox PROCESSING e outbox CLAIMED: **todas zero**. Usado o mecanismo Windows de encerramento da árvore que o supervisor existente já utiliza. Locks libertados por ROLLBACK; nenhum DML ou DDL de manutenção aplicado às bases habituais. Confirmadas zero sessões externas após a paragem; filas existentes não foram apagadas nem canceladas.

## Resultado do backup renovado

- Central035: 74 tabelas, dump de 9 091 454 bytes, dados/sequências e preflight original PASS.
- Tenant030: 136 tabelas, dump de 2 001 549 bytes, dados/sequências, ledger histórico e preflight original PASS.
- Nas duas bases: `sourceStillMatches=true`, listas de tabelas alteradas vazias, `activationRequiresFreshBackup=false` **no fim da janela pausada**.
- Sete ficheiros privados copiados, hashes conferidos e originais inalterados. Proteção Windows ao utilizador e SYSTEM mantida.
- Roles sem hashes de passwords e suplemento exato das 16 ACLs incluídos conforme [procedimento de restauro](backup-restore.md).
- PostgreSQL18 de restauro encerrado; backup e cluster parado conservados na pasta protegida.

O plano privado de ativação foi renovado dentro da pausa: Central035, tenant030, preflight PASS, uma membership ORG_ADMIN elegível e três permissões de interesses a acrescentar. Nenhuma migração031/032/033, concessão funcional ou alteração de configuração foi executada.

O supervisor habitual foi retomado em processo oculto (PID4072), com o mesmo comando `node scripts/start-local.cjs`. Health HTTP200 com `ready`, `workerReady` e `admissionReady` verdadeiros. O procedimento tem retoma em `finally`, inclusive após falha parcial da pausa ou do backup. Logs privados em `.tmp/local-platform/interest-window-f6ac2800-1138-4ca4-a2d3-143f73776a82.*.log`.

## Reutilização e validade

```powershell
node scripts/interest-maintenance.cjs --renew-backups
```

O comando recusa modos/destinos alternativos. Tem até120 segundos para obter um momento sem trabalho em execução, timeouts de locks e validação de ausência de sessões desconhecidas. Não tem modo apply. As duas bases são copiadas por snapshots próprios enquanto os consumidores estão parados; isto não transforma o PostgreSQL numa transação distribuída.

A janela foi encerrada para devolver o serviço habitual ao utilizador. Escritas normais podem ocorrer após22:03:39; a evidência não é uma autorização permanente nem garante ausência de divergência futura. A ativação deve reabrir uma janela equivalente, revalidar o plano e renovar as cópias se necessário, seguindo imediatamente para os passos autorizados antes de retomar os consumidores.

Três testes do orquestrador PASS: recusa de argumentos/trabalho ativo, retoma em sucesso/falhas e falha explícita se a retoma falhar. Sintaxe Node e execução PowerShell real validadas. Suites: backend1787 PASS/1 FAIL preexistente em `fundingEnrichmentPersistence.test.js:33`/7 SKIP; frontend461 PASS/build PASS. Logs `output/organizational-opportunity-interest/*-window.log`. Recheck final22:04:45 UTC PASS: porta da instância de restauro fechada, PID ausente e saúde habitual pronta; `window-final-check.json`.

Próximo passo: executar a ativação031–033 e as permissões previstas numa janela explicitamente autorizada, com revalidação imediata da baseline.
