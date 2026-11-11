# C4G Funding Platform

Produto C4G multi-instituição para descoberta de oportunidades de financiamento, matching e qualificação, gestão de candidaturas e reporting institucional.

## Fontes de verdade

- `context/project-overview.md`: visão e âmbito confirmados do produto.
- `context/architecture.md`: arquitetura futura aprovada e fronteiras do sistema.
- `context/features/`: contratos funcionais confirmados.
- `context/decisions/`: decisões técnicas e de produto duráveis.
- `context/references/current-implementation.md`: factos sobre a implementação UBI existente.
- `context/coding-standards.md`: regras para trabalho no repositório.
- `context/current-work.md`: apenas o trabalho ativo.

Não tratar o código existente como arquitetura aprovada. A implementação atual nasceu como aplicação/piloto UBI e serve como evidência e material de migração.

## Regras de trabalho

- Distinguir sempre produto pretendido, arquitetura futura e implementação atual.
- Não generalizar estruturas específicas da UBI para o produto multi-instituição.
- Preservar histórico e dados; arquivar em vez de eliminar automaticamente.
- Isolar integralmente os dados de cada organização.
- Tratar a membership central como fonte de verdade do acesso.
- Manter o motor de matching determinístico e explicável no MVP; IA fica fora do caminho principal.
- Documentar uma feature e critérios de aceitação antes de a implementar.
- Não resolver perguntas de produto por inferência silenciosa.
- Preservar trabalho existente e não relacionado.
- Não fazer commit, merge, push, deploy ou operações destrutivas sem pedido explícito.
- Nunca registar credenciais, tokens, ligações de bases, chaves R2 ou Resend.

## Estado atual do repositório

- `frontend/`: React 18 e Vite; `npm run dev` e `npm run build`.
- `backend/`: Express 5 CommonJS e PostgreSQL; `npm run dev` e `npm start`.
- API e workers têm entradas separadas: `backend/src/server.js`, `backend/src/worker.js` e `backend/src/documentWorker.js`. O supervisor local arranca API, worker configurado e frontend; consultar `LOCAL.md` para o perfil habitual.
- O runtime C4G resolve uma base Central e bases tenant por organização. As migrações estão separadas em `backend/database/central/migrations/` e `backend/database/tenant/migrations/`; o perfil local documenta Central e tenant distintos. A base única pertence ao legado UBI, não descreve o runtime C4G atual.
- A topologia de produção (VPS, proxy, Neon e fornecedores externos) descrita em `context/architecture.md` é a arquitetura aprovada; a sua implantação efetiva exige evidência do ambiente, não se deduz dos diretórios.
- Existem suites `npm test` em `backend/` (Node test runner) e `frontend/` (Vitest, harness próprio). Não existem scripts gerais de lint ou type checking.
- O runtime ativo é exclusivamente C4G multi-instituição com OIDC; não existem scripts ou rotas executáveis do piloto UBI.

## Validação durante a transição

- Para frontend, executar `npm run build` em `frontend/`.
- Para backend, executar `node --check` nos ficheiros JavaScript alterados e testes direcionados disponíveis.
- Para correções, adicionar primeiro a regressão, executar testes focados, suites completas e build; registar falhas preexistentes separadamente. Gates de integração que criam infraestrutura, aplicam SQL ou usam bases externas exigem âmbito isolado e autorização própria; `npm test` não os substitui.
- Ao alterar contratos HTTP, confirmar cliente em `frontend/src/api/api.js` e rotas em `backend/src/routes/`.
- Alterações de tenancy, autorização, migrações, jobs, documentos ou reporting exigem testes automatizados antes de produção.
