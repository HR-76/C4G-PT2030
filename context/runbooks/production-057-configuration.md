# Produção 057: configuração privada e perfis

Preparação de 15/11/2026; não aplicada. Domínios confirmados: aplicação `gcni.c4g.ai`, login `login.c4g.ai`. Realm `c4g-production`, client `c4g-production-web`, nome da Central, porta 8600, timeouts e limites de recursos são propostas operacionais a validar. A primeira entidade ainda não foi identificada.

## Ficheiros e isolamento

Raiz exclusiva: `/srv/c4g-production`. Código e imagens identificados por release; configuração imutável por revisão em `/srv/c4g-production/config/<CONFIG_ID>`. Não usar links para ficheiros de outros ambientes. `<CONFIG_ID>` deve ser um identificador simples, sem `/`, `..` ou substituições de shell. Diretórios privados 0700; ficheiros 0600 para o dono que os lê ou 0640 com grupo exclusivo. Nos bind mounts, verificar UID/GID 1000 da imagem API; um ficheiro root:root 0600 não é legível pelo utilizador `node`. Não resolver com permissões globais.

| Ficheiro | Montado em | Conteúdo |
|---|---|---|
| `api.env` | Só API | Seis URLs limitados, OIDC/sessão, chaves UI, credencial tenant, R2 e flags |
| `install.env` | Só `migrate` | URL temporário privilegiado da Central de produção |
| `central-logins.json` | Só `migrate` | Seis passwords independentes; nunca incluídas na imagem ou no Git |
| `retention.env` | Só job `retention` | URL limitado de retenção SQL e NODE_ENV |
| `billing-mail.env`, se ativado | Só worker de faturação próprio | URL worker, token Resend e remetente verificado |
| `release.env` | Cliente Docker Compose | Referências de imagens por digest e CONFIG_ID; sem segredos |
| `postgres/certs/ca.pem` | Leitura nos consumidores PostgreSQL | CA de produção; hostname do certificado corresponde ao URL |

Modelos em [deploy/production](../../deploy/production/README.md). Contêm placeholders e flags que deliberadamente impedem ativação inadvertida. Substituir todos os `REPLACE_*` e valores vazios fora do checkout. URI-encode das passwords ao construir URLs; gerar cada password/segredo de forma independente. Não usar o mesmo segredo para sessão, permit, UI, OIDC ou papéis SQL. A extensão `env_file.format: raw` evita interpolar `$` dos valores privados; exigir versão Compose que suporte esse formato e validar com `config --quiet`.

## Perfis SQL da Central

| Capacidade | Login | Papel / privilégios | Variável |
|---|---|---|---|
| Leitura administrativa e prontidão | `c4g_prod_api_read` | `c4g_prod_read_role`; leituras explícitas e verificador fechado | `CENTRAL_DATABASE_URL` |
| Comandos | `c4g_prod_api_commands` | `c4g_prod_commands_role`; EXECUTE enumerado e leituras auxiliares | `CENTRAL_COMMANDS_DATABASE_URL` |
| Manual/PT2030 | `c4g_prod_catalog_authoring` | `c4g_prod_authoring_role`; S/I e U de colunas exatas | `CENTRAL_AUTHORING_DATABASE_URL` |
| Logs | `c4g_prod_logs` | `c4g_prod_logs_role`; INSERT de logs | `CENTRAL_LOGS_DATABASE_URL` |
| Catálogo normal | `c4g_prod_catalog_read` | `c4g_catalog_reader`; leitura sem originais privados | `CATALOG_DATABASE_URL` |
| Retenção SQL | `c4g_prod_email_retention` | `c4g_prod_retention_role`; só função de retenção e metadados necessários | `CENTRAL_EMAIL_RETENTION_DATABASE_URL` |
| Autoridade | `c4g_authority_runtime` | Contrato fechado existente; nome exato obrigatório | `AUTHORITY_DATABASE_URL` |

Os seis primeiros logins são criados pelo instalador 057. Autoridade já é criada nas migrações anteriores, mas a sua password privada tem de ser provisionada separadamente pelo procedimento nominal. O instalador não a cria nem roda. Nenhum login de serviço recebe superutilizador, BYPASSRLS, ownership, CREATEROLE, CREATEDB ou ADMIN OPTION. Os novos logins têm NOINHERIT e uma única pertença com SET TRUE/INHERIT FALSE; a API seleciona o papel em transação. Não conceder UPDATE de utilizadores para resolver locks.

Os seis URLs **da API** (quatro pools novos + autoridade + catálogo) têm usernames diferentes e o mesmo `host:port/database`, com `sslmode=verify-full`. Proposta de alvo: `c4g-production-postgres:5432/c4g_central_production`, certificado com esse SAN e rede `c4g-production-data`. O perfil valida a igualdade, mas não demonstra por si só que o servidor pertence à produção: a operação verifica também instância, volume, rede e system identifier antes de aplicar SQL.

Pool máximo: leitura 8, comandos 2, autoria 2, logs 2, autoridade 8 e catálogo 4 = **26 ligações Central por API**, antes de jobs/instalação e reservas. Tenant API até 5 por pool. Definir `max_connections` e limites globais só depois de contar tenants, instâncias de API, Keycloak, jobs e administração. Não multiplicar réplicas com o mesmo orçamento sem revisão.

## Tenant e identidade

