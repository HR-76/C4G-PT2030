# Prova PostgreSQL dos checkpoints de metadados

Executar `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/authority-metadata/proof.ps1` apenas quando nenhum benchmark estiver em curso. O runner cria um PostgreSQL 17 exclusivo, com porta loopback, segredo efémero e label própria, e remove somente esse contentor no final. Não consulta configuração Dev.

O teste compara os snapshots JSON e fingerprints exatos das fontes anteriores arquivadas em `context/reviews/authority-metadata-dedup/*.before.txt` com o runtime atual, nas revisões 029, 030, 031 e 032. Verifica os hashes existentes, a recolha fresca em chamadas repetidas, drift de roles/memberships/ACLs/funções/schema e a validação separada de segurança do catálogo.

As provas após o lock mantêm o advisory lock central numa ligação PostgreSQL externa, deixam o coordenador real completar o preflight e bloquear, confirmam `pg_blocking_pids`, introduzem drift apenas na fixture e libertam o lock. A callback funcional deve permanecer por executar e a observação fresca deve recusar o drift.

Os grants e DDL de teste aplicam-se exclusivamente ao contentor descartável. Não se alteram migrations, hashes, permissões do projeto ou ficheiros de runtime. O resultado sanitizado fica em `context/reviews/authority-metadata-dedup/postgres-proof.json`.

Esta prova não substitui a composição HTTP/OIDC. Executar separadamente o gate existente com `-Scope revocation` e repetir os perfis standard/capacity. O primeiro comprova revogação concorrente na fronteira observada; os perfis medem contenção com os limites reais e roles/RLS. Não afirmar cobertura de todas as fronteiras de revogação ou de todos os casos de epochs a partir destes percursos.
