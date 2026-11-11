# Comunicação administrativa — recuperação integrada

18/10/2026. Estado Review. Implementação, ativação e conferência OIDC local concluídas; revisão visual com o utilizador pendente. A entrega 4 global permanece em curso.

## Alterações

- Política confirmada: apenas ORG_ADMIN, cumulativamente com a permissão explícita de administração; pessoas escolhidas individualmente, com opção de selecionar todos os membros ativos da organização. Nada selecionado por defeito.
- O piloto tem broadcast no backend; não foi encontrado formulário original. Formulário novo adaptado à composição C4G, com título/mensagem em texto simples, seleção explícita, revisão antes de enviar, resultado, histórico e detalhe. Cartões e filtros originais reutilizados.
- Migração 030 registada, validada e aplicada localmente: aviso, destinatários, leitura própria, RLS, imutabilidade e eventos F7. Sem edição/apagamento de avisos enviados ou monitorização de leitura pelo administrador.
- Composição F4/F5/F7 e rotas ligadas ao cliente. `notification.read` permite receber avisos gerais sem acesso a candidaturas; os alertas de candidatura mantêm a autorização do recurso. `organization_notice.manage` não substitui a verificação do perfil atual.
- Repetição com a mesma intenção não duplica; recuperação de COMMIT incerto consulta o recibo do aviso com organização, sujeito, membership e digest. Na interface, uma resposta incerta conserva o pedido e bloqueia edição até resolver; troca de contexto descarta o rascunho e respostas atrasadas.
- Cursor conserva microssegundos do PostgreSQL para não omitir linhas na fronteira de páginas.

## Validação realizada

**120 testes backend PASS**, cobrindo avisos, alertas, candidaturas, tarefas, parceiros, catálogos F5/F7, execução F4, composição produtiva, coordenação e recuperação de autoridade. [Log](../../output/playwright/c4g-notices/backend-tests.log). Sintaxe dos ficheiros JavaScript alterados e `git diff --check` PASS.

**17 testes frontend PASS** (`Notifications.test.jsx` e `OrganizationNotices.test.jsx`): nome público da organização, seleção vazia, selecionar todos, revisão explícita, pedido incerto idempotente, bloqueio de duplicação em curso, destinatário indisponível, histórico e descarte de contexto/respostas. `npm run build` PASS.

**PostgreSQL 17 e HTTP reais A/B PASS**, por `test/integration/organization-notices/gate.ps1`. A prova inicial de fundação com ports injetados foi conservada e complementada pelo percurso integrado real. Verificados destinatários, recusa de FUNDING_MANAGER mesmo com permissão, membro comum sem administração, revogação central, membro suspenso, outra organização, leitura sem grants de candidaturas, falha F7 revertendo envio/leitura e recuperação de COMMIT incerto sem duplicação. Concessão local de permissões testada sob coordenador, preservando grants anteriores, com evento GRANT_CHANGED atómico e repetição sem nova concessão/evento.

**Regressão dos alertas anteriores PASS** no mesmo gate: equipa, exclusão do autor, mudança de estado, prazos, leitura individual/em lote, contagem, links, revogação de acesso à oportunidade, RLS, falha F7 e repetição. Nenhum teste de autorização foi relaxado: os atores de ensaio receberam explicitamente a nova permissão de caixa pessoal.

**Chrome 1440/390 PASS** com HTTP/DB reais e dados sintéticos: preparar, selecionar pessoa, rever, enviar, consultar histórico, receber e ler sem duplicação, recarregar e verificar a outra organização. Capturas inspecionadas lado a lado com o piloto; sem overflow da página. A tabela permite deslocação horizontal no telemóvel.

Provas: [fundação/migração](../../output/organization-notices/foundation-verification.json), [HTTP](../../output/playwright/c4g-notices/verification.json), [browser](../../output/playwright/c4g-notices/visual-verification.json), [regressão de alertas](../../output/playwright/c4g-alerts/verification.json), [comparação](../../output/playwright/c4g-notices/comparison.html). O gate removeu a instância descartável no fim.

## Ativação habitual

`backend/scripts/localPlatform/organizationNotices.js --apply`: PASS. Backups Central/tenant com ACL restrita e leitura por `pg_restore --list` confirmada, em `.tmp/local-platform/notices-backup-1792329384815`. Migração tenant 030 e duas permissões explícitas para a membership atual, atribuídas sob coordenador e com auditoria. Grants anteriores, identidades, memberships, catálogo central, campos/tarefas/histórico e restantes dados tenant preservados. API reiniciada; worker existente mantido. [Prova](../../output/playwright/c4g-notices/local-upgrade.json).

O script de conferência OIDC bloqueia envios e restantes escritas de negócio, permitindo apenas autenticação e a verificação pessoal de prazos já existente. A conta da organização abre o formulário; caixa e histórico locais estão vazios, com seleção inicial vazia. A conta de administração da plataforma sem organização encontra o bloqueio existente de Área da organização (HTTP 409 ORGANIZATION_SELECTION_REQUIRED). A primeira asserção do teste esperava o texto do componente interno e depois 403; ambas foram corrigidas para o contrato existente, sem alteração da aplicação.

**Conferência OIDC habitual PASS:** conta organizacional com `canManage=true`, um membro disponível e caixa real vazia; conta da plataforma sem acesso organizacional recusada. Desktop/móvel sem overflow, zero erros de página, zero escritas de negócio e hashes de dados preservados. [Resultado](../../output/playwright/c4g-notices/native-verification.json). O nome público C4G foi conferido no formulário; não se apresenta UUID de organização na confirmação.

## Limites e pendências

Nenhum aviso real foi enviado a terceiros. Envio/receção foram demonstrados com contas sintéticas identificadas; a conferência habitual é de leitura/preparação. O rascunho fica apenas no componente e perde-se na troca de contexto. As concessões explícitas deste instalador abrangem a organização local; não existe distribuição automática de grants entre organizações ou a futuros membros.

Email, R2 e antivírus continuam adiados pelo utilizador. A entrega 4 global permanece em curso.

Próximo passo: rever a comparação com o utilizador na aplicação habitual.
