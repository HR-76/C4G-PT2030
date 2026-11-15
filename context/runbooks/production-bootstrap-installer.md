# Instalação inicial de produção

Este procedimento prepara as bases e a primeira identidade numa instância PostgreSQL de produção dedicada. A implementação aplica a Central até `058_platform_account_lifecycle`, o tenant até `041_account_identity_erasure`, os perfis limitados e a ligação F4. Não executa deploy, não inicia a API e não configura o staging.

O executável é `backend/scripts/installProductionPlatform.js`. Os exemplos em `deploy/production/bootstrap.config.example.json` e `deploy/production/bootstrap.credentials.example.json` são deliberadamente inválidos até substituir todos os valores `REPLACE_*`. Não são uma configuração real nem identificam a primeira entidade.

## Pré-condições

- PostgreSQL 17 ou 18 já disponível numa instância exclusiva, com ICU e TLS verificado. A instalação inicial exige que as duas bases ainda não existam; uma retoma aceita exclusivamente as bases e os recursos pertencentes à mesma instalação. Não partilhar esta instância com staging, mesmo usando outros nomes de bases.
- Conta administrativa temporária com autoridade para criar bases, perfis e aplicar as migrações. O endereço administrativo aponta à base `postgres`, no host e porta da configuração. A conta administrativa nunca entra nos ficheiros da API nem dos jobs.
- Identificador físico confirmado no destino autorizado: `SELECT (pg_control_system()).system_identifier::text;`. Copiar o resultado decimal integral para `target.expectedSystemIdentifier`. Não o obter de um ambiente diferente nem reutilizar um identificador de staging.
- Acesso administrativo somente de leitura à conta inicial no Keycloak de produção. A conta deve já existir, estar ativa, ter email confirmado e não ter a ação pendente `UPDATE_PASSWORD`. O `subject` é o ID exato desse utilizador no realm indicado pelo issuer.
- Diretório privado fora do checkout, acessível apenas ao operador autorizado. Proteger os inputs e os outputs com permissões do sistema operativo. Em Unix, usar diretório `0700` e ficheiros `0600`; em Windows, aplicar ACL equivalente. Nunca colocar material real em Git, tickets, mensagens ou logs.

O instalador não cria PostgreSQL, certificados, redes, volumes, Keycloak, realm, client OIDC ou passwords de utilizadores. O [pacote privado de runtime](production-runtime-bundle.md) prepara o import inicial de identidade antes de a conta real existir; importar e verificar essa conta são etapas separadas. A verificação usa `identity.adminOrigin` privado, mantendo o issuer público, sem expor `/admin` pelo domínio de login. MFA permanece opcional.

## Configuração e segredos

Copiar os dois exemplos para o diretório privado e preencher os campos. A configuração é fechada: chaves desconhecidas são recusadas. Usar UUIDs próprios para instalação, entidade, tenant, geração, administrador e eventual membership. Manter esses valores numa retoma.

`target.host`, `port`, `expectedSystemIdentifier`, `centralDatabase` e `tenantDatabase` identificam o destino. As bases têm nomes distintos. Nomes que contêm `staging`, destinos partilhados e recursos sem prova de propriedade são recusados. `target.ssl.rejectUnauthorized` tem de ser `true`; opcionalmente `target.ssl.ca` contém o PEM da CA. Não existe flag CLI para desativar TLS. A exceção loopback é exclusiva do código dos testes descartáveis.

Os campos da entidade são `id`, `name`, `legalName`, `slug`, `type`, `currency` e `dataResidencyCode`. Usar os códigos reais aprovados, incluindo o código de moeda de três letras. `type` tem de pertencer ao contrato vigente de registo: `UNIVERSITY`, `COMPANY`, `MUNICIPALITY`, `ASSOCIATION`, `PUBLIC_BODY`, `RESEARCH`, `CONSULTANCY` ou `OTHER`. `tenant.regionCode` é `EU`; o código de residência da entidade e a política `residencyPolicyVersion` devem representar a localização e as regras aprovadas para essa entidade. `apiLogin` é um identificador dedicado, por exemplo `prod_tenant_api`, sem os prefixos reservados `c4g_` ou `pg_`. `credentialRef` é uma referência estável de 1 a 256 caracteres: começa por letra ou algarismo e contém apenas letras, algarismos, ponto, underscore ou hífen. Não aceita `:` ou `/`, nem passwords ou URLs.

