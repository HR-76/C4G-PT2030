# Runbook: rotação das partições de auditoria

Contrato: [audit-partition-rotation](../features/audit-partition-rotation.md). Executar uma vez por mês, ou no deploy, **em cada base**: a Central e cada tenant. Primeiro prazo: antes de 2026-12-01.

## Não é automático

Nada na plataforma corre esta rotina sozinho: os runners de migrações só atuam no provisionamento de um tenant ou quando invocados, e os tenants criados depois de dezembro também nascem só com `2026_10` e `2026_11`. Decisão do utilizador em 2026-11-11: manter manual, com lembrete operacional mensal. Alternativas avaliadas e não adotadas: partições a 5 anos com chamada no provisionamento e na Central; job mensal em pg-boss (exige credenciais de migrator em todas as bases).

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
