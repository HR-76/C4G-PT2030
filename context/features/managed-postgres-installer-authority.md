# Instalação sem superutilizador (PostgreSQL gerido)

Estado: suspensa em 12/11/2026. O utilizador escolheu [PostgreSQL na VPS para o staging](../decisions/2026-11-12-staging-postgresql-on-vps.md). As alterações de código desta sonda foram revertidas; nenhum critério de aceitação foi cumprido.

O instalador dos schemas Central e tenant eleva o role `c4g_f12_admin` a `SUPERUSER` e corre as migrações em nome dele com `SET SESSION AUTHORIZATION` ([installerAuthority.js](../../backend/scripts/localPlatform/installerAuthority.js)). Um PostgreSQL gerido, como o Neon aprovado na [decisão de alojamento](../decisions/hosting-and-external-services.md), não concede superutilizador nem permite mudar a autorização da sessão. Sem esta alteração não existe caminho para instalar o esquema em staging.

## Âmbito

- Um segundo modo de autoridade do instalador, para um administrador sem superutilizador.
- O modo atual, com superutilizador, mantém-se para o ambiente local e para os gates existentes.
- Fora de âmbito nesta fase: instalador para alvos remotos (TLS, segredos fora de `.tmp`), migrador que percorre os tenants do diretório, pacotes Central posteriores à 035 e os sete scripts de ativação. São etapas seguintes da mesma linha de trabalho.

## Critérios de aceitação

- Com um administrador `NOSUPERUSER` que tenha `CREATEROLE`, `CREATEDB` e `BYPASSRLS`, a instalação da Central e de um tenant conclui em PostgreSQL 18 e passa `preflightCentral` e `preflightTenant`.
- Os ficheiros de migração e os checksums registados não mudam.
- Os objetos ficam com os mesmos donos que na instalação com superutilizador; os fingerprints de schema fixados são iguais nos dois modos.
- Nenhum role fica com `SUPERUSER`. No fim da instalação `c4g_f12_admin` está `NOLOGIN`, `NOCREATEROLE`, `NOCREATEDB` e sem password, em sucesso, falha ou sinal; o resultado é verificado.
- As pertenças a roles criadas apenas para a instalação são removidas no fim. Qualquer pertença que o PostgreSQL não deixe remover fica documentada, e as verificações de segurança só a toleram se não der `SET` nem `INHERIT`.
- Um alvo com superutilizador continua a usar o modo atual, sem alteração de comportamento; a suite existente passa.
- Nenhuma credencial é registada ou impressa.
- Falha fechada: se o administrador não tiver os atributos necessários, a instalação recusa antes de criar objetos.

## Resultado da sonda (12/11/2026)

Dois clusters PostgreSQL 18.6 temporários nesta máquina, apagados no fim. Controlo com superutilizador; sonda com um administrador `NOSUPERUSER CREATEROLE CREATEDB BYPASSRLS`.

**Experimentado e revertido.** [installerAuthority.js](../../backend/scripts/localPlatform/installerAuthority.js) escolhe o modo a partir do administrador ligado. Sem superutilizador, `c4g_f12_admin` torna-se um login temporário com `CREATEROLE` e password aleatória, recebe `CREATE` nas bases e no schema `public`, e concede a si próprio `SET`/`INHERIT` sobre os roles que administra. No fecho tudo é retirado e verificado. [schema.js](../../backend/scripts/localPlatform/schema.js) deixa de exigir superutilizador e faz as operações de roles pela sessão do instalador. Na sonda a janela abriu, criou os roles de base, aplicou as migrações Central 000–008 e, após a falha, fechou sem deixar login, password ou pertenças utilizáveis.

**Bloqueio 1, sem solução no instalador.** A migração Central `009_authority_commit_guard` recusa com `AUTHORITY_ROLE_INVALID` qualquer pertença aos roles `c4g_authority_*` além de duas fixas. Desde o PostgreSQL 16, quem cria um role sem ser superutilizador fica registado como membro com opção de administração, concedida pelo superutilizador de arranque. Verificado na sonda: o criador não consegue retirar essa pertença (`permission denied to revoke privileges granted by role "postgres"`), e sem ela não consegue executar os `GRANT` de roles que a mesma migração faz a seguir. A asserção não é satisfazível sem superutilizador, e o SQL da migração tem checksum fixado. A migração `029_catalog_reader` tem uma asserção do mesmo género.

**Bloqueio 2.** Com a asserção da 009 relaxada só na sonda, a migração falha a seguir em `ALTER TABLE ... OWNER TO c4g_authority_owner`: o novo dono precisa de `CREATE` em `public`, e o `GRANT` que a migração faz não tem efeito porque quem o executa não é dono do schema. O superutilizador ignora ambas as regras.

**Não medido.** Migrações Central 010–035, todas as do tenant, pacotes posteriores à 035 e a comparação de fingerprints entre modos. Dois bloqueios em dez migrações indicam que há mais.

**Defeito já existente, independente deste trabalho.** Uma instalação nova com superutilizador falha em `preflightCentral` com `CATALOG_SECURITY_DRIFT`: `schema.js` concede `USAGE` em `opportunity_catalog` a `c4g_f12_admin` depois das migrações, e o fingerprint fixado para a 035 (`b0676b4c…`) corresponde ao schema sem essa concessão. Sem a concessão, o controlo conclui e passa os dois preflights. Por corrigir; a sonda contornou-o apenas no seu próprio guião.

## Vias avaliadas

Escolhida a terceira para o staging. Retomar este trabalho para produção exige uma das duas primeiras:

1. Alterar migrações publicadas (009, 029 e as que a medição revelar) e registar checksums alternativos, como já se faz para CRLF.
2. Construir o schema com superutilizador e transferi-lo por cópia, tolerando nos manifests as pertenças de criador; as migrações futuras teriam de nascer compatíveis.
3. Usar PostgreSQL com superutilizador (por exemplo na VPS) e rever a decisão de alojamento.

## Verificação prevista

- Cluster PostgreSQL 18 temporário, isolado, noutra porta, apagado no fim. Execução de controlo com superutilizador e execução sem superutilizador, comparando donos e fingerprints.
- Testes unitários do novo modo antes da implementação; suite backend e lint.
- Confirmação num branch Neon: etapa própria, com autorização específica.