O issuer tem o formato exato `https://login.c4g.ai/realms/<realm-confirmado>`, sem barra final, parâmetros ou fragmento. Confirmar o email e o ID da conta antes de preencher `administrator.subject`. O administrador recebe o papel de plataforma `C4G_ADMIN`. A adesão à primeira entidade é uma decisão explícita:

| Configuração | Resultado |
| --- | --- |
| `organizationProfile: "ORG_ADMIN"` e `membershipId: "<uuid>"` | Administrador da plataforma e da primeira entidade, com projeção no tenant. |
| `organizationProfile: null` e `membershipId: null` | Administrador apenas da plataforma, sem adesão à entidade. |

Usar o valor JSON `null`, sem aspas, quando aplicável. Não criar um administrador global presumindo que terá acesso aos dados da entidade. A autorização usa os perfis vigentes e `c4g-user-mfa-v1`; MFA continua opcional.

O ficheiro privado de credenciais tem exatamente nove segredos independentes: sete passwords Central (`read`, `commands`, `authoring`, `logs`, `retention`, `catalog`, `authority`), uma password `tenantApi` e `permitSecret`. As oito passwords PostgreSQL têm 32 a 4096 caracteres ASCII imprimíveis, sem espaços. `permitSecret` tem de codificar pelo menos 32 bytes em hexadecimal: 64 a 4096 caracteres hexadecimais, em número par, conforme o contrato do runtime de produção. Todos os nove valores têm de ser diferentes. Gerar cada segredo com um gerador criptográfico; recomenda-se usar pelo menos 32 bytes aleatórios codificados em hexadecimal também para as passwords. Não reaproveitar passwords ou segredos do staging. O secret de sessão, o client secret OIDC e outros serviços continuam a ser configurados separadamente.

O perfil tenant selecionado é `production-editorial-v1`: inclui as capacidades base e `c4g_organization_profile_runtime` para editorial/PQ1. API, projeção do primeiro administrador, convites e eliminação partilham este contrato. O instalador recusa um recurso anterior marcado com outro perfil ou com grants adicionais; não faz upgrade silencioso de uma instalação mínima existente. As migrações058/041 e os fingerprints publicados mantêm-se inalterados.

Para a primeira release, fornecer também `runtime.config.json` e `runtime.credentials.json`, conforme os novos exemplos. Os onze segredos adicionais são independentes entre si e dos nove segredos do bootstrap. O pacote seleciona convites, eliminação, faturação, email de autenticação/histórico e editorial/PQ1. A intenção pública fica identificada por digest; um papel NOLOGIN separado guarda apenas o verificador SCRAM da intenção privada, para recusar trocas de segredos em retomas.

## Plano sem alterações

Preparar `PRODUCTION_INSTALL_DATABASE_URL` no ambiente do processo por um mecanismo privado. O formato é `postgresql://<administrador>:<password-codificada>@<host>:<porta>/postgres`; os caracteres especiais da password devem estar codificados para URL. O executável reconstrói a ligação usando TLS da configuração e exige correspondência do host, porta, base e identificador físico. Não passar a URL nem segredos em argumentos CLI. O `install.env.example` anterior destina-se à atualização 057 de uma Central existente; não o reutilizar para este bootstrap sem rever o destino `/postgres`.

Executar a partir de `backend/`, substituindo os caminhos pelos ficheiros privados reais:

```text
node scripts/installProductionPlatform.js --config /private/bootstrap.config.json --runtime-config /private/runtime.config.json --output-dir /private/bootstrap-output
```

