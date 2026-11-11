# Backups protegidos e restauro isolado

**Cópia mais recente validada:** [janela controlada de30/10](maintenance-window.md), pacote `interest-backup-ce08320b-bd74-45a9-b64b-1a5fa090a85d`, sem divergência durante a pausa. A evidência abaixo documenta a primeira prova, conservada como histórico.

Pedido explícito executado em 30/10/2026. **Resultado: PASS**, com renovação necessária antes da ativação devido a atividade normal dos serviços Central durante a prova. Não foram aplicadas migrações, grants ou reinícios no ambiente habitual.

## Cópia validada

- Pasta privada: `.tmp/local-platform/interest-backup-f74d86dd-b74d-45e3-bcc5-ede83d780634/`.
- Evidência sem segredos: `output/organizational-opportunity-interest/backup-restore-f74d86dd-b74d-45e3-bcc5-ede83d780634.json`.
- Central035: dump de 8 028 156 bytes; 74 tabelas verificadas; preflight original PASS.
- Tenant030: dump de 2 001 549 bytes; 136 tabelas verificadas; fingerprint canónico e preflight original PASS. Ledger histórico integral preservado.
- Sete ficheiros privados copiados e verificados por SHA-256: backend `.env`, runtime, workers de admissions/members, configuração HTTP/bridge e `.env` de identidade. Conteúdo nunca publicado. Não constitui backup da base do Keycloak ou de armazenamento externo.
- Roles e memberships SQL incluídas, sem hashes de passwords. A prova usa password temporária própria; não testa login dos consumidores com as credenciais habituais. Recuperação dessas credenciais exige o procedimento próprio, preservando as referências da configuração.

A ACL Windows foi restringida ao SID do utilizador e SYSTEM e verificada antes de copiar conteúdo. Proteção por controlo de acesso local, sem alegação de encriptação adicional. Dumps, configuração e cluster encerrado permanecem na pasta protegida; não foram apagados nem enviados para serviços externos.

## Prova realizada

Cada dump custom foi produzido numa transação READ ONLY REPEATABLE READ com snapshot exportado partilhado com o inventário. Comparação de todas as tabelas de utilizador (incluindo ledger, histórico, auditoria e autoridade), sequências e recusa de large objects não inventariados. Não há snapshot distribuído atómico entre as duas bases.

Restauro por `pg_restore --create --exit-on-error` numa nova instância PostgreSQL18, porta efémera, apenas `127.0.0.1`, autenticação SCRAM e pasta própria. Nenhuma API, worker ou integração foi ligada à instância. Roles, ownership e permissões foram restaurados; preflights originais verificaram as duas bases. A instância foi encerrada e a ausência de `postmaster.pid` confirmada.

O `pg_dump` omite concessões explícitas redundantes ao proprietário em `organization_profile.band_policy` e `derivation_policy`. O suplemento protegido `tenant-restore-acl.sql` repõe exatamente 16 entradas observadas no inventário original. Só admite esses objetos, o proprietário conhecido, privilégios enumerados e ausência de entradas adicionais; qualquer outra diferença é recusada. O fingerprint completo é novamente comparado e o preflight executado após o suplemento. Nada foi concedido na base habitual.

SHA-256 dos dumps, configuração e suplemento constam da evidência. O pacote recuperável compreende dumps, roles, configuração e suplemento; não usar apenas `tenant.dump` como prova de equivalência estrutural estrita.

## Atividade habitual e condições restantes

Tenant e ficheiros de configuração permaneceram iguais ao snapshot. A Central recebeu novas escritas dos consumidores existentes em execução assíncrona, auditoria e recolha de fontes. O restauro coincide com o snapshot exportado, mas `activationRequiresFreshBackup=true`: esta prova não autoriza restaurar a Central sobre dados posteriores nem começar a migração com uma cópia desatualizada.

Antes da ativação: confirmar o âmbito autorizado, estabelecer a janela sem writers abrangidos, renovar plano/backups e confirmar coerência Central/tenant/configuração. O script não faz quiescência, não aplica031–033 e não altera grants.

```powershell
node backend/scripts/localPlatform/backupOpportunityInterests.js --backup-and-restore
```

O comando aceita apenas este modo, usa o destino habitual fixo para leitura e cria o seu próprio destino de restauro. Não expõe host, base ou modo apply por argumento. Inicia processos ocultos e só encerra o cluster cuja pasta e marcador são conferidos.

## Validação e tentativas anteriores

Quatro testes focados PASS; regressão ACL RED→GREEN; sintaxe PASS. Suites: backend 1787 PASS, 1 FAIL preexistente em `fundingEnrichmentPersistence.test.js:33`, 7 SKIP; frontend 461 PASS e build PASS. Logs em `output/organizational-opportunity-interest/*-backup.log`.

Tentativas anteriores conservadas: `dafa8855…` encontrou comunicação bloqueada nas pipes de `pg_ctl` no Windows; encerramento manual exclusivo do cluster confirmado, embora o relatório original registe cleanup falhado. `e2442ed2…` identificou a diferença ACL; `86787ccf…` identificou escritas concorrentes da Central. Nenhuma dessas tentativas é a cópia validada. Todos os clusters dessas tentativas estão encerrados; evidência adicional de encerramento separada preserva os relatórios originais.

Próximo passo: preparar a janela de ativação com renovação dos backups e verificação imediata de ausência de divergência.
