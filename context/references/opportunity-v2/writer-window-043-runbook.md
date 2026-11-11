# Janela habitual 043 — preparação e execução posterior

Este runbook acompanha o [contrato da preparação](writer-window-043-contract.md) e o [contrato do writer EU](eu-writer-contract.md). A fase atual renova preview, backup/restauro e aprovação autenticada do plano. Mantém Central042, tenant034, EU `QUIESCED` e o writer habitual desativado. Não instala043, não configura ou retoma a fonte e não lança recolha.

A evidência concreta da preparação fica em `output/opportunity-eu-writer-window-<windowId>/`: `window.json`, `plan.json`, `plan-summary.json` e `approval-<uuid>.json`. O plano contém referências e hashes exatos do preview, backup e validação; o relatório de fecho deve ligar os ficheiros efetivamente produzidos. Um exemplo de caminho ou o resultado de uma janela anterior não substitui esses ficheiros.

## Baseline e fronteiras

| Elemento | Preparação exigida | Execução posterior proposta |
| --- | --- | --- |
| Central | `042_opportunity_eu_source_control_v2`, ledger e fingerprints normais válidos | Apenas pacote explícito `opportunity-eu-writer-v2`, até043 |
| Tenant | `034_application_snapshot_v2`, identidade física e bindings atuais | Preservar034, dados e grants funcionais |
| Fonte | EU `QUIESCED`; fence observada; zero runs pendentes e leases | Configurar writer em quiescência; retomar por API; voltar a suspender e reconhecer quiescência no fim do primeiro ciclo |
| Configuração | `opportunityActivation` existente válido; `opportunityEuWriter` ausente | Acrescentar apenas o descritor exato do writer para API e worker |
| Chamada11145 | União de identidades sem ambiguidade, head v2 ativo, CAS, receipt/mapping e digests atuais | Preservar identidade; observação igual não cria revisão |
| Recolha | Uma observação pública limitada a `CASCADE:11145`, sem enqueue | Um pedido `EU_FUNDING_TENDERS`; não lançar pedidos CORDIS ou Erasmus |

Não fixar a fence em3, nem a revisão em5: esses valores pertencem a evidência anterior. Usar sempre os valores lidos e vinculados no novo plano. A família de suspensão inclui EU Funding & Tenders, CORDIS e Erasmus; Interreg Europe e POCTEP conservam o percurso existente. A pesquisa EU pode abranger oportunidades de vários programas: não prometer que um ciclo normal só consulta11145.

## Preparação autorizada

1. Fixar a versão do código, SQL043, política `eu-existing-v2.0`, mapping e ficheiros operacionais. Exigir gate isolado recente `PASS`, cleanup confirmado e igualdade dos hashes de entrada com o código atual. Manter o gate histórico e o arquivo da baseline de desempenho intactos; qualquer delta novo exige validação própria. A baseline de desempenho não é uma medição de desempenho nem uma autorização operacional.
2. Renovar a observação pública usando o adaptador da APP. `prepareEuWriterWindow.js --preview-only` é um preview independente; o orquestrador da janela volta a observar a fonte e cria a evidência vinculada à pausa. Os bytes públicos são arquivados e rederivados antes da leitura das bases. Exigir igualdade semântica com o exemplo normativo e o head aceite. Confirmar120000, moeda `NOT_FOUND` e sete prazos somente se a fonte atual conservar esses factos. Variações de timestamps de captura podem alterar o digest do snapshot sem alterar o digest do conteúdo.
3. Executar `scripts/eu-writer-window.cjs --prepare-window --validation=<ficheiro de validação próprio>`. O script recusa outros modos. Verifica saúde, supervisor conhecido e trabalho pendente central/tenant, obtém locks de leitura, pausa os processos conhecidos e confirma ausência de sessões externas antes do backup. Não terminar processos desconhecidos para forçar a janela.
4. Durante a pausa, o preview exige preflight físico042/034, apenas o tenant conhecido, EU quiescente, ausência de pendências, identidade11145 única e ausência de correções, conflitos ou decisões protegidas. Guarda CAS, content/snapshot digests, receipt mapping, contagens e hashes de preservação. Dados privados ficam em PostgreSQL; o relatório contém apenas agregados e hashes.
5. Produzir backup próprio com perfil `EU_WRITER_PREPARATION`, ligado a `windowId` e packageDigest043. A cópia privada tem ACL restrita ao utilizador e SYSTEM. O restauro usa um cluster PostgreSQL18 novo, identificado e isolado em loopback/porta própria; compara dados, schemas, sequências, roles/memberships e configuração. Exigir `PASS`, `cleanup`, `noSourceDrift`, `aclRestricted`, `dataMatches`, `sourceStillMatches` e preflights042/034. A cópia035/033 anterior não serve para esta janela. Guardar os dumps privados; não copiar o seu conteúdo para relatórios públicos.
6. Retomar os processos habituais mesmo se a preparação falhar, através do supervisor conhecido. Confirmar saúde de API, worker e admissões, configuração inalterada, fonte ainda `QUIESCED`, mesma fence e ausência de novas pendências. A retoma dos processos não é a retoma da fonte.
7. Gerar o plano com `scripts/eu-writer-window-plan.cjs --window=<windowId>`. O plano é fechado e contém pacote, baseline, writer, source/fence, CAS e digests aceite, hashes de evidência e entradas, ações propostas e primeiro ciclo controlado. O TTL é de uma hora; preview e backup também têm de ser recentes. Não editar um plano já aprovado para atualizar hashes ou estender validade.
8. Aprovar a preparação com `scripts/eu-writer-window-approve.cjs --window=<windowId>`. O percurso usa login OIDC normal, sessão administrativa persistida, origem e CSRF reais, autenticação recente e política com MFA opcional. Reconsulta o plano no servidor, compara conteúdo/digest, grava auditoria específica e confirma replay idempotente e fonte inalterada. O browser deste helper só pode executar o POST de aprovação da preparação, além do login; não pode configurar, retomar ou recolher.

