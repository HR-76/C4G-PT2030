# Decisão: reutilizar as verificações de schema entre pedidos por assinatura do catálogo

## Estado

**Via escolhida pelo utilizador em 20/11/2026** (assinatura do catálogo, em vez de uma janela temporal de 30 s). Implementação em Review, **desligada por omissão**. Prova em PostgreSQL 18.6 descartável aprovada em 20/11/2026 (ver «Prova»); falta medir no staging, com os roles e o schema reais.

Estende a [admissão reutilizada dentro do mesmo pedido](request-scoped-central-admission.md), cujo «Fora do âmbito» era «qualquer reutilização entre pedidos».

## Problema medido

[Medição por fase](../features/request-phase-timing.md) no staging, 20/11/2026, um utilizador:

- observação do schema do tenant: 525–860 ms em cada pedido que vai ao tenant;
- admissão do schema da Central: 230–330 ms em todos os pedidos.

As duas somam cerca de 870 ms fixos, em pedidos cujo total é 1,0–1,6 s e cujas consultas de negócio demoram 70–500 ms.

## Decisão

Com `SCHEMA_ADMISSION_REUSE=signature`, e só dentro de um pedido HTTP, cada uma das duas verificações passa a ser precedida de uma **assinatura**: uma consulta única que resume tudo aquilo de que a verificação depende. Se a assinatura for igual à da última verificação completa bem-sucedida para a mesma base (e, no tenant, o mesmo tenant e geração), o resultado dessa verificação é reutilizado. Se for diferente, a verificação completa corre como hoje.

Não há janela temporal: a assinatura é lida em todos os pedidos.

### O que entra na assinatura

1. **Versão de cada linha (`ctid` e `xmin`) dos catálogos do PostgreSQL** de que as verificações leem, direta ou indiretamente (definições, donos, privilégios, RLS, triggers, funções, índices, extensões, pertenças e definições por role): `pg_namespace`, `pg_class`, `pg_attribute`, `pg_attrdef`, `pg_constraint`, `pg_index`, `pg_trigger`, `pg_policy`, `pg_proc`, `pg_type`, `pg_enum`, `pg_language`, `pg_extension`, `pg_sequence`, `pg_inherits`, `pg_rewrite`, `pg_partitioned_table`, `pg_event_trigger`, `pg_aggregate`, `pg_cast`, `pg_default_acl`, `pg_auth_members`, `pg_db_role_setting`, `pg_database`, `pg_tablespace`. Qualquer DDL, `GRANT`/`REVOKE` ou `ALTER` cria uma versão nova de pelo menos uma linha, ou apaga linhas.
2. **Os valores de `pg_roles`** (os atributos dos roles; a tabela por baixo não é legível por um login comum).
3. **Versão do servidor, codificação, base de dados, `session_user` e `current_user`.**
4. **Os dados que as verificações leem.** Na Central, a versão de cada linha do ledger de migrações (`public.c4g_schema_migration`) e do marcador (`public.c4g_database_identity`). No tenant, o resultado integral de `c4g_system.runtime_metadata_v1` (marcador, ledger e os indicadores `legacy_drained` e `v1_complete`), lido de novo em cada pedido.

### Limites obrigatórios

- Desligado por omissão; outro valor da variável falha o arranque.
- Só dentro de um pedido HTTP. Workers, arranque e scripts verificam sempre por inteiro.
- Só um resultado bem-sucedido é guardado, e só se a assinatura lida **antes e depois** da verificação completa for a mesma. Uma verificação falhada apaga o que estava guardado.
- Uma verificação completa é forçada pelo menos de 5 em 5 minutos por base, mesmo com a assinatura igual.
- Se a consulta da assinatura falhar (por exemplo, catálogo não legível), corre a verificação completa e a reutilização fica desligada para essa base até o processo reiniciar. No tenant a assinatura corre dentro de um savepoint, para uma falha não estragar a transação do pedido.
- Em memória do processo, no máximo 128 bases; nunca partilhado entre processos.
- Continuam em todos os pedidos e fases, sem alteração: o login e os seus roles, a identidade física da base, o lock de autoridade, a metadata de segurança de autoridade (uma vez por pedido), sessão, membership, permissões, guardas e auditoria.

## Riscos aceites

- **Alterações que não tocam em nenhuma linha assinada não são detetadas até à verificação forçada seguinte (5 min).** Conhecidas: atualizações «in-place» do PostgreSQL (estatísticas de `VACUUM`/`ANALYZE`), que as verificações também não leem; alteração da palavra-passe de um role, idem. Não se conhece nenhuma alteração de schema, privilégios ou RLS nestas condições; a prova em PostgreSQL real existe para o confirmar.
- **Reutilização do mesmo `xmin` após esgotar os identificadores de transação** (cerca de 4 mil milhões de transações) entre duas leituras: coberto pela verificação forçada.
- **Voltar a um estado anterior dá a assinatura desse estado.** Apagar o que acabou de ser criado (um índice, um trigger, uma política, uma pertença) deixa as linhas dos catálogos exatamente como estavam, e a assinatura volta a ser a de então. É detetado como alteração em relação ao estado imediatamente anterior; e reutilizar o resultado verificado nesse mesmo estado é correto, porque as linhas lidas pelas verificações são as mesmas. Em memória fica só a última verificação bem-sucedida.
- **Falsos positivos são seguros**: `VACUUM FULL` de um catálogo, criar outra base no mesmo servidor ou uma tabela temporária mudam a assinatura e causam apenas uma verificação completa.
- A janela entre a verificação e o trabalho do pedido é a que já existia.