O modo por omissão consulta o destino, verifica os limites da instalação e apresenta o plano sem criar bases, perfis ou ficheiros. O diretório de saída é indicado antecipadamente mas não é criado pelo plano. O plano identifica as versões de destino e o digest da intenção, sem passwords. A verificação da conta Keycloak ocorre no modo de aplicação; um plano aprovado não confirma que essa conta já está pronta.

## Aplicação e artefactos privados

Quando a aplicação deste procedimento estiver autorizada, disponibilizar também `PRODUCTION_BOOTSTRAP_KEYCLOAK_TOKEN` no ambiente do processo. Usar um token de curta duração com acesso apenas à leitura do utilizador esperado. O instalador faz um GET à API administrativa desse realm, recusa redirecionamentos e não cria nem modifica utilizadores Keycloak. Não colocar esse token na configuração da aplicação nem nos artefactos de saída.

```text
node scripts/installProductionPlatform.js --config /private/bootstrap.config.json --credentials /private/bootstrap.credentials.json --runtime-config /private/runtime.config.json --runtime-credentials /private/runtime.credentials.json --output-dir /private/bootstrap-output --apply
```

O instalador mantém um lock exclusivo, marca a propriedade dos recursos e revalida o estado observado. O proprietário técnico fixado pelos manifestos, `c4g_f12_admin`, é NOLOGIN e só tem elevação administrativa durante a janela protegida das migrações; essa elevação é removida no sucesso ou erro. Os logins da aplicação não recebem superutilizador, BYPASSRLS, propriedade de objetos ou permissões de criação de bases/perfis. As credenciais existentes são verificadas; uma retoma não roda passwords.

Na Central nova, o bootstrap atribui a função existente `pg_catalog.pg_control_system()` a esse proprietário técnico, conforme o proprietário já fixado no fingerprint da 057. Esta normalização limita-se à base Central vazia e mantém os manifestos publicados; não exige que o administrador da instância tenha o nome do proprietário técnico. O proprietário NOLOGIN exclusivo da instalação guarda também um verificador SCRAM privado de `permitSecret`, para recusar a substituição desse secret numa retoma sem expor hashes em comentários ou recibos.

Só depois das verificações, do provisionamento e da criação consistente do administrador são produzidos:

| Ficheiro | Utilização posterior |
| --- | --- |
| `central-runtime.env` | URLs da API separadas por capacidade e `AUTHORITY_COMMIT_PERMIT_SECRET`. Não contém a password de retenção. |
| `retention-runtime.env` | URL exclusiva do job de retenção e perfil de produção. Não contém as credenciais da API. |
| `postgres-ca.pem`, quando há `target.ssl.ca` | CA a instalar no caminho privado já montado pela composição de produção. |
| `tenant-api-credentials.json` | Valor de `OPPORTUNITY_API_CREDENTIALS_JSON`. |
| `allowed-residency.json` | Valor de `OPPORTUNITY_ALLOWED_RESIDENCY_JSON`. |
| `bootstrap-receipt.json` | Identificadores, versões e digest da instalação, sem segredos. |
| `api-features.env` | Sessão, OIDC, UI e flags escolhidas, incluindo MFA opcional. |
| `member-http.json`, `member-worker.json` | Configuração de convites/eliminação com snapshot F4 observado e segredo de email próprio do worker. |
| `billing-mail.env` | Login `c4g_prod_billing_mail`, Resend e remetente exclusivos do worker de faturação. |
| `keycloak-production.json`, `c4g-activation.properties` | Import inicial privado e propriedades do provider; idênticos aos preparados antes do bootstrap. |

Todos os ficheiros de saída devem permanecer privados, mesmo quando um recibo isolado não contém passwords. O instalador não sobrescreve ficheiros divergentes: repetir uma saída idêntica é permitido; um conflito exige revisão. Não imprimir nem fazer `source` de `central-runtime.env`: contém valores brutos e não é um script de shell. A composição de produção existente carrega os ficheiros com `env_file.format: raw`.

