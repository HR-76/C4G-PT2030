# Funding & Tenders — ADMIN → catálogo central → clientes

**Estado:** Review (2026-10-17). Implementação e precedência por campo confirmadas; ensaio real limitado autorizado e executado em base descartável. A prova no browser com registos reais permanece por fazer.

## Produto aprovado

O administrador da plataforma gere a atualização de fontes na área ADMIN. Oportunidades públicas são recolhidas uma vez para a Central e consultadas por organizações clientes autorizadas. Administradores organizacionais não recebem poderes de plataforma. Candidaturas, tarefas, documentos, interpretações e decisões permanecem no tenant.

Nesta fatia entra apenas EU Funding & Tenders, por atualização manual assíncrona. CORDIS/Erasmus são possíveis filtros da mesma fonte, sem conectores sobrepostos. Sem agendamento, outras fontes, alertas ou painel/framework genérico de configuração.

## Percurso e fronteiras

- Reutilizar a página de integrações para mostrar fonte, última execução, estado, contadores de criadas/atualizadas/falhadas e “Atualizar agora”. Mensagens compreensíveis, sem payloads técnicos ou segredos.
- Autoridade de administração baseada na atribuição central atual `platform_admin_assignment` de `C4G_ADMIN`, sessão válida e controlos reforçados existentes. `SUPPORT`, role `ADMIN` legado e administração organizacional não concedem esta ação. Revalidar a autoridade nas fronteiras de execução; não confiar numa role em cache no browser.
- A API regista intenção idempotente e o worker executa recolha, com exclusão de execução concorrente por fonte, recuperação após reinício e contadores persistentes. Reutilizar F9 e auditoria F7; sem acesso à pool UBI, notificações ou efeitos de candidatura implícitos.
- Reaproveitar consulta/normalização existentes, separando-as dos writes/notificações legados. Destino: catálogo F12 central, com origem API, namespace único da fonte, identificador externo, URL e instante UTC da recolha. Identidade estável, histórico append-only e repetição sem duplicados. Ausência numa resposta não elimina nem arquiva automaticamente.
- Listagem e detalhe centrais explicitamente distintos das oportunidades privadas. Membership/organização centrais atuais governam acesso do cliente; os dados privados nunca integram a resposta central.
- Criar candidatura continua a exigir grants, responsável elegível, prazo, idempotência e auditoria no tenant. Adaptar a origem para referência central e revisão exata/snapshot público mínimo, conforme F12, sem FK/transação distribuída e sem copiar dados privados para a Central. O contrato anterior só aceita origem privada; a extensão é parte desta entrega. Uma atualização da fonte não reescreve silenciosamente a origem histórica de uma candidatura.

## Precedência aprovada

A arquitetura exige preservar correções manuais, mas F12 apenas concretiza revisões/proveniência manuais; não define a aplicação de uma nova versão da API quando diverge de uma correção. Isto muda os dados que todas as organizações veem.

**Confirmado pelo utilizador:** correções explícitas por campo prevalecem; atualizar campos não corrigidos, conservar a nova observação da fonte e o histórico, e sinalizar divergências sem sobrescrever a correção. Não acrescentar um editor genérico nesta fatia.

## Limites técnicos propostos

Limites fixados no servidor, sem os aceitar do cliente como autoridade: até 100 resultados/execução, páginas de até 25, máximo 4 páginas, timeout de 15 s por pedido e orçamento total de 120 s; corpo de resposta limitado. Tratar 429/5xx e falhas de rede com retries limitados sob o mesmo orçamento; falhas de validação são contadas e não geram registos inválidos. Estado de erro conserva os commits já feitos e permite repetição idempotente. Expor que a execução é limitada, sem afirmar catálogo completo. Fixture é o modo de desenvolvimento; acesso real permanece fechado até autorização específica.

## Critérios de aceitação

