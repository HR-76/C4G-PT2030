# Standards de Código

## Regra principal de transição

O runtime ativo é C4G multi-instituição com OIDC, API e workers separados e resolução de bases Central/tenant. O piloto UBI é legado e material de migração. Distinguir implementação atual, histórico UBI e arquitetura futura; não introduzir alterações de arquitetura sem feature e plano de migração aprovados.

## Organização atual verificada

- Frontend em módulos ES, React e Vite.
- Backend CommonJS separado por `routes`, `controllers`, `services`, `middlewares`, `utils` e `config`.
- Chamadas HTTP do frontend centralizadas em `frontend/src/api/api.js`.
- PostgreSQL com SQL e migrações incrementais.

## Regras para novo trabalho

- Em código novo ou alterado, usar indentação consistente com o módulo e escrever condições, efeitos e passos de erro em linhas separadas quando isso facilita a revisão. Não reformatar ficheiros inteiros sem necessidade.
- Agrupar regras CSS do mesmo componente e evitar acrescentar overrides que contrariem regras anteriores quando for possível atualizar a regra existente sem alterar o comportamento.
- Para instantes apresentados na área administrativa, usar explicitamente `Europe/Lisbon`; datas civis sem fuso mantêm-se datas civis.
- Todas as operações de cliente devem receber contexto organizacional resolvido no servidor.
- Nunca aceitar do frontend credenciais, nomes de bases ou identificadores de ligação.
- Aplicar autorização por organização, perfil, unidade e recurso antes do acesso a dados ou geração de URL R2.
- Não usar perfil global como substituto de membership.
- Jobs, webhooks, importações e eventos devem ser idempotentes.
- Guardar versões das regras, pipelines e definições usadas em resultados históricos.
- Usar arquivo lógico e histórico; não adicionar eliminações automáticas de oportunidades ou candidaturas.
- Separar adaptadores de Neon, R2, Resend e conectores do domínio.
- Não colocar parsing específico de fontes no núcleo do catálogo.
- Validar inputs nas fronteiras e não devolver detalhes internos em produção.
- Preservar parametrização nas queries SQL.

## Migrações

- As migrações C4G estão separadas nos diretórios Central e tenant, com manifests, preflight e runners próprios; scripts individuais do piloto são legado.
- Preservar a execução ordenada, o registo e as verificações de compatibilidade na Central e em cada tenant; consultar o runner e o runbook do incremento antes de qualquer aplicação.
- Não reescrever migrações aplicadas sem um plano explícito de reconstrução do piloto.

## Testes

- Frontend: `npm test` em `frontend/` executa a suite Vitest com `test-harness/vitest.config.js`; executar também `npm run build`.
- Backend: `npm test` em `backend/` executa `node --test test/**/*.test.js`; executar também `node --check` nos ficheiros JavaScript alterados.
- Correções começam pelo teste de regressão e validação focada, seguida das suites completas e build. Registar falhas anteriores e testes ignorados separadamente; não os ocultar nem enfraquecer expectativas para obter um resultado verde.
- Gates em `test/integration/` são provas separadas, frequentemente com PostgreSQL/Keycloak/contentores e SQL de preparação. Não executar contra Dev nem assumir autorização implícita para migrations, grants ou dados. Usar apenas o âmbito isolado explicitamente autorizado. As suites locais não substituem essas provas.
- Novos componentes críticos exigem testes de isolamento entre organizações, revogação, autorização por unidade, idempotência, migrações, outbox, documentos e métricas.
- Testes multi-tenant devem provar ausência de leitura, escrita e exportação cruzada.

## Interface e conteúdo

- Mostrar texto permanente apenas quando ajuda a compreender o estado atual ou a concluir uma ação.
- Retirar subtítulos, instruções e contexto que apenas repetem o título, os campos ou a navegação visível.
- Tooltips devem conter apenas informação necessária ao utilizador; evitar detalhes de implementação, regras internas de contagem e explicações redundantes. Não criar um tooltip se não acrescentar informação útil.
- Colocar contexto secundário importante num controlo de informação consistente e acessível por rato, teclado e tecnologia assistiva; não depender apenas do atributo `title`.
- Não ocultar em tooltips erros, consequências de uma ação, requisitos de preenchimento, permissões, estados críticos ou informação necessária para decidir.

## Dados sensíveis

- Nunca registar segredos ou strings de ligação.
- Logs devem conter identificadores mínimos e contexto organizacional, sem payloads sensíveis por omissão.
- Dados reais não são usados em desenvolvimento sem autorização e anonimização.
