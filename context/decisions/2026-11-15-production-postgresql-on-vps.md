# Decisão: PostgreSQL de produção na VPS atual

Estado: aceite pelo utilizador em 15/11/2026. Por implementar.

## Decisão

A base de dados de produção fica em PostgreSQL próprio, no servidor onde o PostgreSQL do staging corre hoje (a VPS C4G). O Neon deixa de ser o fornecedor previsto para produção.

A produção usa uma instância de PostgreSQL separada da do staging, na mesma VPS: contentor, volume, rede e credenciais próprios (confirmado pelo utilizador em 15/11/2026). Um ensaio, uma atualização de versão ou o superutilizador do staging nunca tocam em dados reais.

A API, o worker, o Keycloak e o frontend de produção ficam também nesta VPS (confirmado pelo utilizador em 15/11/2026). Staging e produção partilham a máquina, mas não partilham redes, volumes nem credenciais.

O Keycloak de produção é uma instância própria, com base de dados própria, separada da do staging (confirmado pelo utilizador em 15/11/2026). Reinícios, atualizações e módulos em teste no staging não afetam o login de produção.

Substitui, nesta parte, a [decisão de alojamento](hosting-and-external-services.md) («PostgreSQL no Neon») e fecha o ponto «Fornecedor de PostgreSQL para produção» da [decisão do staging](2026-11-12-staging-postgresql-on-vps.md).

## Motivo

As migrações publicadas exigem superutilizador, que um PostgreSQL gerido não concede. O PostgreSQL próprio é o único caminho já provado, no staging.

## Consequências

- Backups, recuperação, atualizações e disponibilidade da base de produção são responsabilidade C4G. Uma falha da VPS derruba a base, e também o staging.
- As cópias de segurança fora do servidor e o ensaio de recuperação num servidor limpo passam a ser condição de entrada em produção, não melhoria.
- O perfil de código para o Neon, que só existe na VPS, deixa de ser necessário para produção.
- A arquitetura continua a prever uma base Central e uma base por organização; mudam o fornecedor e o modo de as criar, não o modelo.

## Por decidir

- Limites de recursos entre staging e produção na mesma máquina (memória, disco, ligações).
