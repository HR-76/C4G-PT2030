# Recuperação de objetos e auditoria — 09/11/2026

Resultado: prova sintética PASS em PostgreSQL 18 e MinIO descartáveis; 33 testes focados de auditoria e adaptador R2 PASS. A prova não acedeu ao R2 real, backups reais ou bases habituais.

## Objetos

Foram criados dois documentos PDF sintéticos, um por organização, através do adaptador R2 da aplicação com cliente S3 injetado apontado exclusivamente ao MinIO local. O estado CLEAN nos metadados foi construído pela fixture: não é prova de antivírus. O objeto foi copiado para um bucket de backup sintético, removido apenas do bucket de origem descartável e recuperado através do adaptador a partir da cópia. Os bytes e SHA-256 coincidiram com o original e os metadados da versão restaurada em PostgreSQL.

Para cada organização, uma tentativa de restaurar bytes alterados com o SHA-256 original foi recusada com `STORAGE_COMMIT_MISMATCH` antes de existir objeto final. As duas tentativas de ler um identificador da outra organização pelo adaptador devolveram ausência. Isto testa o vínculo de prefixo no adaptador, não as políticas de bucket de produção.

## Auditoria e bases

Cada tenant recebeu dois eventos sintéticos reais através de `createAuditEvent`, `createAppendService` e funções PostgreSQL de append. `pg_dump`/`pg_restore` preservaram `audit.event`, `audit.event_identity`, `audit.chain_head`, metadados e tabelas de negócio selecionadas. Após restauro, `verifyEvents` validou sequência, ligação de hashes e conteúdo; a cabeça da cadeia coincidiu. A manipulação de um hash numa cópia em memória foi detetada. Um terceiro evento foi acrescentado ao tenant restaurado e a cadeia voltou a validar.

RLS recusou a outra organização nos dois tenants; os marcadores de tenant/generation permaneceram distintos. Não houve admissão do restauro ao diretório ativo. Encoding e locale da base corresponderam à origem; os dumps ficaram dentro do contentor descartável.

## Evidência e limites

- [Resultados](results.json), [imagem PostgreSQL/MinIO](image.txt), [testes focados](focused-tests.log) e [primeira execução](../cia-recovery-20261109/results.json). Na repetição, todos os cenários passaram e os hashes dos ficheiros principais do harness, auditoria e adaptador permaneceram iguais durante a prova.
- PostgreSQL e MinIO foram iniciados a partir de imagens locais sem download, expostos apenas em portas loopback aleatórias; verificação por labels após cleanup não encontrou contentores remanescentes.
- O bucket de backup e o de origem residiam no mesmo MinIO descartável: não prova independência do backup, encriptação, retenção, versionamento, acesso ou disponibilidade da Cloudflare R2. A configuração `layerCValidated` usada na fixture é sintética e não valida essa capacidade em produção.
- Não prova recuperação de objetos reais, cópias existentes, RPO/RTO, WAL/PITR, backups consistentes entre sistemas sob escrita concorrente, restauro noutro cluster, cutover, reativação de tenant ou scanner real. Nem todos os ficheiros de projeto foram incluídos no fingerprint das fontes.
- As permissões HTTP e revogação durante download não foram ensaiadas nesta prova integrada; existem testes focados separados, que não substituem prova do fluxo completo de produção.

Não foi identificada uma falha de runtime neste âmbito; nenhuma correção de código produtivo foi aplicada. Para demonstrar recuperação operacional real é necessário um plano próprio e recursos de teste do fornecedor, sem acesso ou alteração de objetos de produção.