O resultado esperado desta fase é aprovação `PREPARATION_ONLY`, com auditoria e evidência ligadas ao plano, enquanto043 continua por instalar e a fonte permanece suspensa. A aprovação não concede uma lease, não substitui a sessão na execução e não autoriza aceitação genérica de oportunidades. A baseline tenant na aprovação HTTP é verificada pela evidência; a execução terá de repetir o preflight físico.

## Sequência posterior de instalação e retoma

Esta sequência documenta a proposta a executar numa janela autorizada; os helpers de preparação não a executam.

1. Antes de qualquer efeito, revalidar validade/aprovação do plano, hashes, preview, CAS, estado protegido, fence, baseline042/034, bindings físicos, configuração e saúde. Se existir drift, expiração, fonte diferente ou novas pendências, parar e renovar o plano/evidência apropriados. Uma aprovação expirada não é prorrogada por replay.
2. Obter uma nova pausa coordenada e backup atual se houver escritas posteriores à cópia preparada. Não restaurar automaticamente um backup antigo para satisfazer a baseline. Aplicar exclusivamente `applyRegisteredEuWriterPackage(pool, 'opportunity-eu-writer-v2')`, com preflight normal042 e admissões/fingerprints043 após instalação. Nunca executar SQL avulso, alterar checksums ou preencher o ledger manualmente. Tenant034 fica inalterado.
3. Preservar o descritor11145 e todos os restantes dados de configuração. Acrescentar atomicamente `opportunityEuWriter = {packageId, policyVersion, mappingDigest}`, obtendo valores do pacote e de `euWriterConfiguration()`. A seleção resultante é `OPPORTUNITY_EU_WRITER=canonical-v2`, com runtime de ativação `authenticated-v2`, funding `central`, cobertura `durable-v1` e enriquecimento `verified-v1`. Não reutilizar runs legados como runs canónicos.
4. Substituir/reiniciar os processos API e worker controlados, mantendo EU `QUIESCED`. Exigir readiness normal, Central043, worker com `euWriterSupported=true`, política e mapping iguais aos selecionados. Confirmar a identidade física do serviço e o acesso permitido à role `c4g_eu_writer_runtime`. Não conceder essa role à role humana ou ao leitor para contornar uma falha. O gate não certifica um novo login de worker com privilégios mínimos de ponta a ponta.
5. Com sessão administrativa atual, consultar `GET /api/admin/opportunity-activation/sources/eu`. Configurar por `POST /api/admin/opportunity-activation/sources/eu/writer` com apenas `{requestId, expectedFence}`. Exigir `QUIESCED`, zero pendências/leases e worker compatível. A política e o mapping são derivados no servidor. Guardar recibo, auditoria e nova fence; não calcular a próxima fence sem conferir a resposta.
6. Reconsultar estado/capacidade e retomar por `POST /api/admin/opportunity-activation/sources/eu/resume`, com nova intenção e a fence atual. A mesma sessão, origem, CSRF, autoridade e autenticação recente são verificadas operacionalmente. Uma resposta ambígua exige consultar o estado e reconciliar a mesma intenção; não gerar sucessivos pedidos novos às cegas.

