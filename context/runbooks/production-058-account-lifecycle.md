# Produção: convites e eliminação depois da 057

Preparação local, 15/11/2026. Não executado em staging ou produção. [Contrato e provas](../features/production-account-lifecycle.md).

## Pacote e pré-condições

`058_platform_account_lifecycle`, pacote `platform-account-lifecycle-v1`, integra o recibo de envio de convites e o diário/comandos de eliminação no protocolo de autoridade. A 057 mantém o SQL/checksum original. A 058 não provisiona logins nem amplia os grants dos perfis produtivos; a nova tabela só é operada pelo protocolo de autoridade.

O instalador específico aceita a baseline genérica 057 ou a própria 058. Exige nome de base explícito, identidade Central, ledger/checksums e fingerprints exatos. Recusa nomes contendo `staging`, alvo diferente, gaps, variantes não registadas e drift. Os rollouts históricos de staging não fazem parte deste procedimento.

Antes de aplicar: concluir o checkpoint consistente da Central, tenants, Keycloak e efeitos externos conforme [rollback](production-057-rollback.md); parar produtores e drenar API/worker. Fixar imagem/release que conhece 058. Os segredos instaladores continuam apenas no serviço de manutenção.

## Verificar e aplicar

Depois de instalar 057 e provisionar os seus logins pelo procedimento existente, executar primeiro a verificação sem escritas:

```bash
docker compose --env-file /srv/c4g-production/releases/<RELEASE_ID>/release.env -f deploy/production/compose.yaml --profile maintenance run --rm --no-deps migrate node scripts/installPlatformAccountLifecycle.js --expected-database c4g_central_production
```

O comando usa `PRODUCTION_INSTALL_DATABASE_URL` do `install.env` já montado e devolve apenas versão atual, pacote e destino. Para aplicar na janela aprovada:

```bash
docker compose --env-file /srv/c4g-production/releases/<RELEASE_ID>/release.env -f deploy/production/compose.yaml --profile maintenance run --rm --no-deps migrate node scripts/installPlatformAccountLifecycle.js --expected-database c4g_central_production --apply
```

SQL, validação do resultado e registo de 058 são uma transação, sob o lock do runner. Falha antes do commit deixa 057 intacta. Se houver perda da resposta, repetir a verificação: 058 íntegra admite repetição e devolve `applied: []`. Não voltar a executar `installProductionCentral` para este upgrade nem apagar logins/ledger.

Guardar o resultado sanitizado e a release. Conferir os pins de `backend/src/security/platformAccountLifecycleMigrationPackage.js`, medidos em PostgreSQL descartável:

- Checksum SQL: `43b4bb3f832eec9b11155804f3b1d54eb0e35ae828f3dd6d4a8498cb3a8a07c5`.
- Schema: `7c86b26901348aca49c98b6bc24e1b29aaedc607377bb02bb004ec43c1a62454`.
- Autoridade: `7faed0225461434f065dc1ba46416633f23d2d171f23fd8936251046fcd1f61a`.
- Segurança dos perfis produtivos, catálogo e leitor: preservada da 057.

## Configuração e aceite funcional

A compatibilidade SQL não configura fornecedores. O exemplo `api.env.example` continua com os dois runtimes desligados até existirem ficheiros privados, bindings e ensaio integrado. Para os ativar na configuração final:

- `MEMBER_ONBOARDING_RUNTIME=central` e `MEMBER_ONBOARDING_DIRECTORY` absoluto, contendo `http.json` e `worker.json` segundo o contrato de `platformOnboarding/memberRuntime.js` e `memberWorker.js`. Montar apenas esse diretório de configuração privado na API. Usar identidades, remetente e credenciais próprios de produção; não copiar configuração/secrets de staging.
- Configurar os clientes de ativação manual/existente e callbacks em `login.c4g.ai`, origem `https://gcni.c4g.ai`, ponte privada de ativação acessível apenas ao Keycloak de produção e email real. Nenhuma publicação adicional da ponte no proxy público.
- `USER_DELETION_RUNTIME=central` depende desse worker e da capacidade tenant `ACCOUNT_IDENTITY_ERASURE` (migração 041 ou sucessor admitido) em cada binding. A prontidão de eliminação verifica a Central e as projeções tenant; uma dependência ausente bloqueia arranque.
- Preservar `c4g-user-mfa-v1`/`recent-auth`: MFA individual opcional, autenticação recente para eliminação e gestão de acessos. Não usar MFA obrigatório para contornar falta de configuração.

Com `production-v1` e convites selecionados, a API exige exatamente 058 na prontidão antes de iniciar os endpoints de ativação/ponte. Ensaio isolado obrigatório: convite/email/ativação real, recusa entre organizações, confirmação de sessão, eliminação por fases e repetição após falha. Os testes locais simulam Keycloak/email/OIDC; não são prova desses fornecedores em produção.

## Recuperação

058 é irreversível: não há `down` que reconstitua identidades ou efeitos externos. Depois do commit, manter imagem compatível com 058 e corrigir para a frente ou restaurar um checkpoint coerente numa instância isolada. Uma imagem que conhece apenas 057 recusa o novo ledger e não é rollback compatível.

Se uma eliminação já começou, o acesso fica revogado e o diário guarda a fase. Corrigir a dependência e retomar com o mesmo pedido; não reativar manualmente a conta nem apagar o diário. Efeitos externos confirmados ou incertos precisam de reconciliação antes de qualquer restauro. O procedimento geral de [rollback](production-057-rollback.md) continua obrigatório.
