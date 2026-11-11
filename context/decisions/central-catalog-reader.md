# Leitor do catálogo Central

Decisão autorizada em 2026-10-25. O port cliente reutiliza as queries Funding
existentes e expõe apenas `list`, `get` e `revision`. A listagem/detalhe mantêm
a visibilidade atual; a resolução da revisão para candidatura recusa ARCHIVED.
Membership e organização atuais continuam obrigatórias na rota. A criação e
a consulta da candidatura continuam sujeitas à autoridade e ao runtime Tenant.

Central 029 introduz `c4g_catalog_reader` NOLOGIN, sem poderes de administração,
com USAGE em opportunity_catalog e SELECT apenas em opportunity, revision e
funding_identity. Não permite importação, escrita, identidade ou DDL. A migração
é irreversível pelo runner: remoção requer plano explícito após retirar os
consumidores/logins, não um DROP ROLE global potencialmente partilhado.

O login de serviço é provisionado externamente: LOGIN, NOINHERIT, NOSUPERUSER,
NOCREATEDB, NOCREATEROLE, NOREPLICATION, NOBYPASSRLS; única membership
`c4g_catalog_reader`, sem ADMIN OPTION, com SET TRUE e INHERIT FALSE.
Não colocar passwords em SQL versionado. Configurar CATALOG_DATABASE_URL
(PostgreSQL, com password) fora do repositório. Não existe fallback.

A 029 retira TEMPORARY de PUBLIC apenas na base Central migrada. PostgreSQL
não suporta DENY individual; manter esse privilégio permitiria DDL temporário
ao leitor. As queries e importadores do catálogo inspecionados não criam tabelas
temporárias. Grants explícitos de outros roles não são removidos. Preflight do
leitor recusa também CREATE/TEMP efetivos, grants diretos e funções privilegiadas.

O pool é próprio, máximo 4 ligações, timeout de ligação de 5 s. Cada transação
de leitura seleciona o role localmente e tem statement_timeout de 5 s. Readiness
confere o schema e os privilégios efetivos; cada checkout confere novamente o
login. O proprietário da composição fecha o pool depois de drenar HTTP.

Aceitação: instalação/upgrade oficiais medidos; drift recusado; leitor lê as
três tabelas, mas não escreve, executa DDL ou consulta identidade; configuração
incompleta falha fechada; criação pela UI persiste referência/revisão no Tenant A;
B não acede à candidatura de A nem ganha dados por essa tentativa.