| ID | Prova necessária |
| --- | --- |
| FT-01 | C4G_ADMIN atual inicia e acompanha execução; cliente, ORG_ADMIN, SUPPORT e ADMIN legado sem atribuição central são recusados; revogação é revalidada. |
| FT-02 | API apenas regista intenção; worker separado recolhe e persiste; duplo clique e concorrência não criam execuções ativas duplicadas. |
| FT-03 | Normalização/datas/paginação têm fixtures; limites, timeout, resposta excessiva, 429/5xx e payload inválido têm testes. |
| FT-04 | Mesmo namespace/identificador mantém uma oportunidade; resposta repetida não duplica conteúdo/revisões; alteração cria histórico com proveniência API. |
| FT-05 | Regra de correções confirmada tem testes; oportunidade ausente da recolha permanece preservada. |
| FT-06 | Falha parcial, crash/reinício e repetição mantêm consistência, histórico e contadores sem efeitos duplicados. |
| FT-07 | A/B consultam a mesma identidade central; listagem/detalhe distinguem origem comum/privada e não expõem trabalho de outro tenant. |
| FT-08 | Criar e consultar candidatura a partir da oportunidade central funciona no tenant, com referência/revisão exatas e controles existentes; A/B não leem candidaturas/tarefas/documentos/decisões cruzados. |
| FT-09 | PostgreSQL descartável Central+A/B e browser demonstram ADMIN → worker → catálogo → cliente → candidatura; testes afetados, sintaxe e build passam. |
| FT-10 | Documentação oficial verificada; ensaio real pequeno preparado com fonte, limite e destino apresentados antes de autorização. Não declarar validação real a partir de fixtures. |

## Documentação oficial e ensaio real

Consultada em 2026-10-17: [Funding & Tenders — APIs oficiais](https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/support/apis). A documentação apresenta SEARCH REST pública por POST e o parâmetro de aplicação usado pelo portal no exemplo oficial; não é necessário presumir uma credencial privada de organização. Documenta filtros por códigos e alerta para resultados multilingues. Endpoint: `https://api.tech.ec.europa.eu/search-api/prod/rest/search`. Na fase de preparação não houve pedidos; o ensaio posterior autorizado está registado abaixo. Quotas, SLA e condições completas de reutilização não ficaram estabelecidos pela página consultada.

Ensaio a preparar após fixtures/gates: fonte EU Funding & Tenders, uma página de no máximo 5 resultados, no máximo 5 oportunidades, destino Central PostgreSQL local descartável e explicitamente identificado antes do pedido de autorização; sem produção, alertas ou agendamento. A autorização ainda não foi pedida nem concedida.

## Evidência inicial e residual

Leitura de AGENTS, arquitetura, standards, F12 e candidaturas concluída. Confirmadas atribuições centrais separadas de memberships, origem central ainda limitada a `C4G_MANUAL`, writes/notificações dos conectores na base legacy e criação de candidatura limitada à oportunidade privada. O worktree já contém mudanças extensas de entregas anteriores; preservar integralmente. Sem alterações de código, migrations, configuração ou dados nesta preparação; sem stage/commit/push/deploy. PostgreSQL/browser e testes desta fatia ainda não executados.

## Implementação e validação — 2026-10-17

A evidência inicial acima é histórica. Implementação e migrations concluídas; [provas, inventário e instruções](../reviews/funding-tenders-central/README.md). PostgreSQL/Chrome com fixtures, worker separado, interrupção forçada e retoma, A/B, correções manuais e criação de candidatura PASS. Backend selecionado 115/115; frontend 91/91 e build PASS; sintaxe 31 ficheiros PASS. Ensaio real autorizado em 2026-10-17: uma página de até cinco resultados em `127.0.0.1:5560/funding_live_rehearsal`, `SUCCESS`, cinco criadas, zero atualizadas/falhadas, cinco listadas e respetivos detalhes lidos após persistência. Contentor descartável removido. Browser com dados reais não comprovado; não declarar prontidão para piloto.
