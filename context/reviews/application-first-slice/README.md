# Candidaturas — primeira fatia utilizável (2026-10-17)

**Estado: Complete — fecho humano restrito aprovado em 2026-10-17.** A revisão final recomendou GO, sem findings materiais; o utilizador confirmou a aprovação. Contrato: [application-first-slice.md](../../features/application-first-slice.md). O percurso disponibilizado é oportunidade acessível → criar candidatura → atribuir responsável e prazo → editar/transitar → consultar detalhe e histórico. A avaliação F14 exata é opcional e apenas uma referência, nunca prova de elegibilidade.

## Evidência

- `test/integration/applications/first-slice-gate.ps1`: PostgreSQL descartável com dois tenants e Chrome real, **PASS**. Cobriu criação manual, prazo e responsável obrigatórios, responsável de outra organização recusado, IDOR e A/B, edição, transição, histórico, auditoria F7, duplo envio, CAS/concorrência e recuperação após confirmação incerta. No browser, a criação foi confirmada no servidor, a resposta foi substituída por 503, a página foi recarregada e o mesmo envio recuperou a candidatura original; `uncertainCreateRecovered: true`.
- `PQ1_PHASE=application-link` em `test/integration/f13/pq1-consolidated-gate.ps1`: PostgreSQL descartável, **APPLICATION_EXACT_F14_LINK_POSTGRES_AB PASS** e **PQ1_EFFECTIVE_CENTRAL_AB PASS**. Criou candidatura com avaliação exata da mesma oportunidade, confirmou vínculo persistido, repetição idempotente, leitura/histórico e recusa A/B.
- `test/integration/applications/migration-probe.ps1`: **PASS** para fingerprint 021, recusa de downgrade com dados e reversão vazia até 020.
- Testes focados de domínio, F4/F5/F7/F42/F43 e composição: **76/76 PASS**; `node --check` backend: **PASS**. `PrivateApplications.test.jsx` prova seleção de responsáveis na segunda página e recuperação 503 → 404 ainda incerto → 409 `STALE_REVISION` definitivo → nova edição. A intenção é vinculada a utilizador/organização e limpa no logout ou 401; `SessionBoundary.test.jsx` prova 503 → logout com `AuthProvider` real → outro utilizador na mesma organização, sem repetição nem segunda escrita. Após estas alterações, frontend **84/84 PASS**, build **PASS** e gate PostgreSQL/Chrome de candidaturas **PASS** (`uncertainCreateRecovered: true`). O gate F12 completo com a migração 021 passou antes da alteração final de recuperação, coberta pelos testes focados e pelo gate de candidaturas. Não se repetiu F13→F14 integral.

## Pendências únicas

- **Blockers desta fatia:** os três findings de interface da revisão foram corrigidos; nenhum blocker identificado. Fecho humano restrito aprovado; sem deploy.
- **Melhorias adiáveis:** equipa alargada, tarefas/documentos por etapa, aprovação interna, submissão externa, alertas, reporting avançado e migração de candidaturas UBI. São incrementos posteriores; não representam o pipeline completo.

## Experimentar localmente

Com PostgreSQL, bases Central e tenant e o modo F12 privado configurados conforme `backend/.env.example`, aplicar as migrações até tenant 021, iniciar `backend` com `npm run dev` e `frontend` com `npm run dev`. Entrar com uma membership central ativa e grants `application.read/create/edit/transition` mais `opportunity.read`. Abrir uma oportunidade privada acessível, seguir **Criar candidatura**, indicar título, responsável e prazo, e guardar. A listagem **Candidaturas** e o detalhe permitem edição, transição e consulta do histórico. Para testar sem dados persistentes locais: `powershell -NoProfile -ExecutionPolicy Bypass -File test/integration/applications/first-slice-gate.ps1` com Docker e Chrome instalados.
