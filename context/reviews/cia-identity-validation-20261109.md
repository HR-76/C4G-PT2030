# Validação de identidade, isolamento e documentos — 09/11/2026

Três gates com PostgreSQL 17 e Keycloak 26.8 descartáveis, duas organizações e dados sintéticos, terminaram PASS, código 0 e sem blockers. As imagens já existiam; portas foram alocadas em loopback e não foram usadas as bases habituais. A verificação final de contentores com label `c4g.http-proof` devolveu zero resultados.

- [Sessões](cia-identity-sessions-20261109/results-sessions.json): 22 verificações; OIDC/PKCE e cookie seguro, CSRF, rotação de SID, logout, expiração e impossibilidade de ressuscitar sessão revogada.
- [Revogação concorrente](cia-identity-revocation-20261109/results-revocation.json): 9 verificações; a revogação bloqueou uma leitura tenant com autoridade obsoleta e recusou leituras posteriores. Uma resposta SERVICE_UNAVAILABLE durante o cenário é a recusa esperada, não uma falha do gate.
- [Gate integral](cia-identity-cross-20261109/results.json): 33 verificações; isolamento SQL/RLS, candidatura de outra entidade oculta via HTTP, recusa de seleção e dashboard de outra entidade, escrita autenticada e auditada, e revogação concorrente. Os cenários HTTP de 25/1000/10000 candidaturas terminaram sem erros; amostras pequenas não demonstram SLO.
- Documentos: 51 testes focados PASS com doubles de armazenamento e scanner e transportes locais. Incluem validação de conteúdo, quarentena, integridade, download autorizado e cancelamento. Não provam configuração ou comportamento do R2/ClamAV de produção.

Nenhum defeito reproduzido nos cenários anteriores; não foi aplicada correção de código. Os gates usam um leitor central de fixture com `pg_read_all_data`, pelo que não demonstram paridade dos privilégios da Central em produção. Não verificam implantação real, proxy, MFA OTP, backup/restauro, fornecedores ou R2/Resend reais. A ausência de falhas neste conjunto não certifica segurança global. Paginação do matching permanece uma questão separada e aberta.
