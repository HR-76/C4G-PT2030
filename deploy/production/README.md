# Preparação de produção — 057/058

Pacote candidato, sem execução remota. Aplicação: `https://gcni.c4g.ai`; identidade: `https://login.c4g.ai` (confirmados pelo utilizador). Não reutilizar ficheiros privados, redes, volumes, bases, identidades ou contas do staging.

- [Procedimento de aplicação e deploy](../../context/runbooks/production-057-deployment.md)
- [Configuração e perfis](../../context/runbooks/production-057-configuration.md)
- [Extensão058 para convites e eliminação](../../context/runbooks/production-058-account-lifecycle.md)
- [Rollback e recuperação](../../context/runbooks/production-057-rollback.md)

O compose cobre **apenas a aplicação e os jobs de migração/retenção**. Não cria PostgreSQL, Keycloak, tenant, primeiro administrador, proxy ou backups. São pré-requisitos explícitos, não serviços já existentes presumidos. Os modelos `*.example` contêm placeholders e flags de ensaio técnico: não constituem uma configuração final autorizada para clientes.

Projeto: `c4g-production-app`. API em loopback `8600`, proposta a verificar livre na VPS; PostgreSQL e Keycloak sem portas públicas de administração. A API e ClamAV partilham o namespace de rede do `pod` estável para preservar o scanner em loopback. Alterar/recriar o pod exige recriar também API e ClamAV. Não existe worker de recolha.

Todas as imagens são fornecidas por digest em `release.env`; não há atualização automática por tag. A imagem da API é construída pelo Dockerfile deste diretório a partir de uma revisão identificada. Memória/pids são propostas conservadoras, por medir em ensaio; não alteram limites de outros ambientes na VPS.

Não executar `compose config` sem `--quiet` com ficheiros reais: a saída pode incluir segredos de `env_file`. Nunca copiar valores reais para estes exemplos, fazer `cat` de ficheiros privados ou usar `set -x` nos procedimentos. Usar ficheiros versionados por configuração fora do checkout, legíveis apenas pelo operador e UID/GID do contentor que precisa deles.

Validação local dos modelos: `node --test test/production-preparation.test.cjs`. É uma prova estrutural e de configuração com valores sintéticos; a validação Docker e o ensaio de infraestrutura/rollback continuam obrigatórios antes da ativação.