## Critérios de aceitação

1. Sem a variável, o comportamento é o atual: uma verificação completa por pedido.
2. Com a variável, dois pedidos seguidos com a mesma assinatura fazem uma verificação completa e uma reutilização.
3. Assinatura diferente, assinatura que muda durante a verificação, verificação falhada, idade superior a 5 minutos ou falha da assinatura levam sempre à verificação completa.
4. Fora de um pedido HTTP nunca há reutilização nem leitura da assinatura.
5. Bases, tenants e gerações diferentes nunca partilham resultado.
6. **Prova em PostgreSQL real:** cada classe de alteração coberta pelas verificações (tabela, coluna, default, constraint, índice, trigger, política e RLS, função, dono, `GRANT`/`REVOKE` de tabela, coluna, schema e função, pertença e atributos de role, definição por role, extensão, ledger e marcador) muda a assinatura; leituras, escritas de negócio, `ANALYZE` e `VACUUM` não a mudam; custo da assinatura medido.

## Utilização

`SCHEMA_ADMISSION_REUSE=signature` no ambiente da API. A [medição por fase](../features/request-phase-timing.md) mostra `authority.signature` e `tenant.signature` (leituras da assinatura) e `authority.preflight` e `tenant.metadata` (verificações completas).

## Prova (20/11/2026)

`test/integration/schema-signature/proof.cjs`, autorizada pelo utilizador, num servidor PostgreSQL 18.6 descartável criado com `initdb` numa pasta temporária e noutra porta; o servidor local habitual e as suas bases não foram usados. Servidor parado e pasta apagada no fim. A assinatura foi lida por um login comum, sem superutilizador.

- **54 alterações, todas detetadas**: tabela (criar, renomear, apagar), coluna (acrescentar, tipo, default, NOT NULL), constraints, chave estrangeira, índice, trigger (criar, desativar, apagar), RLS (ativar, forçar, desativar) e políticas, função (corpo, SECURITY DEFINER, `search_path`, dono), dono de tabela e de schema, `GRANT`/`REVOKE` de tabela, coluna, schema, função e base, privilégios por omissão, pertença e atributos de role, definição por role, sequência, vista, tipo e valor de enum, extensão, schema, ledger (linha nova, alterada, apagada), marcador e commit de DDL pendente.
- **8 atividades sem alteração, nenhuma mudou a assinatura**: leitura, inserir, atualizar e apagar linhas de negócio, uso de sequência, `ANALYZE`, `VACUUM` e `VACUUM ANALYZE` da base. DDL não commitado também não.
- **6 remoções voltaram à assinatura de um estado anterior** (apagar índice, trigger, política, extensão, pertença e linha do ledger acabados de criar), como descrito em «Riscos aceites».
- **Custo**: mediana 4,7 ms, p90 5,5 ms, máximo 10,3 ms, com 7 716 linhas nos quatro maiores catálogos.

Por provar: PostgreSQL 17; o login limitado do tenant e o `c4g_authority_runtime` reais (se algum catálogo não lhes for legível, a reutilização desliga-se sozinha para essa base e a medição por fase mostra-o: `tenant.metadata` ou `authority.preflight` em todos os pedidos); o custo com os catálogos do staging; a leitura de `runtime_metadata_v1` dentro do savepoint.

## Medição no staging (20/11/2026, commit e6ffd88, `SCHEMA_ADMISSION_REUSE=signature`)

Um utilizador (Técnico), sessão real, PostgreSQL e logins reais do staging. A reutilização ligou para as duas bases: a verificação completa correu só no primeiro pedido (`authority.preflight` 345 ms e `tenant.metadata` 846 ms, uma vez cada); nos seguintes só a assinatura.

- Custo da assinatura: Central 14–25 ms, tenant 17–33 ms (inclui a leitura de `runtime_metadata_v1` no savepoint).
- Admissão da Central por pedido: de 230–330 ms para 16–40 ms.

| Pedido | Antes | Depois |
|---|---:|---:|
| `auth/session` | 290–350 ms | 75–110 ms |
| `billing/access` | 355–480 ms | 140–190 ms |
| `applications/my-work` | 0,99–1,18 s | 0,33–0,39 s |
| `organization-directory/me` | 1,05–1,24 s | 0,30–0,35 s |
| `notifications` | 1,45–1,51 s | 0,47 s |
| `opportunity-interests/context` | 1,42–1,92 s | 0,38–0,59 s |
| `opportunity-interests` (lista) | 1,57–1,76 s | 0,95 s |
| `applications/browse-page` | 1,61 s | 0,90–1,15 s |
| `organization-directory/matching` | 5,5 s | 4,9 s |

Fica provado no staging o que estava por provar sobre os logins reais, o custo com os catálogos reais e o savepoint. Continua por provar: PostgreSQL 17, se for essa a versão de produção. Não medido: vários utilizadores em simultâneo.
