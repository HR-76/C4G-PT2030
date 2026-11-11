# Plataforma local — PostgreSQL nativo e dois acessos

Estado: Review. Autorizado pelo utilizador em 2026-10-17. Instalação 5432 e validação dos acessos concluídas; pronta para utilização/revisão humana. [Evidência e limites](../reviews/local-postgres-platform.md), [instruções locais](../../LOCAL.md).

## Contrato confirmado

- Usar `c4g_central_dev` e `c4g_tenant_dev` no PostgreSQL local, porta 5432.
- Começar sem dados de negócio da demonstração; criar apenas estrutura, referências obrigatórias, entidade C4G e identidades iniciais.
- Acesso `admin` para administração C4G e `hugo` para gestão da entidade C4G, com OIDC/MFA e autoridade central existentes.
- Executar `npm run dev` em backend e frontend, com instruções locais reproduzíveis.
- Preservar demonstração, bases existentes, identidades anteriores e alterações paralelas no repositório. Nenhum reset, remoção, publicação ou recolha externa implícita.

## Implementação delimitada

1. Diagnosticar credenciais sem exposição; usar configuração privada ignorada pelo Git.
2. Provar compatibilidade de schema e controlos no PostgreSQL 18 antes de o admitir. Manter recusa de versões desconhecidas e verificação de fingerprints.
3. Preparar instalador que recusa bases não vazias/desconhecidas, aplica migrations canónicas e cria apenas dados iniciais autorizados.
4. Configurar composição local sem acesso ao piloto legacy; separar Central e tenant e usar login tenant limitado. Não mapear a base tenant para `DATABASE_URL` legacy.
5. Configurar contas OIDC e instruções de acesso; manter MFA e permissões distintas.

## Critérios de aceitação

- Migrations Central/tenant verificadas no PostgreSQL 18, incluindo integridade, reexecução e recusa de drift; regressão PostgreSQL 17 preservada.
- Instalação nas duas bases confirmadas, sem oportunidades/candidaturas de exemplo nem perda de tabelas anteriores.
- `npm run dev` inicia API e Vite; frontend compilável e comunicação HTTP funcional.
- Login real de ambos os utilizadores; hugo não recebe administração C4G; admin não recebe implicitamente acesso privado à entidade.
- Reinício conserva entidade e contas; repetir arranque não repete seeds/migrations nem altera passwords.
- Sintaxe/backend focado, build frontend e prova de autorização executados; limitações registadas sem declarar produção pronta.

## Evidência inicial / dependência resolvida

Consulta pela sessão SQLTools confirmou `postgres`, porta 5432 e PostgreSQL 18.3. A password inicialmente fornecida foi recusada por Node e psql. Utilizador indicou que vai atualizar `backend/.env`. A ligação direta precisa de confirmação antes da instalação; preparar/testar em instância separada não depende dessa credencial.

Após atualização da credencial, a ligação passou. O utilizador autorizou explicitamente preservar a base tenant vazia como `c4g_tenant_dev_before_c4g_20261017` e preparar uma base ICU `und` com o nome original. Operação executada sem eliminar dados; sessão pgAdmin inativa e sem transação desligada para a renomeação. Central preservada no mesmo destino. Migrations, entidade, acessos, comandos npm dev e testes de browser nas bases efetivas PASS. A base de arquivo permanece disponível.
