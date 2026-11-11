# Runbook: rotação das partições de auditoria

Contrato: [audit-partition-rotation](../features/audit-partition-rotation.md). A rotação é automática para tenants novos, para a Central (`db:central:up`) e para o instalador local; o comando manual abaixo serve só para as bases já existentes. Prazo para essas: antes de 2026-12-01.

## Automático (decisão de 2026-11-11)

Já não depende de ninguém: cada base recebe cinco anos de partições mensais (60 meses à frente) sem passo manual.

- **Tenant novo:** o provisionamento cria as partições logo a seguir às migrações do tenant (`postgresProvisioner`).
- **Central:** `npm run db:central:up` cria-as depois das migrações. É idempotente, por isso correr o `up` sem migrações pendentes também as garante.
- **Instalação local:** `schema.js` cria-as na Central e no tenant.

### Passo único para o que já existe

As bases criadas antes desta alteração só recebem as partições na próxima vez que passarem por um dos pontos acima. Para **cada tenant já existente**, e para a Central se o `db:central:up` não for correr antes de 2026-12-01, corra uma vez o comando abaixo (secção «Executar»), com `AUDIT_PARTITION_MONTHS_AHEAD=60`. Depois disso nada mais é preciso até 2031.

Passados cinco anos, repita este passo uma vez por base (ou volte a correr `db:central:up` e reprovisione o que for novo).

## Antes

- Usar um login membro de `c4g_audit_migrator` (que herda `c4g_audit_owner` por `SET ROLE`). Não usar o utilizador de runtime nem credenciais de aplicação.
- Não colar a ligação em tickets, logs ou histórico do shell; passá-la por variável de ambiente.

## Executar

```bash
AUDIT_PARTITION_DATABASE_URL='<ligação da base>' node backend/scripts/ensureAuditPartitions.js
```

`AUDIT_PARTITION_MONTHS_AHEAD` (1–24, por omissão 3) alarga o horizonte.

Saída: `{"created":["event_2026_12",...],"defaultRows":0}`.

## Resultado

- Código 0 e `defaultRows` 0: nada mais a fazer. Repetir é seguro.
- Código 2: já há linhas na `DEFAULT`. Investigar antes de continuar; essas linhas não podem ser movidas.
- `AUDIT_PARTITION_DEFAULT_CONFLICT`: a `DEFAULT` tem linhas num mês a criar, nada foi criado. Escalar; não eliminar nem editar `audit.event`.
- `42501`: o login não é membro de `c4g_audit_migrator`.

## Depois

- O arranque e o preflight aceitam as partições novas sem mudar fingerprints. Uma tabela `event_AAAA_MM` que não seja partição é recusada por `AUDIT_SCHEMA_PREFLIGHT_FAILED`.
- Registar apenas o resultado (partições criadas e `defaultRows`), nunca a ligação.
