# Central: implementação do perfil de produção sem superutilizador

15/11/2026. Implementação autorizada pela aprovação da [matriz](central-production-permissions-matrix.md). Apenas ficheiros locais e PostgreSQL descartável; staging e produção não foram alterados.

Seguimento autorizado: corrigir as três falhas backend preexistentes e repetir ambas as suites completas. Critérios: provar admissão/rejeição das versões pelo contrato efetivo, sem depender de nomes de imports; reconhecer apenas o marcador UI de conclusão do próximo passo, com conteúdo constante e âmbito utilizador/organização/candidatura/fase, mantendo a proibição de autenticação em storage. Preservar runtime, grants, ambientes e evidência histórica; registar o novo resultado separadamente.

Seguimento concluído: [3404 testes backend e 1141 frontend aprovados, sem falhas](../reviews/central-production-permissions-20261115/backend-suite-repair.md), com 9 testes backend ignorados já existentes. Lint, sintaxe e build aprovados. Sem alteração de runtime ou staging nesta correção.

## Contrato implementado

O pacote explícito `production-central-permissions-v1` aplica `057_production_central_permissions` sobre a baseline genérica 056. Não muda a cadeia usada pelo staging nem admite os seus fingerprints como produção. A migração é aditiva e irreversível pelo runner: não elimina dados, não cria passwords e não revoga perfis que possam ser usados por outros processos. As credenciais antigas não devem ser montadas nos novos processos.

`CENTRAL_RUNTIME_PROFILE=production-v1` seleciona os pools por capacidade. Credenciais em falta, repetidas, de bases/hosts diferentes ou autoridade com login diferente do contrato fechado impedem o arranque. Sem esta seleção explícita, o comportamento dos ambientes existentes mantém-se. O perfil de produção recusa recolha, importação tenant XLSX, documentos de candidaturas, ativação v2 genérica e o flag de admissão do staging. A criação manual e a aceitação PT2030 NEW continuam disponíveis; não se concedeu UPDATE genérico de oportunidades.

| Processo / capacidade | Login | Papel / configuração |
|---|---|---|
| API: leituras administrativas e prontidão | `c4g_prod_api_read` | `c4g_prod_read_role`; `CENTRAL_DATABASE_URL` |
| API: comandos PDF, email, complemento e validação | `c4g_prod_api_commands` | `c4g_prod_commands_role`; `CENTRAL_COMMANDS_DATABASE_URL` |
| API: manual e PT2030 | `c4g_prod_catalog_authoring` | `c4g_prod_authoring_role`; `CENTRAL_AUTHORING_DATABASE_URL` |
| API: escrita de logs | `c4g_prod_logs` | `c4g_prod_logs_role`; `CENTRAL_LOGS_DATABASE_URL` |
| API: autoridade e diretório restrito | `c4g_authority_runtime` | Contrato existente; `AUTHORITY_DATABASE_URL` |
| API: leitura do catálogo | `c4g_prod_catalog_read` | `c4g_catalog_reader`; `CATALOG_DATABASE_URL` |
| Job separado: retenção de destinatários | `c4g_prod_email_retention` | `c4g_prod_retention_role`; `CENTRAL_EMAIL_RETENTION_DATABASE_URL` |
| Worker de email de faturação, quando ativado | Login dedicado do provisionamento existente | `c4g_billing_validation_worker`; não recebe os pools da API |

O nome do login de autoridade permanece `c4g_authority_runtime`: o protocolo existente valida esta identidade exata. Os seis logins novos são NOINHERIT, sem superutilizador, criação de bases/papéis, replicação, BYPASSRLS ou ADMIN OPTION. Selecionam o seu único papel com SET LOCAL ROLE dentro da transação. O owner das três novas funções é NOLOGIN e não é membro de nenhum login de serviço. O utilizador privilegiado usado para instalar SQL não pertence ao runtime.

Cada checkout verifica atributos do login, pertença única, ausência de grants diretos/ownership e fingerprint dos papéis funcionais, ACLs e funções, incluindo EXECUTE para PUBLIC. Não existe fallback para o pool privilegiado. Falhas de queries e transações abandonadas provocam rollback. Os pools novos têm limites de 8 ligações para leitura e 2 para cada outra capacidade da API.

As verificações de administrador não devolvem sessões nem concedem UPDATE em utilizadores ao runtime. A variante de escrita bloqueia sessão, utilizador e atribuição até ao commit. A criação manual, PT2030 e auditoria permanecem na mesma transação. A migração só concede UPDATE de `revision_number,latest_revision_id` na identidade PT2030 e de `last_v2_observed_at` na oportunidade; o escritor de produção recusa ações diferentes de NEW, preservando o replay do recibo existente.

O diretório passa pelo coordenador de autoridade mesmo sem documentos ativos. `CENTRAL_API_ORGANIZATIONS_JSON` define a lista explícita de UUIDs de organizações; o workload está fixado em API. Não se expõem credenciais de ligação por SQL arbitrário. As leituras administrativas da Central continuam a abranger várias organizações por desenho; o perfil SQL de leitura não é uma política RLS por organização. O controlo funcional de membership e dos comandos continua obrigatório.

