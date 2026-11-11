# Entidades e utilizadores — consulta no ambiente habitual

Estado: Review, 18/10/2026. Implementado e disponível no ambiente habitual. O utilizador pediu continuar e tornar visível a gestão de utilizadores depois de entrar como administrador C4G. Executa a primeira etapa de interface do plano `platform-entities-implementation-plan.md`: leituras reais antes de ligar criação e ativação.

## Âmbito e aceitação

- Entrada Plataforma C4G → Entidades e utilizadores, rota `/administracao/entidades`, apenas C4G_ADMIN. Separadores Entidades/Utilizadores com pesquisa, filtros, paginação e ficha da entidade.
- Mostrar entidades e contas existentes da Central, com vínculos e perfis por entidade. Contas C4G sem membership são apresentadas como contas de plataforma, sem inventar uma organização ou herdar candidaturas.
- Perfil, estado da conta e estado do vínculo são distintos. Contagem de acessos ativos exige conta e membership ativas, validade atual e entidade ativa. Preservar referências a vínculos suspensos/removidos.
- API exclusiva de leitura `/api/admin/directory`, com sessão persistida e C4G atual conferidos antes e depois da consulta. GET/HEAD apenas; inputs fechados, limites, timeouts, erros sanitizados e no-store. Não consultar bases tenant nem expor credenciais, subjects, sessões, notas ou candidaturas.
- Usar esquema central existente, sem migrations, mudanças de contas, memberships ou grants. Não montar os comandos experimentais de onboarding no ambiente habitual. Mostrar com clareza que a criação/ativação ainda não está disponível; não apresentar botões que simulem sucesso.
- Provar autorização com PostgreSQL descartável e testes HTTP, incluindo revogação durante consulta, sessões inválidas e recusa a perfis de entidade; testar pesquisa/paginação e ausência de dados sensíveis. Frontend: regressão de menu, estados vazio/erro/consulta, respostas antigas, build e Chrome a 1440/390 com leitura real.

## Direção visual

Reutiliza o plano aprovado: #075B59 na navegação, #39751F em ações, #5FAD2F na marca, #20262B no texto, #F6F8F8 no fundo e #FFFFFF nas superfícies; fonte `var(--font)`, títulos 24/600 e texto 14. Lista densa como elemento principal, pesquisa e estados acima da tabela, ações de consulta visíveis. Alinhamento à esquerda, texto de estado além da cor, sem métricas decorativas. Em móvel, linhas com rótulos e quebra de emails compridos. Ficha em página, sem modal longo.

[Implementação, provas e limites](../reviews/platform-directory-screen.md): 3 testes backend, 6 grupos PostgreSQL/HTTP, 17 testes frontend, build/sintaxe e Chrome OIDC habitual 1440/390 PASS. Menu, listas, ficha e pesquisa reais; contas/dados/acessos preservados. Criação e ativação continuam pendentes.

Próximo passo: rever o diretório na aplicação e continuar a composição operacional da criação/ativação.