Com os inputs de runtime, `api-features.env` já fornece organização, OIDC, sessão, URLs públicas, política opcional e proxies validados. Completar `api.env` com armazenamento/scanner, limites e restantes opções descritas no [mapa de configuração](production-057-configuration.md); a ordem de carregamento é `api.env`, `central-runtime.env`, `api-features.env`. A geração dos ficheiros não inicia serviços. O `compose.yaml` monta `/srv/c4g-production/postgres/certs/ca.pem` em `/certs/ca.pem` e define `NODE_EXTRA_CA_CERTS=/certs/ca.pem`. Quando existe `target.ssl.ca`, o instalador emite `postgres-ca.pem` e a variável `NODE_EXTRA_CA_CERTS` nos fragmentos dos consumidores PostgreSQL. Instalar essa CA no caminho privado montado, antes de um deploy autorizado; gerar o ficheiro não modifica o host nem os containers. A confiança TLS do processo CLI e do runtime deve ser consistente.

## Falhas, retoma e rollback

Uma falha apresenta um código fechado, sem erros PostgreSQL brutos que possam conter dados privados. Bases, perfis e dados criados são retidos. Não existe limpeza destrutiva ou downgrade automático. As transações protegem cada etapa; a criação das duas bases e a publicação de identidades não constituem uma única transação distribuída.

Guardar as configurações originais e os vinte segredos independentes do pacote completo. Corrigir a causa operacional e voltar a executar o plano e a aplicação com os mesmos inputs. O digest da intenção, a propriedade dos recursos, os verificadores das passwords, os manifestos e as permissões são novamente confirmados. Alterar a configuração, adotar recursos de outra instalação, reutilizar uma conta suspensa ou encontrar permissões divergentes faz a retoma falhar. Um token Keycloak expirado pode ser substituído por outro token de leitura, sem alterar a intenção.

Se houver conflito nos artefactos, preservar os ficheiros existentes e compará-los em privado. Não remover dados ou redefinir passwords para fazer a retoma passar. Uma falha durante a escrita dos artefactos pode ocorrer depois de o provisionamento ter concluído; repetir a mesma instalação recupera a saída sem duplicar identidades.

Antes de uma execução real, preparar backups e uma prova de restauro da instância e da configuração privada. Enquanto não houver deploy, o rollback consiste em manter a aplicação anterior parada ou inalterada e reter os recursos provisionados para diagnóstico/restauro. Depois de um futuro deploy, primeiro interromper escritas e regressar à versão/configuração compatível acordada no plano de release; se necessário, restaurar o conjunto coerente de bases e segredos para um destino isolado. Não executar `down` da 058 nem eliminar bases para simular rollback. A eliminação posterior de uma instalação abandonada requer autorização específica e verificação do seu destino.

## Evidência de aceitação

Os comandos de integração são `node test/integration/production-bootstrap/gate.cjs full` (falhas/retomas) e `node test/integration/production-bootstrap/gate.cjs fresh` (instalação direta), executados na raiz do repositório. O gate usa PostgreSQL18 local, autenticação SCRAM, porta loopback aleatória e diretório próprio em `.tmp`; termina o processo e remove apenas os dados desse cluster, preservando o recibo de teste sem segredos.

Executar os testes unitários e o gate de PostgreSQL descartável do instalador. Este último deve criar uma instância própria em loopback e comprovar instalação inicial, retoma após falhas, fingerprints publicados, perfis sem elevação, isolamento entre Central e tenant e grants exatos do primeiro administrador. O teste não recebe uma URL de staging ou produção. Registar os resultados das suites completas e do build antes de preparar a autorização de um deploy separado.

Para Docker, o [executor isolado](../../deploy/rehearsal/production/README.md) reutiliza estes checks dentro da imagem candidata. A instalação inicial futura usa `deploy/production/compose.bootstrap.yaml`, que não depende dos ficheiros de runtime ainda por gerar. O ensaio Docker e a aceitação de Keycloak/SMTP/Resend/TLS reais são provas separadas; testes locais com fornecedor simulado não as substituem.
