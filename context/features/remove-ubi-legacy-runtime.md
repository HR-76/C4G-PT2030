# Remoção do runtime legacy UBI

## Estado

Complete — 26/10/2026.

## Objetivo

Eliminar do produto executável os caminhos do piloto UBI e tornar a composição C4G multi-instituição o único runtime suportado.

## Âmbito confirmado

- Remover autenticação JWT/password do piloto e exigir OIDC com membership central.
- Remover rotas, controladores, serviços, jobs, seeds, scripts e testes exclusivos da UBI.
- Remover páginas, clientes HTTP, navegação, assets e alternativas frontend exclusivas do piloto.
- Remover os seletores `legacy`/`f12`, os endpoints `/api/legacy/*` e as rotas frontend `/legacy/*`.
- Fazer o arranque, readiness e health dependerem apenas da Central e dos tenants C4G autorizados.
- Atualizar documentação operacional e testes afetados para um único runtime C4G.

## Preservação obrigatória

- Não apagar dados nem executar migrations sobre bases existentes.
- Preservar migrations históricas necessárias para upgrade e os documentos que registam decisões ou proveniência; estes artefactos não podem voltar a ser montados no runtime.
- Preservar todas as alterações não relacionadas já presentes no worktree.

## Critérios de aceitação

1. Nenhum endpoint `/api/legacy/*`, `/api/ubi-structure`, `/api/professors` ou rota frontend `/legacy/*` é montado.
2. O arranque recusa configurações que não sejam OIDC + runtime C4G multi-instituição.
3. O frontend não contém branching funcional por `opportunitiesRuntime` nem apresenta conceitos globais UBI, Professor, Faculdade ou Centro de Investigação.
4. Seeds, scripts, assets e testes exclusivos do piloto UBI deixam de fazer parte da aplicação ativa.
5. O grafo de módulos não conserva código de produção órfão criado pela remoção.
6. `npm run build` passa no frontend; JavaScript backend alterado passa `node --check`; testes direcionados de composição, tenancy, autorização e navegação passam.
7. Migrations e registos históricos preservados ficam fora dos entrypoints e não podem ser usados como fallback.

## Fora de âmbito

- Eliminar fisicamente bases ou dados UBI.
- Reescrever migrations já aplicadas.
- Remover funcionalidades C4G recuperadas a partir da experiência do piloto quando já usam contratos multi-instituição.
- Commit, push, deploy ou alteração de credenciais.

## Resultado

- A aplicação tem uma única composição C4G: OIDC, membership central e bases tenant autorizadas. Foram removidos o runtime alternativo, autenticação JWT/password, pool UBI, bootstrap, cron, rotas, controllers, serviços, páginas, clientes HTTP, assets e dependências exclusivos do piloto.
- O frontend deixou de publicar rotas ou seletores legacy e os módulos recuperados do piloto usam nomes e contratos organizacionais C4G.
- Os perfis Docker/demo de duas bases, scripts de transferência já concluída e gates exclusivos Central/Legacy foram retirados dos entrypoints e da árvore executável.
- Nenhuma base, registo de negócio ou migration aplicada foi alterada. Migrations, decisões, reviews, snapshots e referências históricas permanecem como prova de proveniência, sem fallback ou montagem no runtime.
- Identificadores persistidos necessários à estabilidade de UUIDs e caminhos de evidência já produzida foram mantidos quando a sua alteração quebraria dados/histórico; não selecionam comportamento legacy.

## Validação

- Frontend: 53 ficheiros de teste e 320 testes PASS; build Vite PASS com 1719 módulos.
- Backend direcionado: 120 testes de composição, OIDC, tenancy, autorização, readiness e lifecycle PASS.
- Sintaxe backend: `node --check` PASS nos 503 ficheiros JavaScript de `src/` e `scripts/`.
- Suite backend global: 1222/1225 PASS. Mantêm-se três falhas anteriores e fora deste recorte: cancelamento ClamAV, binding F12/F11 e catálogo SQL protocolar.
- Varredura dos entrypoints frontend/backend sem `/legacy`, `legacyPool`, JWT do piloto, `opportunitiesRuntime`, scripts UBI ou imports dos módulos removidos.
