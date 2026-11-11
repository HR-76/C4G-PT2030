# Documentos e restauro isolado — 09/11/2026

Resultado: 51 testes focados de documentos PASS; dump e restauro sintético da Central e de dois tenants PASS. Nenhum defeito do runtime foi demonstrado por esta prova. Não foi utilizado backup real nem se acedeu às bases habituais ou aos fornecedores de produção.

## Restauro

O harness `test/integration/cia-restore/` cria um PostgreSQL 18.6 descartável com porta aleatória em loopback. A fixture aplica as migrações reais da Central (035) e de dois tenants (033), cria identidades e dados sintéticos, e usa `pg_dump -Fc`/`pg_restore --exit-on-error` dentro do contentor. Os ficheiros de dump nunca saem do contentor.

Foram restauradas três bases novas e comparados contagem e digest das tabelas selecionadas: organizações, utilizadores e memberships na Central; identidade e ledger de migrações, oportunidades, candidaturas e histórico, pessoas, perfis e metadados de documentos nos tenants. O tenant A tinha 12 candidaturas e três pessoas; B tinha sete candidaturas e duas pessoas; cada tenant tinha um documento sintético. `audit.event` estava vazio: a igualdade do conjunto vazio **não prova recuperação de eventos de auditoria reais**.

Encoding e propriedades de locale foram comparados. As bases tenant restauradas usam ICU `und`, como a origem. Sob a role funcional, RLS permitiu contar os dados da própria organização e recusou os da outra. Os marcadores de tenant e geração mantiveram-se distintos e iguais às origens; nenhum destino foi admitido no diretório ativo. Contentor e volume próprios foram removidos e a verificação final por label devolveu zero recursos.

Evidência: [resultados](results.json), [imagem](image.txt), [primeira tentativa](../cia-restore-20261109/results.json), [segunda tentativa](../cia-restore-20261109-r2/results.json). A primeira falhou por validação do nome `c4g_system` no harness. A segunda criou a base restaurada com locale padrão e usou esse locale para ordenar o digest, produzindo divergência na comparação de pessoas. A terceira preservou ICU e usa ordenação `C` para comparar dados; passou. Não é possível atribuir a divergência anterior exclusivamente ao locale sem comparar as linhas daquela fixture, que foi removida.

## Documentos

Os [51 testes focados](documents-tests.log) passaram. Exercitam autorização antes do download, ligação à organização, estados de quarentena e scan, rejeição por checksum/tamanho, cancelamento, transporte R2 com cliente simulado e protocolo ClamAV local de teste. Não utilizam bucket nem scanner de produção.

## Limitações e próximos controlos

- A prova usa backups sintéticos num único cluster descartável. Não valida backups existentes, consistência entre Central e tenants em simultâneo, WAL/PITR, disaster recovery, encriptação, retenção, RPO ou RTO.
- O dump PostgreSQL não contém bytes dos objetos R2; só foram verificados metadados documentais. Não se provou recuperação dos ficheiros nem correspondência dos objetos com esses metadados.
- Não se testou a admissão do tenant restaurado ao diretório, a reconstrução de roles/ACLs globais noutro cluster, o preflight integral ou o comportamento de identidade física após um cutover. Os marcadores copiados não autorizam automaticamente uma nova ligação.
- Antes de um restauro operacional, usar um procedimento aprovado que preserve encoding/ICU e valide vínculos físicos, privilégios, consistência temporal, objetos e evidência de auditoria numa infraestrutura isolada. A prova de produção permanece pendente e não foi iniciada.
