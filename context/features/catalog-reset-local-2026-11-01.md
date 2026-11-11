# Reset local do catálogo

Estado: Complete. Autorização explícita do utilizador em 01/11/2026: eliminar todo o catálogo para futura recolha de raiz. Esta instrução substitui, apenas nesta operação, a política normal de arquivo lógico. Não autoriza reset de organizações, contas ou candidaturas.

Alvo confirmado pelo runtime/LOCAL.md: PostgreSQL local, `c4g_central_dev`; tenant `c4g_tenant_dev` apenas leitura. Inventário inicial: 538 oportunidades, 2030 revisões; todas as tabelas de catálogo/candidaturas/interesses do tenant vazias.

Plano: pausar serviços locais, guardar dump privado completo da Central e verificar leitura integral do arquivo; validar ausência de jobs pendentes e dependências privadas; ensaiar transação com rollback; esvaziar 37 tabelas explícitas de conteúdo/recolha do catálogo sem CASCADE; repor os triggers exatamente; verificar zero oportunidades/revisões, esquema e restantes dados inalterados; reiniciar serviços.

Preservar auditoria, identidades, permissões, dados organizacionais e controlos de fonte/recibos antirreplay (`eu_source_control_v2`, `eu_source_control_receipt_v2`, `eu_legacy_prearchive_use_v1`). Estes registos são controlo de segurança, não oportunidades. EU continua QUIESCED; nova importação fica fora desta operação.

Critérios: 37 tabelas a zero; hashes de todas as restantes tabelas Central e de todo o tenant iguais; triggers/esquema iguais; backup legível; saúde local após retoma. A verificação do dump não equivale a ensaio de restauro numa base nova.

## Resultado verificado

Executado em 01/11/2026 às 16:28 UTC: **538 → 0 oportunidades**, **2030 → 0 revisões**, todas as 37 tabelas selecionadas a zero. Fonte EU preservada `QUIESCED`, fence 7. Hashes de todo o tenant e de todas as restantes tabelas Central iguais, exceto a alteração explícita da tarefa residual abaixo. Esquema validado pelo manifesto instalado; 25 triggers de TRUNCATE repostos com os estados exatos anteriores.

Encontrada uma tarefa pg-boss `active` residual (`a3970ea8-07d0-436a-994a-f55e632a1cdf`), cujo run já estava `ERROR/FUNDING_EXECUTION_EXPIRED`, sem lease. As duas primeiras tentativas recusaram continuar antes de qualquer mutação. Na transação final, apenas essa tarefa foi cancelada, preservando o seu conteúdo e todos os restantes jobs, para impedir execução após o reset. Nenhuma tarefa de outra funcionalidade foi alterada.

Backup privado completo: `.tmp/local-platform/catalog-reset-2026-11-01T16-28-32-529Z/central-before-reset.dump`, 17 913 679 bytes, SHA-256 `2295b3008a7d1aef91c36b028bcfa438da7a59db88fd3848c37496ebee4c3d07`. ACL limitada ao utilizador/SYSTEM; listagem e extração integral de dados do arquivo PASS. Sem ensaio de restauro numa nova base.

Validação: dois testes de âmbito/preservação PASS; sintaxe PASS; ensaio transacional com rollback e equivalência integral ao baseline PASS; execução definitiva PASS; verificação posterior ao restart confirma catálogo central/privado zero e nenhuma tarefa de recolha pendente. Frontend3000 e `/api/local-health`5000 respondem HTTP200. Serviços locais retomados. Relatório: `output/catalog-reset-result.json`.

As provas/contagens anteriores de aceitação EU continuam válidas como histórico e backup, mas não descrevem o catálogo corrente. Previews e pacotes de ativação anteriores não devem ser reutilizados para a nova carga.
