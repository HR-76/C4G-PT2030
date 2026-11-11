# Candidaturas — equipa e tarefas: evidência do incremento

Estado: **READY_FOR_HUMAN_REVIEW**, sem fecho humano. Contrato: [application-team-tasks.md](../../features/application-team-tasks.md).

## Implementação e provas

- Backend: migration tenant 022 aditiva; participantes sem eliminação, tarefas abertas/concluídas/canceladas, revisão CAS agregada, recibos de idempotência, histórico append-only e auditoria F7 na mesma transação. `application.read/edit` e guardas cumulativas da primeira fatia; membership central valida ator e atribuição. Participar não concede grants. Consulta de tarefas, participantes e histórico paginada.
- Interface: detalhe da candidatura permite gerir participantes e tarefas; mantém intenção incerta por utilizador/organização, sem repetição automática. Após uma mutação, espera pela leitura da revisão atual antes de reativar os controlos. Logout remove intenções pendentes.
- PostgreSQL 17 descartável: migration 022 `up`, recusa de `down` ocupada e `down` vazia com retorno ao fingerprint 021 PASS; fingerprint 022 `d1ab7a44ecd5efbfabf288c1173a4c5abc94c3bec547e407264453b289a01952`. Gate HTTP A/B de participantes/tarefas, IDOR, revogação, responsável externo, CAS, duplo envio e rollback de auditoria PASS.
- Chrome sobre PostgreSQL real: adicionar/remover participante, criar/editar/concluir/cancelar tarefas e reler histórico após reload PASS; candidatura da organização B não expôs o detalhe. A interface esperou a nova revisão antes de permitir o envio seguinte. Prova `APPLICATION_BROWSER_POSTGRES_AB PASS` com `browser.work` completo.
- Recuperação de COMMIT incerto da operação `APPLICATION_WORK_EDIT`: PostgreSQL HTTP em duas organizações devolveu o mesmo recibo após perda da resposta e releitura mostrou uma só tarefa (`uncertainCommitRecovered: true`).
- Primeira fatia com 022 admitida: gate PostgreSQL/Chrome PASS, incluindo criação, edição, transição, histórico e recuperação de resultado incerto.
- Backend 860/860; frontend 87/87; build PASS. Testes focados de paginação cobrem 53 tarefas e 53 revisões, sem omissão/duplicação.
- Correção da revisão final: o histórico na interface apresenta identificador da tarefa, autor e valores resultantes (título, responsável, prazo e estado). Teste focado `ApplicationWork.test.jsx` 4/4 PASS, incluindo apresentação de entrada de edição com novo responsável/prazo após reload; build frontend PASS. Revisão técnica restrita: GO, sem fecho humano declarado.

## Pendências únicas

- **Blockers do percurso:** nenhum identificado.
- **Melhorias adiáveis para revisão transversal:** ensaio de acessibilidade integral e desempenho com volumes institucionais reais. Fora desta fatia: documentos, aprovação interna, submissão externa, etapas configuráveis, alertas e reporting.

Provas locais usam IdP simulado e PostgreSQL descartável; não validam staging, produção, IdP externo nem dados reais. O fecho humano da primeira fatia permanece intacto. Sem stage/commit/push/deploy.
