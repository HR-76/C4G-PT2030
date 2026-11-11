# Ownership do catálogo e resolução de identidade

Decisão aprovada pelo utilizador em 2026-10-25. Implementação e admissão
condicionadas a provas em bases descartáveis; nenhuma remediação de bases reais.

- `funding_run`, `funding_run_item`, `funding_identity` e `funding_observation`
  pertencem a `c4g_opportunity_central_owner`. O runtime não recebe membership
  nesse owner nem DDL. Os grants funcionais existentes são preservados.
- A atualização aceita somente a baseline Central 027 verificada e o ownership
  histórico `c4g_f12_admin` com ACL esperadas. Drift é recusado. Não existe down
  que devolva ownership ao executor histórico.
- Identidade é resolvida pelo coordinator e catálogo fechado de autoridade,
  com issuer/subject provenientes do callback OIDC validado. Não há SELECT
  genérico concedido ao runtime comum nem provisioning implícito.
- Os papéis de plataforma necessários à exigência de MFA no login são obtidos
  por operação separada, vinculada à mesma identidade. Não substituem grants
  ou membership nem são atribuídos por esta operação.
- A nova versão atesta ownership/ACL do catálogo separadamente, preservando
  as representações e fingerprints das versões históricas.

Aceitação: INSERT legítimo, FK inválida recusada, DDL/DELETE recusados,
roles restaurados, identidade exata/ativa, consultas não catalogadas recusadas,
drift recusado, duas bases equivalentes, runner/preflight oficiais e provas
delimitadas Catálogo Central→candidatura e logout APP/IdP.
