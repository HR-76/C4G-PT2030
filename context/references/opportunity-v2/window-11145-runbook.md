# Janela da chamada 11145

**Janela executada em31/10/2026:** [recibo e resultado habitual](../../reviews/opportunity-data-standardization/habitual-11145.md), com backup/restauro renovados,042/034 instalados, aprovação OIDC e11145 aceite em revisão5. EU permanece quiescente. O procedimento abaixo documenta a primeira instalação; os helpers que exigem baseline035/033 recusam corretamente a instalação agora atualizada. Os recibos anteriores permanecem históricos.

## Pacote registado

Identificador: `opportunity-v2-activation-11145`.

Digest: `4f83267f1c2d3f41c604453f3489136397f661fbc06a99de8b79ed2980674e7a`.

O registo executável é `backend/src/security/opportunityV2MigrationPackage.js`. Os manifestos distinguem a baseline predefinida Central035/tenant033 do pacote explicitamente selecionado. O arranque e os migradores predefinidos não instalam este pacote. Os SQL medidos conservam os seus bytes e localizações em `candidates/`; não devem ser executados avulsamente.

| Ordem | Central | Finalidade |
| --- | --- | --- |
| 036 | `funding_canonical_v2` | Arquivo de observações EU v2 |
| 037 | `manual_opportunity_v2` | Autoria central v2 |
| 038 | `pt2030_plan_v2` | Arquivo de planos Portugal2030 |
| 039 | `opportunity_persistence_v2` | Persistência/reconciliação v2 |
| 040 | `opportunity_activation_authority_v2` | Autoridade operacional |
| 041 | `opportunity_activation_approval_v2` | Planos e aprovações duráveis |
| 042 | `opportunity_eu_source_control_v2` | Suspensão e fence da família EU |

Tenant034: `application_snapshot_v2`, capacidade `APPLICATION_OPPORTUNITY_SNAPSHOT_V2`. Os sete passos centrais aplicam-se numa transação; versões centrais intermédias não são admitidas como runtime. A migração tenant e a publicação da sua observação são coordenadas pelo runner existente, com controlo de revisão. Não há transação distribuída entre Central e tenant: manter serviços parados até ambas as verificações finais passarem.

O alvo predefinido de provisionamento também permanece033. Antes de disponibilizar escrita de snapshots v2 a outros tenants, instalar/publicar explicitamente034 em cada consumidor ou aprovar a evolução do alvo de provisionamento. O ensaio desta janela não certifica automaticamente organizações criadas posteriormente.

## Repetir a preparação

1. Confirmar os hashes de entrada da prova do pacote registado, o packageDigest e o workbook/contrato normativo. Qualquer alteração relevante exige nova prova; não editar o relatório para fazer corresponder o resultado.
2. Confirmar baseline Central035/tenant033, tenant/generation únicos e configuração local esperada. Não usar os helpers desta preparação em produção, noutro host ou após a instalação do pacote; esses alvos falham explicitamente.
3. Executar `node scripts/opportunity-v2-window.cjs --prepare-window`. O helper consulta apenas a identidade pública `CASCADE:11145`, guarda uma observação nova e verifica saúde e propriedade dos processos locais.
4. Sob locks, exigir filas de recolha, execuções, inbox/outbox e admissões sem trabalho pendente/em curso relevante. Parar apenas a árvore previamente verificada; sessões ou processos desconhecidos impedem o backup, sem serem terminados.
5. Durante a pausa, atualizar o preview READ ONLY, obter a prova de pausa de uso único e criar backups próprios com ACL restrita. Restaurar apenas num cluster PostgreSQL18 nativo, novo, com porta loopback efémera e marcador de propriedade.
6. Comparar dados completos por hash, sequências, schema, roles/ACLs, identidade, ledger e configuração; confirmar ausência de divergência na origem. Encerrar o cluster de restauro e retomar o supervisor local, incluindo API, worker e admissões. Guardar tempos/resultados e preservar os backups.

O preview identifica revisão e rowVersion da 11145, correções e resoluções protegidas, digest da observação e do mapping. Não equivale a um plano aprovado. A cópia é consistente durante a pausa registada; alterações posteriores exigem renovação. A retoma normal pode produzir escritas operacionais imediatamente.

A projeção histórica `async_exec.execution` do Central pode continuar `QUEUED` depois da conclusão de uma recolha. A preparação não altera esses registos. Só considera essa projeção resolvida quando existe outbox publicado com identidade/organização/tipo/digests correspondentes e um run funding terminal, concluído e sem lease. Prazo expirado, isoladamente, não prova conclusão; trabalho órfão ou de tipo desconhecido impede a pausa. O tenant usa os seus inbox/outbox, sem pressupor a tabela de execução exclusiva do Central.

## Instalação posterior

