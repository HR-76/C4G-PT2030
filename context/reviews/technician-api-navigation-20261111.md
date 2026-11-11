# Técnico — API e navegação, 11/11/2026

## Diagnóstico e correções

- O detalhe pedia a lista geral de membros e opções de associação documental mesmo em consulta. Agora os nomes acompanham os resultados autorizados da candidatura, equipa e revisões; as opções de edição só são pedidas quando a capacidade autoritativa o permite.
- A amostragem de `pg_stat_activity` identificou espera pelo bloqueio Central `43001306` em simultâneo com `audit.prepare_append_v1` no tenant. O erro interno observado foi `LEASE_TIMEOUT`. Consultas isoladas funcionavam, mas o carregamento concorrente falhava.
- As consultas de detalhe de candidatura/parceiros, equipa e documentos usam agora contratos fechados do mecanismo existente de auditoria de leituras. Apenas ALLOW observacional é acumulado; DENY/críticos continuam imediatos. O flush, a revalidação física e de autoridade e o commit continuam obrigatórios antes da resposta.
- As consultas de autorização desses detalhes agrupam as leituras Central pelo coordenador existente. Sem aumento de timeouts, novos grants, alteração de dados ou dispensa de auditoria.
- As capacidades visuais de editar, alterar estado, gerir equipa/documentos, rever e carregar reutilizam a avaliação de política protegida do browse. O conjunto de ações é fechado e a avaliação exige o guard, ator, organização, membership e versões atuais. Isto evita pedidos de comandos apenas para decidir a visibilidade de botões; não substitui as autorizações das leituras ou ações reais.
- Falhas de consulta deixaram de ser apresentadas como envios incertos; a candidatura dispõe de recuperação por nova consulta. A seleção de membros distingue indisponibilidade de lista vazia.

## Validação

- Sessão real do Técnico, candidatura de teste existente, sem criar novas tarefas, documentos, parceiros ou permissões.
- Nomes confirmados: Hugo no responsável e Hugo Romão no participante e histórico da equipa; responsável legível também na revisão da candidatura.
- Computador: viewport medido a 1440 × 1000. Telemóvel: viewport medido a 390 × 844, sem transbordo horizontal da página.
- Menu e pesquisa sem Organização/Acessos; Matching acessível com o perfil pessoal. Menu móvel, pesquisa, Escape e retorno de foco verificados.
- Calendário, histórico da equipa, histórico documental e detalhes da revisão abrem em consulta. As ações e diálogos de alteração não são oferecidos a esta conta.
- Os conjuntos reais de documentos, tarefas e parceiros desta candidatura estão vazios; os fluxos de alteração e download de documentos existentes não foram exercitados nesta sessão.
- Houve reinícios do servidor local durante a implementação e observou-se temporariamente ausência de listener na porta 5000. Após confirmar a saúde da API, o carregamento final do resumo, equipa, documentos, parceiros e histórico concluiu sem erros e sem repetir consultas manualmente.
- Verificação final: 895 testes frontend aprovados; 2833 testes backend aprovados, 7 ignorados e nenhuma falha; build frontend aprovado. A revisão móvel expandida confirmou o responsável Hugo e largura de conteúdo de 384 px num viewport de 390 px. O viewport temporário foi reposto no fim.

Registos locais de testes: `.tmp/technician-frontend-complete.log`, `.tmp/technician-backend-complete.log` e `.tmp/technician-build-complete.log`. Diagnóstico temporário removido do código. Sem commit ou publicação.
