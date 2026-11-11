# Entidades e utilizadores — consulta habitual

18/10/2026 · Review. [Contrato](../features/platform-directory-screen.md).

## Resultado

Entrada Plataforma C4G → Entidades e utilizadores, com listas reais de entidades e contas, pesquisa, estados, paginação e ficha. A conta nominativa solicitada aparece como Administrador C4G, sem membership privada. A ficha da entidade mostra identificação e contas associadas; não seleciona a organização nem abre candidaturas. Criação/ativação explicitamente identificadas como pendentes na interface.

Backend lê apenas projeções permitidas da Central numa transação read-only; sessão persistida e atribuição C4G verificadas antes e depois. Não usa papéis enviados pelo browser. Contagens e indicação de acesso efetivo consideram conta, vínculo, validade e entidade. Limite de 50 registos/página, 10 administradores/resumo e 100 vínculos/conta, com indicação dos limites. GET/HEAD, filtros fechados, timeout SQL e HTTP, erros sanitizados e no-store. Revogação não devolve resultados anteriores. UI cancela/ignora respostas antigas, limpa dados após erro e preserva filtros na paginação.

## Validação executada

- `node --test backend/test/platformDirectory.test.js`: 3 testes PASS (inputs, rejeição antes de adquirir ligação e erros sem payload/stack).
- `test/integration/platform-directory/gate.ps1`: 6 grupos PASS em PostgreSQL 17 descartável. Diretório A/B e contas partilhadas; acesso atual e futuro; conta C4G sem membership; recusa de administrador/gestor/técnico de entidade e papel forjado; sessões revogadas/expiradas/com versão antiga; revogação C4G durante leitura; fronteira HTTP; pesquisa e paginação de 55 contas sem duplicação. Fingerprints de negócio/autoridade preservados.
- Vitest `PlatformDirectory.test.jsx` e `C4gShell.test.jsx`: 17 testes PASS. Menu e abertura sem organização privada, ficha, filtros, vazio, erro/repetição, resposta antiga e paginação. O mock dos alertas e a expectativa antiga do placeholder foram atualizados para o percurso de alertas já recuperado.
- `npm run build` e `node --check` dos ficheiros backend e gates: PASS.
- `test/integration/platform-directory/native.cjs`: Chrome real, OIDC habitual, listas/ficha/pesquisa da conta nominativa; administrador da entidade recebe 403 e não vê o menu. Uma entidade e quatro contas existentes, incluindo uma arquivada. Capturas de listas/ficha a 1440 e 390 px, sem overflow horizontal, revistas visualmente. Nenhuma conta ou membership criada/alterada; fingerprints de catálogo, dados tenant e autoridade preservados. Login gera apenas o seu estado normal de sessão.

Evidência local: [PostgreSQL/HTTP](../../output/playwright/c4g-platform-directory/backend-verification.json), [OIDC habitual](../../output/playwright/c4g-platform-directory/native-verification.json), [entidades](../../output/playwright/c4g-platform-directory/native-entities-1440.png), [utilizadores](../../output/playwright/c4g-platform-directory/native-users-1440.png), [móvel](../../output/playwright/c4g-platform-directory/native-users-390.png).

## Operação e limites

API local reiniciada para carregar rotas; frontend existente atualizado por Vite. Sem migrations, alterações de contas, concessões, passwords ou dados de negócio. Worker e integrações não alterados. Sem commit ou publicação.

Este incremento disponibiliza **consulta administrativa**. Não disponibiliza ainda criação/edição de entidades ou contas, ativação manual, faturação ou newsletters. Adaptadores de onboarding continuam na composição isolada previamente validada; separação operacional dos segredos, diretório multi-entidade e configuração própria de ativação precedem a ligação dos comandos ao ambiente habitual. Revisão do utilizador pendente.

Próximo passo: rever o diretório na aplicação e continuar a composição operacional de criação da entidade/ativação do primeiro administrador.