- Primeiro provisionar organização, tenant, schemas, login API limitado e publicação F4. `CENTRAL_API_ORGANIZATIONS_JSON` tem de ser uma lista não vazia dos UUIDs admitidos. `OPPORTUNITY_API_CREDENTIALS_JSON` contém tenantId, credentialRef, connectionVersion, host, port, database, login, password e ssl; os valores vêm do estado publicado, não de exemplos. `OPPORTUNITY_ALLOWED_RESIDENCY_JSON` corresponde à política publicada. Não inventar UUIDs ou binding digests.
- Login tenant API com NOINHERIT e única pertença a `c4g_tenant_api_capabilities`, conforme o provisionador e os módulos escolhidos. Perfis funcionais `ORG_ADMIN`, `FUNDING_MANAGER`, `CONTRIBUTOR`, `VIEWER` e `C4G_ADMIN` são autorização da aplicação, não passwords SQL nem substitutos de membership. Provar dois tenants isolados antes da abertura.
- Instância e base Keycloak próprias; sem utilizadores sintéticos. Registar callbacks exatos de `api.env.example`, sem wildcard de domínio, origem web `https://gcni.c4g.ai`. A política `c4g-user-mfa-v1` preserva MFA opcional, conforme decisão existente; não mudar por efeito do deploy.
- `SESSION_SECRET`, `AUTHORITY_COMMIT_PERMIT_SECRET` e chaves UI: pelo menos 32 bytes aleatórios codificados em hex. A configuração UI é consultada pela composição mesmo fora do ramo editorial; não omitir as chaves. O modelo seleciona editorial/PQ1, pelo que o tenant tem de ser provisionado com esses papéis/migrações.
- Confirmar `TRUST_PROXY_HOPS` pela cadeia real, incluindo Cloudflare se existir; bloquear acesso direto que possa falsificar cabeçalhos. Não preencher um número por conveniência.

## Funcionalidades e bloqueios explícitos

O modelo mantém criação manual, PT2030 `catalog`, PDF privado, logs, gestão de acessos e perfil editorial/PQ1. As alterações de perfil/estado exigem autenticação recente pela categoria configurada (`recent-auth` na política opcional). Sem recolha europeia, sem documentos de candidaturas, sem importação tenant XLSX, sem ativação v2 genérica nem recuperação F12 opcional. Recolha do site PT2030 desligada até decisão sobre termos. Nada disto usa a flag `C4G_STAGING_CENTRAL_RUNTIME_LOGINS`.

**Os seguintes pontos impedem declarar paridade funcional/entrada de clientes apenas com 057:**

1. `MEMBER_ONBOARDING_RUNTIME=central`: compatibilidade SQL integrada na [migração incremental 058](production-058-account-lifecycle.md), preservando 057. Aplicar o pacote registado, preparar o diretório privado do worker, clientes/ponte Keycloak e email de produção, e completar o ensaio integrado antes de ativar. O exemplo permanece `disabled` até essas dependências existirem. Não copiar `memberEmailRollout` nem variantes de staging.
2. `USER_DELETION_RUNTIME=central`: os comandos e o diário também integram 058. Depende do runtime de convites e da capacidade tenant `ACCOUNT_IDENTITY_ERASURE` em cada binding. A produção recusa arranque sem a extensão058 quando estes percursos estão selecionados. Não executar o rollout de staging.
3. `CATALOG_READ_RUNTIME=controlled`: depende de factory não fornecida pelo loader padrão e de ledgerContract que termina em 056. Manter `disabled` para usar o **catálogo normal**, que continua ativo via FUNDING_TENDERS_RUNTIME/CATALOG_DATABASE_URL. Se a funcionalidade conectada for requisito, falta implementação e validação específica.
4. Email e validação de faturação: o exemplo deixa desativados até confirmar a composição final. Se exigidos na primeira release, configurar o módulo Keycloak, cliente `c4g-email-templates`, segredo próprio, histórico e worker Resend antes do aceite. O worker de faturação usa perfil existente `c4g_billing_validation_worker` provisionado separadamente; 057 não cria o seu login.

**Gestão de acessos — correção local de 15/11/2026:** a composição usa a categoria privilegiada validada, mantendo `c4g-user-mfa-v1` e MFA opcional. A autenticação recente expirada devolve `REAUTH_REQUIRED`/403; «Confirmar sessão» segue a política do servidor e não reenvia a alteração. [Contrato e validação](../features/platform-access-optional-mfa.md). Esta correção requer inclusão na release candidata e ensaio OIDC no ambiente isolado antes da abertura; não foi aplicada a staging ou produção.

Não transformar estas flags de ensaio numa redução silenciosa do produto. Registar explicitamente o âmbito aprovado e validar os percursos requeridos antes de abrir clientes.

## Storage e rotinas

PT2030 e PDF continuam a exigir R2 privado na UE e ClamAV mesmo com documentos de candidaturas desligados. Buckets distintos, token só da produção, sem acesso a backups ou a outro ambiente. Só definir `C4G_R2_LAYER_C_VALIDATED=true` após prova real de escrita/leitura condicional na infraestrutura própria. A prova de multipart é independente. ClamAV é loopback `127.0.0.1:3310`, no mesmo namespace da API.

Com histórico ativo, executar retenção SQL num job separado (`docker compose ... --profile retention run --rm retention`), monitorizar exit code e última execução. O agendamento não foi criado; proposta a confirmar: execução horária. A API mantém a limpeza do fornecedor Keycloak e não observa a saúde do job SQL (null quando não há falha do fornecedor). Monitorização externa obrigatória. Partições de auditoria, chat e backups têm processos/donos próprios; não usar o login de retenção de email para essas tarefas.
