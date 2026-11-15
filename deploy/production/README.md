# Preparação de produção — 057/058

Pacote candidato, sem execução remota. Aplicação: `https://gcni.c4g.ai`; identidade: `https://login.c4g.ai` (confirmados pelo utilizador). Não reutilizar ficheiros privados, redes, volumes, bases, identidades ou contas do staging.

- [Procedimento de aplicação e deploy](../../context/runbooks/production-057-deployment.md)
- [Instalador inicial Central058/tenant041 e primeiro administrador](../../context/runbooks/production-bootstrap-installer.md)
- [Pacote privado de runtime e fornecedores](../../context/runbooks/production-runtime-bundle.md)
- [Ensaio Docker isolado e limites da prova](../rehearsal/production/README.md)
- [Configuração e perfis](../../context/runbooks/production-057-configuration.md)
- [Extensão058 para convites e eliminação](../../context/runbooks/production-058-account-lifecycle.md)
- [Rollback e recuperação](../../context/runbooks/production-057-rollback.md)

O compose cobre a aplicação, bootstrap, upgrades, retenção e worker de email de faturação. O job `bootstrap` instala Central058, tenant041, perfis limitados, diretório F4 e primeiro administrador; não cria a instância PostgreSQL, Keycloak, conta OIDC inicial, proxy ou backups. Esses serviços e a conta verificada são pré-requisitos. Os modelos `*.example` contêm placeholders e não constituem uma configuração final autorizada para clientes.

## Percurso inicial e configuração

O perfil `bootstrap` é separado de `release`: nenhum arranque da API aplica migrações automaticamente. A primeira instalação usa `compose.bootstrap.yaml`, que contém apenas o job e não depende dos ficheiros de runtime que ainda vai gerar. O mesmo job existe no compose principal, com equivalência validada por teste. O comando por omissão apenas apresenta o plano. Preparar previamente os ficheiros privados `bootstrap.env`, `bootstrap.config.json`, `bootstrap.credentials.json`, `runtime.config.json` e `runtime.credentials.json` na revisão de configuração. Criar `bootstrap-output` privado e gravável pelo UID/GID1000 da imagem; os outros inputs ficam apenas para leitura. Nunca conceder permissões globais para contornar um erro de UID.

O ficheiro `bootstrap.env` contém apenas o ambiente de instalação, o URL administrativo terminado em `/postgres` e o token Keycloak de leitura temporário. Não o montar nos serviços de API, faturação ou retenção. Usar os exemplos de configuração do instalador e do pacote de runtime e completar os dados reais em privado.

Plano, após autorização de acesso ao destino dedicado:

```text
docker compose --env-file /srv/c4g-production/releases/<RELEASE_ID>/release.env -f deploy/production/compose.bootstrap.yaml --profile bootstrap config --quiet
docker compose --env-file /srv/c4g-production/releases/<RELEASE_ID>/release.env -f deploy/production/compose.bootstrap.yaml --profile bootstrap run --rm --no-deps bootstrap
```

Aplicação é uma ação separada, nunca executada implicitamente pelo pacote. Quando autorizada, fornecer o comando completo, acrescentando `--apply`:

```text
docker compose --env-file /srv/c4g-production/releases/<RELEASE_ID>/release.env -f deploy/production/compose.bootstrap.yaml --profile bootstrap run --rm --no-deps bootstrap node scripts/installProductionPlatform.js --config /run/private/bootstrap.config.json --credentials /run/private/bootstrap.credentials.json --runtime-config /run/private/runtime.config.json --runtime-credentials /run/private/runtime.credentials.json --output-dir /run/output --apply
```

Rever os artefactos gerados em `bootstrap-output` e instalar os ficheiros privados da mesma execução na revisão de configuração. A API carrega, por esta ordem, `api.env`, `central-runtime.env` e `api-features.env`: os fragmentos gerados substituem os placeholders correspondentes. `api.env` continua a fornecer armazenamento, scanner, limites e outras opções que não pertencem ao bootstrap. Não usar `source` destes ficheiros; são carregados com `format: raw`.

O compose monta `member-http.json` e `member-worker.json` como `/run/private/members/http.json` e `worker.json`. Os segredos Keycloak/Resend de convites ficam no ficheiro do worker IPC. A ponte usa a alias `c4g-activation-bridge` apenas na rede de identidade exclusiva, porta interna5285, sem publicação no host. A alias respeita o contrato do provider Keycloak existente; o módulo não admite hosts arbitrários.

`billing-mail.env` é exclusivo do serviço `billing-mail`, selecionado pelo perfil homónimo. `retention-runtime.env` é exclusivo do job `retention`. Estes serviços não recebem os ficheiros do instalador nem os segredos de outros perfis. O job `migrate` continua reservado ao upgrade057 de uma baseline056; numa instalação nova, o bootstrap já chega à058 e não se executa esse upgrade por cima.

O âmbito preparado inclui editorial/PQ1, convites, eliminação, validação de faturação e email de autenticação/histórico. MFA mantém-se opcional. A ausência de configuração privada ou dos providers necessários bloqueia o arranque; não retirar funcionalidades para esconder essas falhas. Se o Keycloak usar CA privada, fornecer a CA ao processo e ao caminho `certificate` configurado no worker através de um mount de ficheiro somente de leitura revisto; não montar diretórios que contenham chaves privadas. O modelo base assume o certificado público de `login.c4g.ai`.

Projeto: `c4g-production-app`. API em loopback `8600`, proposta a verificar livre na VPS; PostgreSQL e Keycloak sem portas públicas de administração. A API e ClamAV partilham o namespace de rede do `pod` estável para preservar o scanner em loopback. Alterar/recriar o pod exige recriar também API e ClamAV. Não existe worker de recolha.

Todas as imagens são fornecidas por digest em `release.env`; não há atualização automática por tag. A imagem da API é construída pelo Dockerfile deste diretório a partir de uma revisão identificada. Memória/pids são propostas conservadoras, por medir em ensaio; não alteram limites de outros ambientes na VPS.

Não executar `compose config` sem `--quiet` com ficheiros reais: a saída pode incluir segredos de `env_file`. Nunca copiar valores reais para estes exemplos, fazer `cat` de ficheiros privados ou usar `set -x` nos procedimentos. Usar ficheiros versionados por configuração fora do checkout, legíveis apenas pelo operador e UID/GID do contentor que precisa deles.

Validação local dos modelos: `node --test test/production-preparation.test.cjs test/production-rehearsal.test.cjs`. É uma prova estrutural, de configuração e de segurança do executor com comandos Docker simulados. A validação Docker real, o ensaio completo de fornecedores e o restauro continuam obrigatórios antes da ativação.