## Primeiro ciclo controlado

O plano propõe um único pedido administrativo `POST /api/admin/integrations/funding-tenders` com `{requestId, source:'EU_FUNDING_TENDERS'}`. Guardar `runId` e eventual `cycleId`; não enviar um segundo pedido, nem pedidos CORDIS/Erasmus, durante a observação.

Observar por no máximo300 segundos antes de solicitar suspensão, ou suspender logo que o ciclo esteja terminal. Os300 segundos são orçamento de observação do operador, não um hard cap dos envelopes: descoberta/refresh, páginas, sucessores e retries usam os limites e deadlines próprios já existentes. Um pedido não garante uma única oportunidade, página, run ou execução. Se atingir o orçamento com trabalho em curso, suspender imediatamente pela API, sem prolongar deadlines nem forjar conclusão.

Em ambos os casos, usar `POST /api/admin/opportunity-activation/sources/eu/suspend` com requestId e fence atual, aguardar o escoamento ou expiração das leases e reconhecer quiescência por `POST /api/admin/opportunity-activation/sources/eu/quiesce` quando `canQuiesce` permitir. O estado final deste primeiro ensaio habitual é sempre `QUIESCED`. Podem restar itens/runs suspensos por reconciliar; quiescência por si só não os transforma em sucesso nem permite apagar o seu histórico.

Antes de propor ampliação:

- Confirmar arquivo v2 completo por candidato e mapping/política do run, sem fallback v1 na família EU.
- Reconciliar11145: identidade/CAS, ausência de revisão extra para observação igual e, se houver uma alteração permitida, uma única revisão com projeções SQL coerentes. Verificar valor monetário, estado da moeda e prazos contra a nova fonte.
- Confirmar `REVIEW` durável para NEW, v1, proteções, mapping divergente, conflitos ou perdas; sem publicação automática e sem inflacionar contadores de criadas/atualizadas. Consultar `GET /api/admin/opportunity-activation/eu-writer/reviews` de forma paginada.
- Verificar estado terminal ou motivo de suspensão, contadores honestos, lineage/retries, fencing, auditoria e replay sem segundo efeito. Comparar preservação do catálogo anterior e referências tenant.
- Registar erros, pendências e a decisão operacional. Uma ampliação exige um novo âmbito explícito; não decorre automaticamente do término deste ciclo.

Suspender também perante readiness incompatível, mapping/política alterados, falhas repetidas, identidade ambígua, perda de factos, revisão inesperada, auditoria incompleta ou qualquer dúvida sobre lease/fence. Nunca interpretar um timeout HTTP como prova de que não houve efeito.

## Recuperação

| Momento da falha | Conduta |
| --- | --- |
| Preparação, antes de qualquer instalação | Preservar relatório de falha e cópias; restabelecer saúde dos processos conhecidos; manter042/034, configuração original e EU `QUIESCED`. Corrigir/renovar apenas a evidência afetada. |
| Migração043 antes do commit | Confirmar rollback da transação e preflight042. Não inferir rollback de um timeout sem consultar o ledger e fingerprints. |
| Após commit043, antes da retoma | Manter EU `QUIESCED`.043 é irreversível; não remover tabelas/guards/ledger nem regressar ao writer v1. Resolver capacidade/configuração/login com o catálogo preservado. |
| Após retoma ou efeitos do ciclo | Suspender, drenar leases e reconhecer quiescência; conservar arquivo, decisões, recibos, revisões, outbox/inbox e auditoria. Reconciliar resultado e redelivery antes de nova retoma. Desativar a flag isoladamente não é recuperação segura de runs canónicos. |
| Restauro necessário | Abrir janela própria, bloquear todos os escritores, escolher cópia coordenada de Central/tenant/configuração e inventariar escritas posteriores. Reconciliar essas escritas antes de qualquer substituição. Revalidar identidade física, bindings, roles, fingerprints, autoridade, sessões e saúde. Nunca restaurar apenas um dos componentes para ocultar drift. |

O restauro ensaiado comprova integridade lógica da cópia no cluster isolado; não realizou substituição da base habitual nem prova recuperação sem perda de escritas posteriores. Dados e evidência históricos permanecem preservados. Falhas de autenticação exigem login normal; não criar sessões, grants ou aprovações diretamente em SQL.
