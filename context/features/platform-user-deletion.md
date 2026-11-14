# Eliminação de contas pelo administrador C4G

Decisão do utilizador em 2026-11-14: apenas C4G_ADMIN pode eliminar contas; retirar definitivamente o acesso e anonimizar a identidade, preservando histórico e dados de trabalho. Não executar a eliminação de contas existentes durante a implementação ou validação.

## Contrato

- Ação «Eliminar conta» no diretório global de utilizadores C4G, com revisão do nome/email, consequências e confirmação escrita ELIMINAR. Não disponível ao administrador de entidade.
- Autorização C4G e MFA recente novamente no servidor em cada pedido, incluindo retoma. Impedir autoeliminação e eliminação do último administrador ativo C4G ou da entidade.
- Antes de efeitos externos, persistir pedido idempotente e revogar conta, vínculos, convites e sessões numa transação coordenada. Não permitir reativação normal de conta eliminada.
- Eliminar identidade Keycloak pelo issuer/subject verificados no servidor, nunca por email. Falha ou resposta perdida mantém acesso bloqueado e pedido retomável; não apresentar conclusão antes de confirmar cada etapa.
- Anonimizar nome, email, função e perfil descritivo nas fichas associadas de todas as entidades, conservando IDs e relações para candidaturas, equipas, tarefas e auditoria. Anonimizar também os dados estruturados dos pedidos de criação e convites. Não substituir texto arbitrário dentro de documentos ou mensagens.
- Conservar referências técnicas e histórico de trabalho. Este fluxo elimina a conta operacional; não promete apagamento universal de dados pessoais em anexos, texto livre, backups ou exportações. Esses conteúdos exigem o processo de privacidade próprio.
- Nenhuma conta ou dados existentes são eliminados apenas por instalar a funcionalidade.

## Provas obrigatórias antes de ativar em staging

Regressões de autorização, MFA, autoeliminação, último administrador, idempotência, falha externa e retoma; isolamento A/B e preservação de dados com PostgreSQL isolado; confirmação de remoção Keycloak em realm de teste; admissão exata do esquema Central e privilégios tenant. A instalação deve preservar os patches de email 053 já ativos e ter backup validado. Nunca aprender fingerprints do staging nem contornar o protocolo de autoridade.
