# Fecho — resolução documental complementar P2

Complete em 29/10/2026. [Contrato e evidências](../features/opportunity-source-resolution.md).

Seis avisos resolvidos e ativos localmente após autorização específica: quatro CEF encerrados em 07/11/2023, ECHE com último prazo 24/03/2026 e OPEN publicado preservado, ESC com sessão encerrada em 22/09/2026 sem extinção da certificação. Horas documentadas com offsets corretos; dados civis sem hora comprovada mantidos como datas.

Migração 035 aditiva; arquivo imutável de decisões, duas representações originais por aviso, documentos, autor e auditoria. Uma alteração relevante da fonte reabre revisão; retoma exige vínculo à decisão verificada. Repetições não criam versões extra; nova revisão explícita de sinalização reaberta conserva o histórico anterior.

Backend 1632 PASS/0 FAIL/7 SKIP preexistentes; frontend 376 PASS/build PASS; sintaxe PASS; Chrome 1440/390 PASS; revisão independente concluída. Gate PostgreSQL descartável 5563 autorizado PASS, com atomicidade, autoridade, ACL, retoma, idempotência e imutabilidade; contentores removidos.

Local: 533 identidades, 1074 revisões anteriores preservadas por hashes, seis novas revisões e seis decisões, 1080 revisões totais. Leitor restrito real validado, evidência interna inacessível; API/frontend 200 e anónimo administrativo 401; worker pronto e zero jobs ativos. Às 00:09Z, catálogo 275 abertas/250 previstas/8 encerradas/0 por confirmar. Execução P2 anterior mantém o estado histórico PARTIAL.

Artefactos: `output/funding-resolution-20261028/`, `output/funding-resolution-local-20261029/` e `output/playwright/funding-resolution-*`. Sem produção, commit, alterações tenant ou início de P3.
