# Leitor central, matching e recuperação WAL — 09/11/2026

## Inventário inicial de acessos centrais

Inventário estático parcial, não lista de grants aprovada. O pool central é injetado em vários componentes por [productionComposition](../../backend/src/productionComposition.js); usos condicionais e SQL indireto precisam de rastreio adicional. Alguns repositórios também contêm métodos de escrita: não inferir que todas as operações que recebem um pool são de leitura nem que usam sempre a mesma identidade efetiva.

| Percurso | Evidência | Dados / observação |
| --- | --- | --- |
| Diretório organizacional | [composition](../../backend/src/organizationDirectory/composition.js) | organization, organization_membership e global_user; filtro por organização na aplicação. Ensaio restrito de uma consulta em [central-reader-scoped](central-reader-scoped-20261109/results.json); SELECT por tabela expõe ambas as organizações. |
| Candidaturas / destinatários | [composition](../../backend/src/applications/composition.js) | organization_membership, global_user, organization; leitura de destinatários. Uma captura de email é explicitamente isolada e usa coordenador de autoridade. |
| Diretório de tenants | [repository](../../backend/src/security/tenantDirectoryRepository.js) | tenant, organization, organization_provisioning, workload binding/connection version, connection version, generation, schema state e health. O mesmo módulo também contém escritas de provisioning; separar por método e identidade antes de atribuir grants. |
| Membership | [repository](../../backend/src/security/membershipRepository.js) | organization_membership, global_user e organization; com coordenador, o repositório troca para o pool da autoridade. Métodos de revalidação usam locks e há método de alteração de estado. Não classificar o módulo inteiro como leitura simples. |
| Administração de plataforma | [service](../../backend/src/platformDirectory/service.js) | application_session, global_user, platform_admin_assignment, organization e organization_membership, com consultas administrativas transversais. Não atribuir automaticamente ao leitor de uma organização. |
| Faturação | [platform SQL](../../backend/src/platformBilling/sql.js), [customer repository](../../backend/src/customerBilling/repository.js) | Dados de faturação e identidade; distinguir leituras, locks e escritas no coordenador de autoridade dos acessos pelo pool central. Inventário de colunas e identidade efetiva ainda pendente. |
| Catálogo | [decisão específica](../decisions/central-catalog-reader.md) | Leitor e pool dedicados; não confundir com o pool central geral. |

Próximo passo: completar rastreio por método e composição ativada, identificar colunas/locks/funções e testar roles por capacidade em PostgreSQL descartável, incluindo recusa cruzada. Nenhum grant foi alterado em bases habituais.

## Matching

O [runtime](../../backend/src/organizationDirectory/matching.js) continua a carregar fontes até 1000 itens e ordenar o conjunto antes de devolver. Uma transação PostgreSQL isolada por fonte não garante por si só um instante comum entre Central e tenant, e o acesso de catálogo e perfil deve continuar autorizado. A [prova de varrimento](architectural-proposals-isolated-20261109.md) demonstrou a janela de mutação durante o varrimento. Não existe implementação de paginação consistente neste incremento; escolher e testar um protocolo de versões/snapshot entre fontes, com revalidação antes da publicação. Mantêm-se os critérios de >1000, ordem global, isolamento e revogação em [contrato](../features/audit-remediation.md).

## Recuperação WAL

[Terceira execução](wal-recovery-proof-20261109-c/results.json): PASS. PostgreSQL 18 num contentor sem portas publicadas, tabela sintética, base backup, arquivo WAL, transação confirmada antes de restore point, outra após esse ponto e restauro pausado no ponto nomeado. A primeira transação foi recuperada e a segunda não. Contentor próprio removido.

As duas primeiras execuções preservam relatórios FAIL: a primeira por passagem de aspas ao processo de restauro; a segunda porque dois INSERTs e o restore point foram executados numa única transação, fazendo a expectativa da prova errada. A terceira separou os commits. Não são falhas comprovadas da aplicação.

Limites: dados mínimos numa única instância física com cópias locais; não exercita schema da APP, cópias independentes, perda de segmento, operação de fornecedor, objetos, auditoria, volume representativo, RPO ou RTO operacional. Testar essas dimensões separadamente. R2 real adiado.
