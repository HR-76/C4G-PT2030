# Acesso dos técnicos pela equipa da candidatura

Estado: **Review — 18/10/2026, 15:44 (Lisboa)**. Correção implementada e validada em PostgreSQL/HTTP e Chrome descartáveis; API habitual reiniciada com a correção, sem migrações. Verificação OIDC habitual PASS. O fecho humano/global da entrega 5 permanece pendente.

## Contrato deste incremento

- Técnico corresponde ao perfil central existente `CONTRIBUTOR`. Membership e identidade centrais vigentes continuam obrigatórias.
- A participação ativa em `application_participant`, na mesma organização, permite ler a candidatura. Departamento, ficha de pessoa, responsabilidade por uma tarefa ou contacto de parceiro não substituem a participação.
- Um técnico sem participação ativa não pode ler ou alterar a candidatura, mesmo que possua grants amplos anteriores. Os grants não são apagados; administrador/gestor e outros perfis mantêm a política existente.
- Participar concede apenas leitura. Não concede edição, transição, gestão de equipa ou permissões documentais gerais. Operações de escrita existentes exigem também a participação ativa.
- Listas, resumos por oportunidade, parceiros, alertas, indicadores e CSV usam o mesmo âmbito. As guardas de leitura da oportunidade/avaliação referenciada são satisfeitas apenas dentro do percurso da candidatura acessível; não se concede consulta geral de oportunidades privadas ou avaliações.
- Remover da equipa retira o acesso nos pedidos seguintes, incluindo sessão já aberta e exportação com digest anterior. Tarefas, responsáveis, histórico e recibos permanecem intactos. Atribuições históricas fora da equipa não concedem acesso implícito.
- Sem convites externos, novos perfis, novas configurações ou alterações de dados reais neste incremento.

## Implementação

Política efetiva por recurso, aplicada dentro da composição de candidaturas e da autorização F5 existente. A política central é revalidada; a participação é consultada na transação tenant, sob o bloqueio organizacional já partilhado por leituras e mutações da equipa. Não persistir grants derivados nem manter cache entre pedidos. Preservar auditoria, versões de autoridade e commit guard.

`teamAccess.js` aplica a restrição exclusivamente à composição de candidaturas. A autorização de outros módulos mantém o comportamento anterior. A exceção de leitura da avaliação F14 tem ligação exata ao recurso, embora o catálogo da permissão use âmbito de organização. A otimização antiga de transições da lista deixou de contornar essa política: as capacidades visíveis passam pela mesma autorização.

Listas filtradas e resumos por oportunidade autorizam a coleção e depois cada candidatura e respetiva origem. Não exigem acesso prévio a todas as oportunidades pedidas no filtro: referências sem candidaturas acessíveis devolvem zero/nenhum resultado, sem revelar a existência de dados privados. Isto permite contagens mistas no catálogo sem abrir acesso geral às origens. GET de oportunidade/avaliação noutros módulos continua independente.

`GET /api/applications/:id` acrescenta `canEdit` e `allowedTransitions`, calculados no servidor. O cliente HTTP existente mantém-se; o detalhe consome estes campos e oculta os comandos de edição/transição indisponíveis. Equipa/tarefas mantém leitura e histórico, com comandos de alteração apenas para quem já pode editar. Não há alteração do contrato de escrita nem de recibos históricos.

## Aceitação e validação

1. Técnico com zero permissões de candidatura explícitas vê apenas as candidaturas da sua equipa; zero participações devolve lista vazia.
2. Grants amplos não permitem ao técnico ler/alterar candidaturas de outras equipas. Administrador/gestor não perdem os seus acessos.
3. Inclusão/remoção na equipa modifica imediatamente o âmbito, sem modificar tarefas, histórico anterior ou grants centrais.
4. Duas entidades e dois técnicos: leitura direta, listas, parceiros, tarefas, histórico, indicadores, CSV e alertas não atravessam o âmbito autorizado.
5. Suspensão/revogação central continua a bloquear acesso; falha na política/consulta não produz sucesso ou fuga de dados.
6. Leitura pela equipa não concede poderes de escrita ou acesso geral a documentos, oportunidades privadas e avaliações.
7. Testes direcionados, prova PostgreSQL/HTTP descartável e percurso browser; build frontend se houver alterações de interface. Registar limites sem declarar verificação de produção.

## Evidência e limites

- **71 testes backend PASS**, incluindo cinco novos de política por equipa e um de contagens mistas; isolamento, grants amplos, dependências da origem, ausência de novos poderes de escrita, suspensão, versões e falha da consulta; regressões de candidaturas, tarefas, parceiros, alertas, relatório, F5 e catálogo C4G.
- **15 testes frontend PASS**, incluindo leitura de tarefas sem comandos de alteração; build Vite, sintaxe JavaScript e verificação de whitespace PASS.
- **PostgreSQL 17/HTTP PASS**: duas entidades, dois técnicos na mesma entidade (um sem grants de candidatura e outro com grants amplos anteriores), técnico externo e administradores; leitura direta e listas, resumos mistos de oportunidades privadas/centrais/inacessíveis, tarefas/histórico, parceiros, relatório/CSV e alertas. Inclusão/remoção e suspensão verificadas; CSV anterior recusado; falha da auditoria desfaz a remoção. Comparação exata preserva tarefa, histórico anterior e grants centrais.
- **Chrome desktop 1440 e móvel 390 PASS**: lista limitada à equipa, detalhe de consulta, tarefa existente visível, outros projetos ausentes e remoção com sessão aberta. Capturas finais inspecionadas; sem overflow nem erros de JavaScript.
- **Ambiente habitual/OIDC PASS** após o reinício final: lista e relatório com zero candidaturas reais; dados de negócio, memberships e grants centrais comparados antes/depois e inalterados. API pronta e worker existente pronto, sem alteração do processamento/importações.
- Provas: [HTTP/PostgreSQL](../../output/playwright/c4g-team-access/http-verification.json), [browser](../../output/playwright/c4g-team-access/browser-verification.json), [detalhe móvel](../../output/playwright/c4g-team-access/team-detail-390.png), [OIDC habitual](../../output/playwright/c4g-team-access/native-verification.json).
- Teste integrado reproduzível: `test/integration/application-team-access/gate.ps1`; usa apenas um contentor PostgreSQL dedicado e descartável. OIDC habitual: `test/integration/application-team-access/native.cjs`, com comparação de dados de negócio, memberships e grants.
- Sem novos utilizadores ou candidaturas de ensaio no ambiente habitual. Prova de técnicos usa exclusivamente dados sintéticos descartáveis. Não constitui rollout/validação de produção nem validação de anexos R2/antivírus/email. A ligação F14 tem teste de política; o percurso PostgreSQL deste incremento cobre origens privadas e centrais. O snapshot central de ensaio foi inserido apenas na base descartável, sem importação externa.

## Restante âmbito

Gestão/atribuição de perfis no ecrã Acessos continua pendente e não faz parte desta correção. Parceiros permanecem apenas informação da candidatura. Nenhum grant central foi apagado ou acrescentado por esta implementação; a criação de candidaturas conserva a autorização anterior e a participação não concede essa operação.
