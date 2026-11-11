# Execução habitual 043 e primeiro ciclo EU

31/10/2026 — pedido explícito: executar a janela043 e o primeiro cicloEU, revalidando backup, plano e autoridade, com suspensão final para conferência. Segue o [runbook preparado](writer-window-043-runbook.md) e a política confirmada: v2 existente sem perdas/conflitos pode atualizar; novos IDs e migrações v1 ficam em revisão.

## Critérios de aceitação

1. Revalidar código/provas, pacote043, preview11145, baseline042/034, fonteQUIESCED/fence, CAS, proteção e configuração. Se o plano preparado expirou ou os inputs mudaram, renovar preview/backup/plano e aprovação autenticada, preservando a evidência anterior.
2. Ensaiar os novos executores operacionais em âmbito isolado, com testes de falhas e suspensão final. Não alterar SQL043 nem migradores registados para contornar problemas.
3. Na pausa de execução, renovar backup/restauro coordenado Central/tenant/configuração, verificar ausência de trabalho/sessões externas e revalidar a fronteira da cópia antes da instalação. As escritas normais de autenticação/auditoria posteriores à preparação são conservadas no backup da execução.
4. Instalar exclusivamente `opportunity-eu-writer-v2` via migrador registado,042→043, preservando tenant034, ledger e dados anteriores. Acrescentar só `opportunityEuWriter` à configuração habitual. Confirmar login físico/capacidade do worker e saúde; manterEU quiescente até configuração/retoma autenticadas.
5. Com OIDC/CSRF/autorização recente, configurar writer, retomar e lançar um único pedido normal `EU_FUNDING_TENDERS`. Observar até terminal ou300s; suspender e reconhecer quiescência no fim, incluindo falhas após retoma. Não lançar outro ciclo ou outras seleções. Quiescência não implica escoamento completo de todos os runs suspensos.
6. Conferir arquivo canónico,11145 e SQL monetário/prazos, decisõesREVIEW, contadores, execução/retries/fences, auditoria, preservação das identidades/revisões e dados tenant. Reportar honestamente sucesso, parcialidade, pendências e limites.
7. Recuperação: antes do commit regressar ao estado verificado; após043 conservarEU suspensa e resolver capacidade/configuração, sem downgradev1. Não restaurar/destruir bases automaticamente. Uma resposta HTTP incerta exige reconciliação da mesma intenção; nunca criar pedidos adicionais às cegas.

Este pedido autoriza a janela operacional e o ciclo descritos. Não autoriza Git/publicação/deploy remoto, recolha contínua, ampliação às outras fontes ou substituição destrutiva das bases. Estado ativo e evidência ficarão no relatório próprio; contratos/pacotes/provas anteriores permanecem preservados.
