# Ambiente local persistente — catálogo real C4G

Review, 2026-10-17. Pedido explícito: disponibilizar o ambiente com a integração real existente antes de outras funcionalidades. [Ambiente, operação e evidências](../reviews/c4g-catalog-demo/README.md). Marco local comprovado; atualidade dos resultados da fonte permanece como finding, sem declaração de prontidão comercial.

## Âmbito autorizado e critérios

- Ambiente separado, só loopback: aplicação `http://localhost:5189`, PostgreSQL `127.0.0.1:5561`, contentor/volume próprios `c4g-catalog-demo`. Preservar serviços, bases e configuração habituais.
- EU Funding & Tenders pública: uma página, máximo cinco registos por atualização manual, limites e retries do adaptador existente. Sem agendamento. Uma primeira atualização pela interface integra a preparação autorizada pelo pedido atual.
- Identidades de demonstração no Keycloak local existente; novo cliente OIDC exclusivo, sem alterar o cliente habitual. Login real com PKCE e MFA existente, memberships e grants centrais; não usar cookies/sessões fabricados como acesso normal.
- Duas organizações de demonstração; catálogo público comum e candidaturas privadas. Identificação explícita de ambiente local e amostra real limitada. Não representa cliente real ou produção.
- Bases mantidas ao parar; reinício reutiliza dados e configuração local protegida, sem repetir migrations/provisionamento/recolha por rotina.
- Reutilizar composição, worker, runners e configuração F12. Configuração local do diretório de tenants é fixada no servidor; não exposta ao browser. Nenhum provisionador genérico novo.
- Validar login, atualização, listagem/detalhe reais, isolamento e persistência após reinício. Documentar abertura, paragem, dependência Keycloak e limites conhecidos.

Credenciais geradas ficam apenas na configuração local ignorada pelo Git e com ACL do utilizador; nunca nos relatórios, saída de comandos ou capturas. Sem deploy público, notificações ou introdução de dados de uma entidade real.
