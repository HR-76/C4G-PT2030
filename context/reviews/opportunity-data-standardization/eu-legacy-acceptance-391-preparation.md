# Aceitação EU legada: preparação de 391 identidades

Data: 2026-11-01 (UTC). Estado: **pronto para decisões OIDC individuais; nenhuma aceitação habitual emitida por esta preparação**.

## Âmbito e prova

- 398 identidades v1; 391 candidatos v2 já arquivados; sete conflitos sem candidato continuam excluídos.
- Preview só de leitura: `output/eu-legacy-acceptance-preview-f03c2452-e58e-4999-a044-a7d9cc4fe97a.json`.
- Pacote de aceitação: `f6baff03-f5e6-40ad-b23b-43dd86ff43b0`, válido até `2026-11-01T01:47:30.251Z`. As aprovações anteriores eram apenas para arquivo e não autorizam aceitação.
- Paridade: 391/391 digests de preview iguais aos do escritor de aceitação, sem escritas na BD.
- Fonte EU: `QUIESCED`, fence 7. A aceitação não retoma o escritor automático.
- Ensaio isolado PostgreSQL: arquivo legado verificado, writer de revisão v2 executado dentro de transação anulada, cabeça v1 preservada; relatório `output/eu-legacy-prearchive-gate-cb41a078dcad4b9babb92c9c2d1af4b7/report.json`.
- Backup/restauro habitual após a migração Central 045 e tenant 034: `output/eu-legacy-acceptance-window-c7683f97-62f1-4a42-9bee-dd26fc9d26b5/preparation.json` com `PASS`, paridade e saúde restaurada. Prova detalhada: `output/opportunity-v2-window/c7683f97-62f1-4a42-9bee-dd26fc9d26b5/backup-restore-9276cd9c-9ff1-43b7-b0da-7265c19b7e29.json`.

## Execução autenticada

O administrador abre `/administracao/aceitacoes-eu?pacote=f6baff03-f5e6-40ad-b23b-43dd86ff43b0`, revê a fila e renova a autenticação OIDC. A ação da página prepara, aprova e aceita sequencialmente cada identidade; cada item tem três IDs de intenção próprios e estados recuperáveis no navegador. A API vincula pacote, item, arquivo, preview, cabeça v1 e fence no servidor. Uma falha pára o lote; a retoma é explícita. Decisões OIDC e revisões v2 devem ser conferidas no ledger e na BD após a execução. O pacote expirado não autoriza continuação.

## Recuperação

Se houver falha durante a aceitação, manter EU suspensa, não repetir cegamente o lote e reconciliar `activation_plan_v2`, `activation_decision_v2`, `accepted_receipt_v2`, revisões e cabeças por identidade. O backup é ponto de recuperação, não comando automático de restauro; qualquer restauro habitual exige decisão e janela própria. Para itens não aceites após expiração, renovar preview, backup e pacote. Os sete conflitos exigem resolução separada.

## Resultado habitual e fecho da janela

Às 01:32:41 UTC, `scripts/eu-legacy-acceptance-postcheck.cjs f6baff03-f5e6-40ad-b23b-43dd86ff43b0` deu **PASS**: 391 aceites, zero pendentes, 391 planos com decisão OIDC `APPROVED` do mesmo ator, 391 cabeças/revisões v2 com digest do candidato e recibo de aceitação único, 401 dotações derivadas e 422 prazos derivados iguais aos snapshots aprovados. As 398 identidades foram preservadas; sete conflitos continuam em v1. A fonte EU permanece `QUIESCED`/fence 7 e a conferência não fez escritas.

A interface falhou primeiro porque um import lazy sem extensão resolveu para o auxiliar `.js` homónimo no Windows. O import foi fixado para `.jsx`, com regressão e build PASS. A primeira reautenticação deu HTTP 409 porque `/auth/account-security` consultava também a preferência de email do fornecedor; um endpoint autenticado `/auth/step-up-policy` passou a fornecer só a política necessária ao OIDC. Regressões RED→GREEN, backend 2376 PASS/0 FAIL/7 SKIP, frontend 505 PASS e build PASS. A autoridade recente expirou durante o lote; o administrador renovou OIDC e retomou com intenções estáveis, sem duplicar revisões.

Esta janela conclui a aceitação dos 391 candidatos. A resolução dos sete conflitos e a decisão de retomar a recolha automática EU são trabalhos separados; a fonte não foi reativada.
