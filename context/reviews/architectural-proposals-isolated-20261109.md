# Propostas arquiteturais — validação isolada, 09/11/2026

## Leitor central geral

[Prova PostgreSQL 18](central-reader-scoped-20261109/results.json): Central e dois tenants sintéticos, migrações até 035. A fixture tinha `pg_read_all_data`; a prova revogou essa membership apenas no cluster próprio e concedeu SELECT em três tabelas centrais. A consulta de memberships do diretório funcionou para A e B; SELECT de `auth_identity_ref` e UPDATE de organização foram recusados. O login não tinha superuser, createdb, createrole ou bypass RLS. O contentor próprio foi removido.

Limite importante: o mesmo leitor conseguiu contar memberships de ambas as organizações. SELECT em tabelas inteiras não impõe isolamento de linha; o filtro na consulta demonstrada é uma fronteira de aplicação, não um controlo independente no papel. Esta prova cobre uma consulta e três tabelas, sem HTTP/OIDC, não é inventário completo nem prova de privilégio mínimo ou configuração real. Antes de selecionar um desenho: mapear restantes consultas e separar dados por capacidade; avaliar funções/projeções ou RLS como fronteiras adicionais, com testes de falha fechada, sem alterar grants habituais.

## Paginação do matching

`node --test test/integration/matching-pagination/rank-proof.test.cjs`: 3 PASS. O protótipo sintético por novo varrimento ordena globalmente mais de 1000 correspondências e recusa alterações entre varrimentos, contexto diferente e cursor alterado. Uma prova adicional mostra que uma mutação atrás do iterador durante o próprio varrimento pode produzir uma ordenação já desatualizada sem ser detetada. O teste documenta uma limitação do protótipo, não uma falha demonstrada do runtime.

Conclusão: novo varrimento com fingerprint, por si só, não prova snapshot consistente. Snapshot persistido ou materialização transacional continuam opções por comparar com uma solução de versão verificável; ainda não há seleção, implementação, autorização real, PostgreSQL para matching ou prova da semântica em múltiplas fontes. Exigir revalidação por página, limites, TTL e comparação com ordenação de referência em teste integrado.

## Recuperação

Evidência existente: [restauro com MinIO e auditoria](threat-recovery-20261109-v2/results.json) recuperou dados e bytes sintéticos e verificou cadeias; [restauro temporizado](slo-restore-synthetic-20261109/results.json) mediu dumps e verificações, não RTO. Cópias periódicas só permitem recuperar o último ponto disponível; recuperação pontual com WAL, se suportada e configurada, pode reduzir a janela perdida mas exige cadeia de WAL e validação independente. Estas são consequências técnicas das opções, não um ensaio WAL aqui executado.

Pendente: testar perda entre checkpoints, recuperação pontual em cluster isolado, sequenciamento de objetos/auditoria e critérios funcionais. RPO/RTO, volumes e fronteiras operacionais continuam por decidir; R2 real fica para o final. Não foram usadas bases habituais.
