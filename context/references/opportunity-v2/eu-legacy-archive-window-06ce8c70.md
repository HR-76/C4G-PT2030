# Janela de arquivo EU legado — preparação 06ce8c70

Estado em 31/10/2026, 23:53 UTC: preparação técnica concluída; aprovações OIDC humanas pendentes. Fonte EU `QUIESCED`, fence 7. Escritor automático suspenso. Migração Central 045 não instalada; candidatos não arquivados.

## Evidência fixa

- [Preparação e retoma](../../../output/eu-legacy-archive-window-06ce8c70-9eed-4b31-94a7-af631b3f960a/preparation.json): `PASS`, saúde retomada, zero migrações e zero candidatos.
- [Backup/restauro](../../../output/opportunity-v2-window/06ce8c70-9eed-4b31-94a7-af631b3f960a/backup-restore-cb8fdd5e-75e3-491f-b797-067d0167a2f4.json): `PASS`, Central 044 e tenant 034, dados e configuração iguais, sem drift, cleanup concluído.
- [Preview read-only](../../../output/eu-legacy-migration-preview-73c5131e-7722-4451-8a95-53f43fee84dd.json): 398 heads, 391 propostas, sete conflitos; zero writes.
- [Pacote](../../../output/eu-legacy-preapproval-1e849d47-89e1-4fad-b2cd-0208c0d348b8/plan.json): `1e849d47-89e1-4fad-b2cd-0208c0d348b8`, expira **01/11/2026 00:51:19.523 UTC**. Paridade de 391 artefactos/digests distintos PASS.
- Gate PostgreSQL isolado: `output/eu-legacy-prearchive-gate-5867d8bc17e247f5aedb845deebc924a/report.json`, PASS/cleanup. Backend completo: 2373 PASS, zero FAIL, sete SKIP.

## Aprovação e conferência

O administrador autenticado deve abrir `http://localhost:3000/administracao/aprovacoes-eu?pacote=1e849d47-89e1-4fad-b2cd-0208c0d348b8`, rever a fila, reautenticar com OIDC se necessário, emitir as 391 decisões e exportar o JSON de recibos. Uma paragem preserva os recibos já emitidos; não repetir com intenções novas sem reconciliação. O pacote expirado anterior e os seus 139 eventos não servem para esta janela.

Com o JSON completo, correr `node scripts/eu-legacy-archive-receipts-preflight.cjs <caminho-absoluto-do-json>`; este comando só lê o ledger e exige 391 IDs e eventos vinculados. Confirmar hash e relatório antes de qualquer instalação/arquivo. O backup de preparação não substitui o controlo de fronteira e a autoridade no momento de aplicar 045. A aceitação dos candidatos e a retoma EU ficam fora desta janela.
