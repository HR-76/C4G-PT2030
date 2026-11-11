# Plano de fecho das fontes de oportunidades antes da próxima componente

Data: 01/11/2026. Âmbito: contrato v2 e integridade da recolha; as filas OIDC da migração são ferramentas operacionais, não funcionalidades de navegação do produto.

## Estado comprovado

| Área | Estado | Evidência / limite |
|---|---|---|
| EU legado | 391 candidatos arquivados e aceites; zero pendentes neste lote | 391 planos/decisões OIDC e recibos; 401 dotações e 422 prazos derivados conferidos; sete conflitos excluídos; [fecho](eu-legacy-acceptance-391-preparation.md) |
| Fonte EU automática | Suspensa (`QUIESCED`, fence 7) | Não reativada pela aceitação; a paridade da 11145 foi comprovada antes, mas não equivale a cobertura de todo o catálogo |
| Portugal2030 | Adaptador v2 e corpus normativo de 177 linhas validados localmente | [S3](s3.md); ativação habitual por fonte e atualização contínua ainda exigem janela própria |
| Interreg Europe / POCTEP | 3 + 10 snapshots v2 locais | [S4](s4.md); cobertura documental e de chamadas além do corpus ainda limitada |
| CORDIS / Erasmus+ | Seleção e arquivo EU diferenciados no contrato | Não tratar projetos históricos CORDIS como oportunidades abertas; provar cobertura e paridade por fonte antes da ativação |

## Prioridades

1. **P0 — retirar ferramentas de migração da navegação permanente (feito).** Remover «Pré-aprovações EU» e «Aceitações EU» da Sidebar e o atalho da pré-aprovação do dashboard. Manter apenas rotas diretas administrativas autenticadas para arquivo/recuperação, sem as apresentar como produto. A navegação regular usa «Fontes de oportunidades». Regressão de navegação, suite frontend e build são gates.
2. **P1 — inventário EU global atualizado; decisões ainda pendentes.** A [verificação read-only atual](eu-api-integrity-current-2026-11-01.md) conta 392 v2 e 144 v1: 391 aceites, 137 com candidato `REVIEW` e sete sem candidato. Os sete lookups oficiais continuam em conflito; cinco pertencem ao ciclo antigo e dois são Erasmus/ESC. Rever e decidir individualmente os 137 candidatos com OIDC; resolver os sete apenas quando a evidência oficial permitir uma variante única, conservando `CONFLICT` nos restantes. Não reescrever o campo auxiliar `funderName` histórico sem migração própria.
3. **P2 — retoma controlada do escritor EU.** Só depois de P1, gerar preview e backup/restauro atualizados, verificar autoridade OIDC e código, executar um ciclo limitado com fonte/fence e paragem automática. Comparar API oficial → arquivo → revisão v2 → SQL, incluindo a chamada 11145 (`120000` e sete prazos) e casos com moeda não publicada. Novos IDs e migrações v1 continuam em revisão; atualizações v2 sem perda/conflito seguem a política aprovada. Saída: contagens, digests, erros, auditoria, recuperação ensaiada e decisão explícita de manter ou ampliar a recolha.
4. **P3 — ativação por fonte de Portugal2030, Interreg/POCTEP, Erasmus+ e CORDIS.** Para cada fonte, fixar identidade, campos, unidade monetária, precisão UTC, arquivo de evidência, cobertura de endpoints/documentos, deduplicação e política de conflito. Repetir gate isolado PostgreSQL/HTTP, preview e reconciliação habitual antes de ativar. Portugal2030 começa pelas 177 linhas normativas; Interreg/POCTEP pela amostra 3+10 e pelos conflitos documentais conhecidos. CORDIS tem contrato de projeto/histórico separado de convocatória.
5. **P4 — vigilância contínua de qualidade.** Expor em «Fontes de oportunidades» saúde e última recolha por fonte, diferença de contagens, campos `NOT_FOUND`/`CONFLICT`, dotação numérica, moeda explicitamente comprovada, datas ISO 8601, prazos e URLs de evidência. Alertar em drift ou perda; bloquear aceitação automática desses casos. Amostrar paridade oficial periodicamente e preservar versões/revisões para auditoria.

## Critério para avançar para a próxima componente

A aceitação dos 391 e a limpeza da navegação estão fechadas. Pode iniciar-se trabalho **isolado** na próxima fonte ou componente sem reativar EU, desde que os sete conflitos permaneçam visíveis/quarentenados. Para afirmar que a recolha EU habitual está pronta em produção, faltam P1 e P2 com evidência atual. Cada outra fonte só fica pronta após o respetivo P3; os gates locais S3/S4 não são prova de ativação habitual.
