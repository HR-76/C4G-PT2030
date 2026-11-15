# Configuração privada da primeira release

Este procedimento prepara o pacote; não autoriza alteração de staging, criação de contas remotas, envio de email ou deploy. A aplicação confirmada é `https://gcni.c4g.ai`, com identidade em `https://login.c4g.ai`. A primeira entidade, o administrador e a sua eventual membership `ORG_ADMIN` continuam por indicar. Não substituir estes dados por exemplos de teste numa instalação real.

## Inputs e identidade antes do bootstrap

Copiar os exemplos `deploy/production/runtime.config.example.json` e `runtime.credentials.example.json` para a revisão privada de configuração, fora do checkout. O primeiro declara a origem, issuer, clientes, ponte e remetentes. O segundo contém apenas os onze segredos necessários. O validador rejeita chaves desconhecidas, placeholders, issuer divergente do bootstrap, origens inseguras e reutilização de segredos. Cada segredo tem pelo menos32 caracteres ASCII imprimíveis sem espaços; as chaves hexadecimais seguem o comprimento indicado no exemplo. Não incluir tokens de administração nem credenciais instaladoras nestes ficheiros.

Escolher o realm e confirmar os domínios de envio no fornecedor. Configurar três credenciais independentes de email: Resend para convites, Resend para faturação e SMTP para Keycloak. Remetentes de convites/faturação admitem `Nome <email>`; `smtp.from` é somente a mailbox, com nome separado em `fromDisplayName`. SMTP exige TLS:587/STARTTLS ou465/TLS. A preparação não prova que as credenciais, DNS ou quotas do fornecedor estejam operacionais.

O gerador de identidade `scripts/prepareProductionIdentity.js` lê ambos os inputs e grava `keycloak-production.json` e `c4g-activation.properties` antes da instalação de bases. Não chama Keycloak nem cria o administrador nominal. O operador importa o realm apenas numa instância dedicada, nova e autorizada, com os providers da mesma release já instalados; depois cria/verifica a conta real e usa o `sub` observado no `bootstrap.config.json`. O bootstrap verifica a identidade por leitura com token temporário; não pede nem grava a password do administrador.

A partir de `backend/`, o primeiro comando valida o plano sem ler segredos nem escrever ficheiros; o segundo produz os dois ficheiros privados. `--config /private/bootstrap.config.json` é opcional nesta etapa: quando fornecido, verifica também a correspondência do issuer. Assim, preparar o realm não depende de inventar o subject do primeiro administrador.

```text
node scripts/prepareProductionIdentity.js --runtime-config /private/runtime.config.json --output-dir /private/identity-output
node scripts/prepareProductionIdentity.js --runtime-config /private/runtime.config.json --runtime-credentials /private/runtime.credentials.json --output-dir /private/identity-output --write
```

O import prepara clientes distintos para BFF, ativação manual, conta existente e worker de membros, além do cliente fixo `c4g-email-templates`. O worker de membros recebe apenas `manage-users`, `view-users` e `query-users` em `realm-management`. O cliente de email recebe apenas `publish-password-reset` e `read-delivery-history` no seu próprio cliente, sem roles de administração do realm. Ambos limitam o scope efetivo e têm audiência explícita. São service accounts técnicas, sem credenciais de utilizador nominal no import.