1. Confirmar autorização para a instalação/aceitação concreta, âmbito das bases e pacote exato. Renovar a preparação e os backups na janela em que será aplicada a migração. Conservar todos os artefactos anteriores.
2. A primeira instalação exige parar os escritores legados antes do SQL: o endpoint de suspensão depende de042 e ainda não existe na baseline035. Confirmar árvore de processos, sessões, filas e integridade dos backups. O heartbeat isoladamente não prova ausência de escritores antigos.
3. Com os serviços parados, usar `applyRegisteredCentralPackage(pool, packageId)` e `createRegisteredTenantMigrationRunner({pool, packageId, observationPublisher, ...})`, com identidade/generation/revisão atuais. Não injetar manifestos alternativos, ignorar fingerprints ou reescrever o ledger histórico.
4. Exigir preflight normal Central042/tenant034, publicação consistente da capacidade tenant e admissão real do coordenador. Comparar contagens, snapshots e vínculos anteriores. Uma aplicação parcial entre bases mantém a janela fechada para tráfego até recuperação explícita.
5. Configurar coerentemente `OPPORTUNITY_ACTIVATION_RUNTIME=authenticated-v2` na API e no worker autorizado; confirmar capacidade SQL e os binários previstos antes de disponibilizar as rotas. Selecionar também `OPPORTUNITY_11145_EXECUTOR=bounded-v2` na API e seguir o [runbook do executor](executor-11145-runbook.md): recolher11145 enquanto EU está `ACTIVE`, obter arquivo real e só depois suspender/quiescer para preparar/aceitar. O executor usa fonte/adaptador/arquivo reais e transações próprias; não liga o coletor genérico. Exigir run `SUCCESS`, `limited=false`, `canonical_v2_required=true`, arquivo verificado e auditoria. Um ficheiro de preview local não é um arquivo de recolha aprovado na base. Nem a preparação de backup nem a instalação SQL executam esta recolha.
6. Por sessão administrativa persistida, origem/CSRF e política MFA vigentes, pedir suspensão de EU, aguardar quiescência e confirmar o fence atual. Recalcular o plano sobre o arquivo e a revisão aceite; rejeitar alterações de mapping, CAS, correções, resolução, hash ou identidade.
7. Conferir título/referências/programa, datas e os sete cut-offs, SUSA/acordo101190010 e dotação120000. A moeda da dotação permanece `NOT_FOUND` se a fonte continuar sem a publicar; EUR de apoio mensal não a substitui. Aprovar o digest exato dentro do TTL de uma hora.
8. A aceitação pelo endpoint específico `/api/admin/opportunity-activation/calls/11145/plans/:planId/accept` usa digest, plano, fence, sourceFence e CAS atuais, com autoridade/aprovação/auditoria na transação. Seguir os DTOs e regras de replay do runbook do executor. Validar nova revisão, valor monetário, calendário, leitores v1/v2 e preservação de UUID, histórico e vínculos privados. Não fabricar aprovação nem aceitar em lote as restantes fontes.

## Recuperação

Falha antes da pausa: recusar a operação e manter os serviços. Falha durante preparação: libertar todos os locks/conexões, encerrar o cluster próprio e retomar/validar a saúde habitual. Se a retoma falhar, conservar o relatório FAIL e investigar o supervisor verificado; nunca terminar processos desconhecidos.

Falha no pacote central antes do commit desfaz os sete passos. As migrações são irreversíveis; não usar `down`, apagar ledger ou remover histórico. Se já houve commit numa base, manter a aplicação suspensa e escolher correção progressiva ou restauro controlado numa nova base/generation, conforme o ponto de falha e as escritas posteriores.

Um restauro de recuperação parte dos dumps/configuração próprios e dos hashes registados, em bases novas, com confirmação de identidade, schema, roles, ACLs, ledger, dados e sequências. Repor os segredos de autenticação a partir dos ficheiros privados de configuração, sem os registar em logs. A prova de restauro prepara schema/dados; um novo destino operacional exige ainda prova de autenticação dos logins, bindings/credenciais de API/worker, OIDC e saúde antes da troca. Não restaurar por cima da base habitual nem trocar bindings silenciosamente.

Antes de aceitar EUv2, a retoma dos writers EU só é permitida pelo controlo durável quando todas as condições forem satisfeitas. Depois da primeira aceitação EUv2, manter a família EU quiescente: a recuperação normal é nova revisão auditada e writer compatível, nunca a retoma do writer v1. Preservar escritas posteriores e reconciliá-las antes de qualquer restauro integral.

O ensaio local não certifica desastre de máquina, recuperação do fornecedor OIDC, armazenamento externo de documentos ou um RTO operacional completo. Esses serviços não são alterados pelo pacote SQL. RPO é limitado ao instante da cópia; duração observada do restauro isolado não é promessa de duração de recuperação em produção.

## Fontes fora desta janela

Excel Portugal2030:177 linhas normativas preservadas; a instalação do arquivo não ativa a cadeia central de upload/antivírus/worker nem certifica a API PT2030. POCTEP10 conserva o bloqueio documental. Nenhuma dessas fontes é aceite ou importada novamente nesta preparação.
