# Aprovação autenticada e suspensão dos escritores EU

Pedido confirmado em 31/10/2026. Estado: Review; implementação e validação isolada concluídas.

## Âmbito

Integrar o percurso HTTP autenticado para consultar/preparar/aprovar/revogar planos v2 e controlar a suspensão/retoma dos escritores EU antes da janela da chamada 11145. Reutilizar a composição, sessão C4G, autenticação recente com MFA opcional e auditoria existentes. A família EU inclui as seleções EU Funding & Tenders, CORDIS e Erasmus que partilham identidades. Não migrar, suspender ou ativar o ambiente habitual nesta entrega; ensaiar em PostgreSQL isolado. Preservar manifestos ativos e trabalho não relacionado.

## Critérios de aceitação

1. Endpoints de administração recebem ator e sessão exclusivamente do servidor, validam sessão/atribuição C4G atual, CSRF/origem e DTO fechado. Perfil de organização ou claims fornecidas pelo cliente não concedem acesso. Autoridade e autenticação recente são revalidadas na transação.
2. Preview/consulta permitem rever os dados factuais do arquivo verificado e o plano exato antes de aprovar. Aprovação/revogação mantêm digests, CAS, TTL, replay e auditoria existentes. Não acrescentar publicação automática nem um endpoint de aceitação nesta fase.
3. Suspensão é durável, auditada, versionada e comum às seleções EU/CORDIS/ERASMUS. Impede novas admissões/escritas, distingue suspensão pedida de quiescência efetiva e protege contra jobs em curso ou retomados com estado obsoleto. Não elimina filas, leases, observações ou histórico.
4. Retoma exige autoridade atual e versão esperada; não reabre escritores legados sobre oportunidades já v2. Interreg/POCTEP e leituras comuns não são suspensos por este controlo EU.
5. A futura aceitação EU exige prova atual da suspensão/quiescência; aprovação isolada não constitui essa prova. Alteração do controlo ou perda de autoridade invalida a operação. Distinguir fence do plano e fence da fonte.
6. Integração no runtime e cliente API fica explicitamente opt-in e indisponível sem capacidade SQL correspondente; comportamento atual na baseline035 mantém-se. SQL novo permanece candidato fora dos manifestos. Nenhuma flag habitual é alterada.
7. Testes HTTP com sessão real persistida e CSRF, revogação/perfis indevidos, concorrência e barreira SQL em base isolada. Cobrir jobs anteriores/novos, suspensão/retoma, rollback de auditoria e preservação; suites backend/frontend, build e sintaxe registados. Distinguir sessão de ensaio de login OIDC completo.

## Plano

Integrar rotas e composição autenticadas; implementar controlo EU durável e barreira de escrita; ligar API cliente; ensaiar percurso integrado, rever e atualizar plano/descritor de migração. A janela habitual continua dependente de autorização, backup/restauro e registo do pacote final.

## Resultado

Critérios 1–7 verificados no [relatório](../../reviews/opportunity-data-standardization/authenticated-approval-eu.md): HTTP com sessão persistida/CSRF, preview factual, aprovação/revogação, controlo EU e barreira SQL; cliente comum e runtime opt-in. Gate com 16 checks PASS, 33 eventos, 386 hashes estáveis e cleanup; backend 2108 PASS/0 FAIL/7 SKIP, frontend 491 PASS/build PASS, sintaxe de 21 ficheiros PASS. S0/Excel e 121 ficheiros ativos preservados. Revisão independente sem bloqueantes conhecidos.

Sessões do gate são fixtures; não certificam login OIDC nem aprovação real. Nenhum acesso, suspensão, migração ou ativação habitual. [Pacote candidato](authenticated-approval-eu-candidate.json) preparado sem registo/ordinais ativos. Retoma v1 após primeira aceitação EU v2 permanece recusada.
