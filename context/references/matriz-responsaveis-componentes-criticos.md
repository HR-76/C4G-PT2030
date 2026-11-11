# Matriz de responsáveis pelos componentes críticos

**Estado: rascunho — atribuições e contactos por confirmar.** Preparada em 09/11/2026 a partir da documentação do projeto; não constitui nomeação, aprovação de acesso ou escala de prevenção.

Cada linha precisa de um titular, um substituto e um contacto operacional. As funções são propostas para facilitar a designação. `Pendente` significa que nenhum nome, substituto ou contacto foi confirmado na evidência consultada; não significa que não exista uma pessoa responsável fora do repositório.

| Componente | Dimensão | Função proposta | Titular | Substituto | Contacto | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| Identidade, Keycloak, OIDC e sessões | Técnica | Responsável de identidade | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Identidade, Keycloak, OIDC e sessões | Negócio | Responsável de produto e acessos | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Identidade, Keycloak, OIDC e sessões | Segurança | Responsável de segurança de identidade | Por confirmar | Por confirmar | Por confirmar | Pendente |
| API, autorização e resolução de tenant | Técnica | Responsável de backend | Por confirmar | Por confirmar | Por confirmar | Pendente |
| API, autorização e resolução de tenant | Negócio | Responsável de produto multi-entidade | Por confirmar | Por confirmar | Por confirmar | Pendente |
| API, autorização e resolução de tenant | Segurança | Responsável de segurança de aplicação | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Base Central e diretório de tenants | Técnica | Responsável de bases de dados da plataforma | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Base Central e diretório de tenants | Negócio | Administração C4G — representante a designar | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Base Central e diretório de tenants | Segurança | Responsável de segurança de dados | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Bases e dados dos tenants | Técnica | Responsável de bases de dados dos tenants | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Bases e dados dos tenants | Negócio | Administrador de cada organização — representante por entidade | Por confirmar por entidade | Por confirmar por entidade | Por confirmar por entidade | Pendente |
| Bases e dados dos tenants | Segurança | Responsável de segurança de dados | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Documentos, R2 e scanner | Técnica | Responsável de armazenamento e documentos | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Documentos, R2 e scanner | Negócio | Responsável pelo processo de candidatura — por entidade | Por confirmar por entidade | Por confirmar por entidade | Por confirmar por entidade | Pendente |
| Documentos, R2 e scanner | Segurança | Responsável de segurança de ficheiros | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Catálogo central e integrações externas | Técnica | Responsável de integrações | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Catálogo central e integrações externas | Negócio | Administração C4G — representante a designar | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Catálogo central e integrações externas | Segurança | Responsável de segurança das integrações | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Workers, fila e notificações | Técnica | Responsável de backend e operações | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Workers, fila e notificações | Negócio | Responsável pelo processo afetado | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Workers, fila e notificações | Segurança | Responsável de segurança de aplicação | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Backups, restauro e auditoria | Técnica | Responsável de continuidade e infraestrutura | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Backups, restauro e auditoria | Negócio | Administração C4G e representante da entidade afetada | Por confirmar por âmbito | Por confirmar por âmbito | Por confirmar por âmbito | Pendente |
| Backups, restauro e auditoria | Segurança | Responsável de segurança e auditoria | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Frontend e reverse proxy | Técnica | Responsável de frontend e infraestrutura | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Frontend e reverse proxy | Negócio | Responsável de produto | Por confirmar | Por confirmar | Por confirmar | Pendente |
| Frontend e reverse proxy | Segurança | Responsável de segurança de aplicação | Por confirmar | Por confirmar | Por confirmar | Pendente |

## Evidência e limites

- [Visão do produto](../project-overview.md): Administração C4G gere plataforma, clientes e integrações globais; o administrador da organização gere utilizadores e configuração da entidade. São responsabilidades funcionais, não nomes ou contactos confirmados.
- [Arquitetura](../architecture.md): descreve API, workers, bases, R2, proxy, Keycloak e Resend; distingue a arquitetura futura da instalação efetiva.
- [Modelo de dados](../decisions/future-data-model.md): identifica Keycloak como componente responsável por credenciais e autenticação; não identifica o titular operacional.
- [Runbook de migração central](../runbooks/staging-central-migration.md): requer que sejam nomeados responsáveis e autoridade para aprovar ou abortar; não estabelece nomes nesta matriz.
- A pesquisa consultada não identifica titular, substituto ou contacto para estas linhas. Papéis SQL com `owner` não são, por si, pessoas responsáveis.

## Risco, correção e verificação

**Risco:** sem atribuições e contactos confirmados, incidentes, alterações de permissões e restauros podem não ter decisão ou escalonamento claros.

**Correção proposta:** a Administração C4G deve confirmar os componentes e funções, designar titular e substituto para cada dimensão e registar um contacto apropriado. Para linhas por entidade, manter uma entrada para cada organização sem presumir que o administrador tem acesso a outras entidades. Confirmar também quem pode aprovar, executar e abortar mudanças; os campos de titular não concedem privilégios.

**Teste:** conferir que cada linha aplicável tem os três campos preenchidos, que os contactos funcionam e que os titulares e substitutos aceitam a responsabilidade. Realizar um exercício isolado de indisponibilidade de identidade, acesso cruzado, documento em quarentena e restauro, registando quem decide e executa. Rever a matriz após alterações de equipa ou componentes.

Não registar passwords, tokens, chaves, URLs assinadas ou strings de ligação nesta matriz. Validar o local apropriado para contactos pessoais antes de os acrescentar ao repositório.