O realm usa português, self-registration desativado, recuperação de password ativa e fluxo de login com OTP condicional a já estar configurado. MFA permanece opcional; `CONFIGURE_TOTP` não é uma ação obrigatória global. O perfil declarativo reserva `c4g_onboarding_owner` a administradores e permite nomes sem apelido. O formato do componente corresponde ao [provider oficial Keycloak26.8.0](https://github.com/keycloak/keycloak/blob/26.8.0/services/src/main/java/org/keycloak/userprofile/DeclarativeUserProfileProvider.java). Não importar este documento por cima de um realm existente: um upgrade exige comparação e plano próprios.

Preparar os providers `dev/keycloak/manual-activation` e `dev/keycloak/email-templates` para a versão Keycloak26.8.0 declarada pelos módulos, assim como os temas C4G. O primeiro usa `c4g-activation.properties`; o segundo disponibiliza os recursos restritos de templates/histórico e o listener `c4g-email-delivery`. Compilar, importar e provar estes componentes no ensaio com Keycloak é um gate separado dos testes unitários que validam o JSON. O alias `c4g-activation-bridge` só existe na rede privada de identidade de produção; a porta5285 não é publicada no host.

## Bundle após publicação do tenant

O instalador completo recebe `--runtime-config` e `--runtime-credentials`. Valida os inputs antes de escrever na base, provisiona o perfil dedicado de faturação e só exporta bindings a partir do snapshot publicado e novamente lido da Central. Confirma identidade da instância, organização, tenant, geração, database/ref, versão, fingerprint041, capacidade de eliminação de identidade, digest de credenciais e residência. Não preencher digests, IDs observados ou snapshots manualmente.

| Artefacto privado | Destino | Conteúdo |
| --- | --- | --- |
| `member-http.json` | API, `/run/private/members/http.json` | Origem/issuer, clientes de ativação, instalação, residência e segredo da ponte |
| `member-worker.json` | Worker IPC, `/run/private/members/worker.json` | Cliente Keycloak, ownership key, bindings publicados, perfil tenant `production-editorial-v1`, Resend exclusivo de convites |
| `api-features.env` | API | OIDC/sessão, UI editorial, acesso, convites, eliminação, faturação, email de autenticação/histórico e política MFA opcional |
| `billing-mail.env` | Processo `billing-mail` | Login SQL limitado, Resend exclusivo de faturação, remetente e origem |
| `keycloak-production.json` | Operador/Keycloak dedicado | Import inicial com segredos dos clientes e SMTP; não montar na API |
| `c4g-activation.properties` | Provider Keycloak | Realm/cliente manual/endpoint e segredo da ponte |

O mapa acima complementa `central-runtime.env` da API, `retention-runtime.env` do job e os ficheiros instaladores. Não misturar credenciais de retenção, instalação ou faturação no ambiente da API. Os ficheiros de membros estão acessíveis ao processo da aplicação que lança o worker IPC; a separação de segredos deste worker é lógica, não um isolamento entre utilizadores do sistema operativo.

O Compose carrega os ficheiros de ambiente gerados em modo `raw`, preservando caracteres como `$` e `#`. Não usar `source`, `eval` ou interpolação shell. Manter permissões privadas e UID/GID correspondentes aos serviços; não imprimir o conteúdo em logs, relatórios ou `compose config` sem `--quiet`. Verificar os mounts explícitos para CA pública/privada; uma CA adicional para PostgreSQL do worker de faturação é `/certs/ca.pem` quando selecionada no bootstrap. Nenhum destes caminhos deve incluir chaves privadas.

O login `c4g_prod_billing_mail` só herda `c4g_billing_validation_worker` com `INHERIT TRUE`, `SET FALSE`, `ADMIN FALSE`; não tem superutilizador, criação de bases/roles, bypass RLS, replicação, ownership, privilégios diretos de tabelas nem acesso ao tenant. Só liga à Central e executa as duas funções de claim/finish já existentes. O admission verifica metadados sem consumir jobs. Reexecução verifica o marcador de instalação, SCRAM, grants e isolamento; divergência bloqueia, sem rotação ou reparação silenciosa.

## Ativação e recuperação

Os flags preparados habilitam os percursos escolhidos quando o operador instala este bundle e arranca a release autorizada. A geração em disco não ativa fornecedores nem faz deploy. Antes dessa ativação, concluir o ensaio: login sem MFA/configuração opcional de MFA, perfis de acesso, convite e ativação, eliminação com isolamento, validação de faturação e tentativas/retry, recuperação de password, publicação do template e leitura do histórico com cliente restrito. Provar também que tokens de clientes errados não conseguem publicar ou ler histórico e que a ponte não tem exposição pública.

Preservar a revisão anterior dos artefactos e a correspondência de segredos/realm. Não trocar isoladamente `memberOwnershipKey`, segredo da ponte ou cliente: isso invalida ownership ou desafios existentes. A reexecução do bootstrap com inputs diferentes não é um mecanismo de rotação. O rollback de serviços usa a revisão anterior compatível de imagem/configuração; recuperação de bases segue [o runbook de rollback](production-057-rollback.md), com backup/restauro testado e sem descer057/058 depois de existirem dados dependentes. Parar produtores de novos convites/email antes de restaurar estado evita repetir efeitos externos.

Evidência local deste módulo: testes focados de configuração/segredos, artefactos/bindings, privilégios/replay e rejeições. Aceitação SQL real pertence ao gate PostgreSQL descartável do instalador; import e comportamento Keycloak/SMTP/Resend pertencem ao ensaio Docker e à validação controlada dos fornecedores. Não apresentar verificações estruturais como entrega real de email ou login real.