Os comandos opcionais aprovados da Central 056 estão incluídos no papel de comandos; as respetivas flags controlam a montagem dos serviços. A retenção SQL foi retirada do processo API neste perfil e usa exclusivamente o job separado. A limpeza do histórico Keycloak mantém o endpoint restrito e timer existentes na API, sem executar SQL de retenção. A API reporta saúde de retenção desconhecida (`null`) quando só observa o fornecedor e não o job SQL externo; falhas do fornecedor continuam visíveis. Monitorizar a conclusão do job separado. Os perfis de recolha e os writers europeus não são concedidos aos logins novos.

## Instalação operacional preparada, não executada

1. Preparar uma Central de produção separada e verificar a baseline genérica 056. Não usar o URL de staging nem os seus flags/variantes de admissão. Instalações com variantes de member email/user deletion precisam do respetivo percurso de migração validado; este pacote não normaliza variantes nem aceita hashes por aproximação.
2. Usar uma credencial temporária de instalação em `PRODUCTION_INSTALL_DATABASE_URL`, fora da configuração da API. Em ambiente remoto usar `NODE_ENV=production` e transporte TLS verificado. O perfil exige PostgreSQL com opções de membership `INHERIT/SET`; a prova deste trabalho usa PostgreSQL 18.
3. Executar primeiro `node backend/scripts/installProductionCentral.js --expected-database NOME`. Sem `--apply`, apenas confirma o nome e apresenta o plano. Nomes contendo `staging` e divergência do nome real são recusados.
4. Para execução autorizada em produção, acrescentar `--apply --credentials CAMINHO_PRIVADO`. O ficheiro JSON tem exatamente as chaves `read`, `commands`, `authoring`, `logs`, `retention`, `catalog`, cada uma com password independente de pelo menos 32 caracteres. Guardar fora do repositório, com ACL privada. O instalador não imprime SQL, passwords ou URLs; cria os seis logins e CONNECT depois da migração. Logins já existentes causam recusa e rollback do provisionamento, sem rotação silenciosa. A reaplicação do pacote SQL pelo runner é idempotente.
5. Provisionar a password privada do login de autoridade já criado pelas migrações pelo procedimento operacional existente, sem alterar os atributos/pertenças do contrato. Configurar os seis URLs da API na mesma Central e definir `CENTRAL_API_ORGANIZATIONS_JSON`. Retirar a credencial de instalação do processo e ativar `CENTRAL_RUNTIME_PROFILE=production-v1`. Manter `FUNDING_TENDERS_SOURCE=unconfigured`; as restantes flags opcionais continuam explícitas.
6. Se o histórico de email estiver ativo, agendar `node backend/src/emailTemplates/retentionWorker.js` num processo separado com apenas a credencial de retenção. É uma execução única, com preflight; o agendamento pertence à operação. Não foi criado um agendamento neste trabalho. O worker de envio de faturação mantém o perfil dedicado existente.
7. Antes de servir tráfego, executar a prontidão completa da aplicação com as credenciais finais e verificar os fluxos OIDC/tenant/fornecedores no ambiente novo. Uma falha de grants ou fingerprint impede o arranque. Não contornar a falha com superutilizador ou flags de staging.

Não há rollback destrutivo automático: para recuar a aplicação, interromper o tráfego e avaliar a compatibilidade da versão anterior com o ledger 057; não remover o ledger nem reatribuir credenciais privilegiadas como remendo.

## Provas e limites

O gate `node test/integration/central-production-permissions/gate.cjs` cria um cluster nativo novo, escolhe uma porta loopback livre, instala as migrações e usa logins reais nos testes. Não lê URLs de ambiente da aplicação. O superutilizador só instala e prepara fixtures sintéticas. O cluster é parado no finally e o diretório de dados recém-criado é removido após verificação do caminho; ficam apenas evidências fora de `data`.

O modo normal prova upgrade 056→057 e reaplicação sem alterações. `PRODUCTION_GATE_FRESH=1` prova a cadeia completa até 057. `PRODUCTION_GATE_CALIBRATE=1` serve apenas para medir hashes em cluster descartável e não é uma prova de aceitação.

Cobertura: instalador e nomes de destino; cinco perfis reais e preflight; autoridade real e duas organizações; leitor dedicado; recusas de DML, sessões, originais, credenciais e recolha; verificação de sessão expirada/ator incorreto; criação manual/replay/rollback de auditoria; upload/preview/stage/review/aceitação PT2030/replay; scope de comandos de email; separação retenção/envio; revogação concorrente; deriva de memberships, grants e PUBLIC. O Excel de fixture é processado integralmente. Storage e scanner são doubles explícitos: não houve R2, ClamAV, emails reais, OIDC externo nem uma prova HTTP ponta a ponta contra bases tenant.

Resultados finais e hashes: [evidência da revisão](../reviews/central-production-permissions-20261115/validation.md). Não constitui aprovação de deploy, prova de carga nem validação da infraestrutura de produção.
