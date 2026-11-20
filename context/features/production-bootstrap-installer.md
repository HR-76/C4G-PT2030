# Instalador de produção

Estado: implementação em revisão, exclusivamente em código e PostgreSQL descartável. Não autoriza deploy nem alterações ao staging. [Procedimento e rollback](../runbooks/production-bootstrap-installer.md); [evidência de validação](../reviews/production-bootstrap-20261115/validation.md).

## Contrato

O instalador prepara uma instância PostgreSQL dedicada: Central com o manifesto registado até `058_platform_account_lifecycle`, tenant até `041_account_identity_erasure`, perfis de execução limitados, diretório F4, primeira entidade e primeiro administrador nominal. Não modifica migrações publicadas nem os instaladores de staging.

A configuração não secreta identifica uma instalação por UUID, host/porta, identificador físico PostgreSQL, nomes distintos das duas bases, entidade, tenant e geração, referência de credenciais e identidade OIDC do administrador. Credenciais são um ficheiro privado separado. A conta OIDC deve existir e ser verificada, ativa e com email confirmado. O instalador não cria passwords de utilizadores nem altera políticas MFA. O papel global C4G_ADMIN é independente da adesão ORG_ADMIN; a configuração tem de escolher explicitamente se o primeiro administrador também administra a primeira entidade.

O modo por omissão apenas verifica e apresenta o plano. A aplicação requer `--apply`, uma instância dedicada e o identificador físico esperado. Recusa staging, instâncias partilhadas, recursos sem prova de propriedade e alterações de configuração numa retoma. Uma função administrativa PostgreSQL é necessária para a instalação; as identidades da aplicação nunca recebem superutilizador. O proprietário técnico fixado pelos manifestos é NOLOGIN e só é elevado durante a janela protegida de instalação, sendo despromovido também quando ocorre uma falha.

As bases pertencem a um proprietário NOLOGIN exclusivo da instalação, com intenção imutável em comentário. O instalador reobserva o estado real em cada execução, retoma apenas recursos próprios e não elimina bases nem roda passwords automaticamente. O tenant só é publicado depois de validar migrações, perfil, identidade física e isolamento. Os dados de autoridade usam o coordenador F5 e os perfis vigentes, mantendo `c4g-user-mfa-v1` e MFA opcional. A auditoria identifica o serviço de instalação, nunca uma sessão humana fictícia.

## Critérios de aceitação

- Plano sem mutações; configuração fechada, destinos e identidade verificados antes de escrever; erros e recibos sem segredos.
- Central 058 e tenant 041 passam os preflights e fingerprints publicados, sem repinning.
- API Central com capacidades separadas; autoridade dedicada; tenant API com perfil mínimo e CONNECT exclusivo. Nenhum login de aplicação é proprietário, superutilizador ou BYPASSRLS.
- Primeira entidade, administrador, eventual adesão ORG_ADMIN e projeção tenant consistentes; grants exatos; conta suspensa ou colisão de identidade nunca é apropriada.
- Repetição não duplica dados nem altera credenciais; retoma após falhas entre fases; configuração divergente e drift de permissões falham fechados.
- PostgreSQL descartável comprova instalação completa, retoma, isolamento, permissões e limpeza do proprietário técnico após erro. Sem ligação ao staging ou produção.
- Suites completas backend/frontend, lint, sintaxe e build; documentação, exemplos privados e rollback por restauro/retenção dos recursos, sem downgrade destrutivo automático.
