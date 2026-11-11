# Janela EU: 137 candidatos REVIEW

Estado em 2026-11-01 15:36 UTC: **137/137 aceites e reconciliadas; recolha EU ainda suspensa**.

- Preview oficial: `output/eu-review-acceptance-preview-0c3ec50d-80f6-4f60-92c4-b802600e3eea.json`. Identificou exatamente 137 arquivos candidatos e 137 cabeças v1 atuais; zero escritas. A paridade dos 137 digests com o escritor real passou.
- Pacote de decisão: `7d3a12ec-7f37-4b13-9cb1-aac4b108e337`, válido até `2026-11-01T16:18:22.856Z`. Cada identidade exige plano e decisão OIDC próprios. A fila operacional está em `/administracao/aceitacoes-eu?pacote=7d3a12ec-7f37-4b13-9cb1-aac4b108e337` e permanece fora da sidebar.
- Backup/restauro habitual: `output/eu-legacy-acceptance-window-367e960c-a6db-450b-87d5-6587f40a4eb1/preparation.json`, PASS, restauro limpo, serviços saudáveis. Prova: `output/opportunity-v2-window/367e960c-a6db-450b-87d5-6587f40a4eb1/backup-restore-83e747f4-8d64-4076-8a89-d5eadffcef7d.json`.
- Postcheck atual: 137 aceites, zero pendentes, 137 planos aprovados, 137 dotações e 204 prazos validados; fonte `QUIESCED`, fence 7. As 391 aceitações anteriores continuam íntegras (401 dotações, 422 prazos).
- Sete identidades ambíguas continuam excluídas. A consulta oficial renovada em `output/eu-conflict-observation-e50b1283-1c62-4da1-9a27-664fe1362c3b.json` voltou a classificá-las como `CONFLICT`; não há escolha editorial fundamentada entre variantes.

Validação: backend 2377 PASS, 7 SKIP; frontend 506 PASS; build PASS; gate SQL isolado completo PASS em `output/opportunity-v2-s6-7652542e4b09496cba3e1a4d1c85dc31`. O gate HTTP de retoma **falhou** em `output/opportunity-v2-s6-6eb74f70f00b45eba20401f13f800be3`: o fixture de job CORDIS v1, sem escritor canónico, terminou `PERMANENT`, enquanto a prova antiga esperava `SUCCESS`.

O gate específico do escritor EU v2 falhou inicialmente no ciclo controlado em `output/opportunity-v2-writer-87ea5f8a6c6b47658eef44314fea79d1`. O diagnóstico localizou `FUNDING_V2_PREARCHIVE_APPROVAL_REQUIRED` na fase `stage`: o fixture continha uma identidade v1 sem recibo OIDC. O refresh canónico foi corrigido para selecionar somente cabeças v2; as v1 permanecem reservadas ao percurso humano. O gate EU v2 completo passou depois da correção, com ciclo controlado, suspensão final, atualização monetária, revisão de novas identidades e rollback de falhas, em `output/opportunity-v2-writer-e47677f1eb5a459d99c36da6871e760f`. O gate 045 de recibos OIDC também passou em `output/eu-legacy-prearchive-gate-9c412331f5de4d79be6e361cbb1ebad9/report.json`. A fonte habitual continua suspensa até uma janela operacional própria de retoma.

O postcheck de leitura `node scripts/eu-legacy-acceptance-postcheck.cjs 7d3a12ec-7f37-4b13-9cb1-aac4b108e337` obteve 137 aceites e zero pendentes. A paridade 11145 posterior confirmou 120000 em SQL `numeric`, sete cut-offs e estado monetário `NOT_FOUND` para a moeda não publicada no campo orçamental. O inventário atual contém 529 v2 e sete v1 em conflito, sem aceitação automática destes últimos.

## Retoma operacional posterior

O backup/restauro pós-aceitação passou em `output/eu-legacy-acceptance-window-4d8191c9-8f26-43ec-aeb3-2327488f63d1/preparation.json`. O preview atual `output/eu-resume-readiness-e9b4dfac-1245-4cdc-a813-243287fd9f70.json` confirma `canResume=true`, trabalhador v2 saudável, zero jobs/leases e fence 7.

Foi preparado `scripts/eu-resume-controlled-cycle.cjs`, executor limitado a um ciclo com login OIDC visível, journal e suspensão final. Três tentativas pararam na fase `BROWSER_LOGIN`, antes de qualquer pedido de retoma ou job: `output/eu-resume-cycle-73d593b1-515b-4d07-a282-9bdf5df447db/report.json`, `output/eu-resume-cycle-137eae14-3cb1-4539-8f38-e0d900e652fb/report.json` e `output/eu-resume-cycle-0699e700-b04f-4b90-b714-47453c740081/report.json`. A última registou apenas a navegação para Keycloak; não observou callback. **Não repetir a operação até resolver o percurso do navegador.** Conferência posterior: EU continua `QUIESCED`/fence 7, 529 v2, sete v1, 137/137 aceites e 11145 com 120000 numérico/sete prazos.
