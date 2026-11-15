# Produção 057: paragem, recuperação e rollback

Estado: preparado para revisão em 15/11/2026; **não executado nem ensaiado na infraestrutura de produção**. Base analisada: `6e0b8942c5bad38efddfbe1977b2a37ac23898d3`. Âmbito: instâncias PostgreSQL e Keycloak próprias na VPS atual, com recursos separados do staging, conforme a [decisão de alojamento](../decisions/2026-11-15-production-postgresql-on-vps.md).

Este procedimento não autoriza alterações no staging, restauração de dados ou corte de tráfego. A execução futura depende de release, alvos e checkpoint identificados. A prova PostgreSQL descartável da 057 valida instalação e permissões; não prova recuperação completa de Central, tenants, identidade e objetos.

## 1. O que significa voltar atrás

`057_production_central_permissions` é irreversível no manifest. Não existe migração down aprovada. O instalador exige a baseline genérica 056 ou a própria 057 e valida o schema antes de agir; não é um bootstrap da infraestrutura ou de uma Central vazia.

| Situação observada | Resposta preparada |
|---|---|
| Falha antes de aplicar 057 | Manter o tráfego fechado. Corrigir o pré-requisito e repetir a verificação; não há schema 057 a desfazer. |
| Falha dentro da transação de migração | Confirmar o ledger e schema efetivos. O runner executa a migração e o registo em transação; a mensagem de erro do processo, por si só, não confirma o estado após uma interrupção. |
| 057 aplicada, mas provisionamento dos logins falhou | Manter 057 e a produção fechada. O instalador aplica a migração antes da transação dos seis logins; o rollback destes não desfaz a migração já committed. Inventariar o estado e corrigir o provisionamento numa execução revista. Não apagar logins, ledger ou grants para conseguir repetir o comando. |
| Primeira entrada, sem dados reais nem tráfego admitido | Continuar em manutenção. Reparar sobre 057 ou preparar outra instância nova a partir do checkpoint. Preservar a instância falhada até fechar a análise. Não existe release anterior de produção para a qual encaminhar clientes. |
| Falha da aplicação após um upgrade, com 057 íntegra | Preferir uma correção compatível com 057. Só regressar a uma imagem anterior se essa imagem e os seus logins limitados tiverem sido previamente testados contra o schema e fingerprints 057. |
| Recuperação de dados necessária ou imagem anterior incompatível | Restaurar um checkpoint coerente numa **nova instância isolada**, validar todo o percurso e só então fazer o corte de produção. Não restaurar por cima da origem. |

O commit anterior `736e3a5` não constitui um rollback de aplicação aprovado: a sua compatibilidade com 057 não foi demonstrada. Mudar apenas a imagem, retirar `CENTRAL_RUNTIME_PROFILE` ou montar credenciais privilegiadas pode quebrar a admissão ou reintroduzir o problema que a 057 resolve. O `postgres` temporário de instalação nunca passa a utilizador da API ou dos jobs.

## 2. Checkpoint obrigatório antes da janela

Usar a pasta de produção `/srv/c4g-production`, configuração privada e namespace de backups próprios. Os caminhos abaixo são a convenção proposta; confirmar que não existem colisões na VPS antes de os provisionar. Nenhum caminho, rede, volume, bucket de backups ou ficheiro de segredos é reutilizado do staging.

O compose de aplicação preparado é `deploy/production/compose.yaml`, projeto `c4g-production-app`, com `pod`, `api` e `clamav`; os perfis `maintenance` e `retention` controlam o migrador e o job de retenção. Usa as redes externas exclusivamente produtivas `c4g-production-data` e `c4g-production-identity`, e configuração versionada em `/srv/c4g-production/config/<CONFIG_ID>`. A porta de API proposta é `127.0.0.1:8600`; confirmar que está livre antes do primeiro arranque. PostgreSQL e Keycloak de produção não são provisionados por esse compose e têm inventário/paragem próprios. O proxy comum da VPS não deve ser reiniciado ou reconfigurado de forma a afetar staging.

| Elemento do checkpoint | Evidência a conservar |
|---|---|
| Release | SHA completo, digests das imagens API/frontend/Keycloak/PostgreSQL, checksums de ficheiros de configuração sem valores secretos, versão das extensões e providers Keycloak. Não usar `latest` como identidade de rollback. |
| Central | Cópia recuperável, ledger/checksums, schema e fingerprints de segurança, contagens de controlo, identidade do cluster/base. Registar a variante exata: o pacote preparado cobre 056/057 genéricos. |
| Todos os tenants ativos | Inventário completo e cópia de cada base, versão/schema, tenant ID, geração de base, bindings e diretório Central correspondentes. Uma cópia apenas da Central não é um checkpoint funcional. |
| Papéis e permissões PostgreSQL | Owners, ACLs, memberships com opções INHERIT/SET/ADMIN e demais definições necessárias ao restauro. Material que inclua credenciais/verificadores de passwords fica cifrado e fora dos logs. O restauro não pode substituir owners e ACLs por um proprietário genérico e continuar a declarar os fingerprints válidos. |
| Keycloak | Cópia da base própria, realm, clients, providers, versão e configuração da instância. Não reutilizar contas nem a base de staging. |
| Objetos R2 | Inventário e disponibilidade dos originais PT2030 e PDFs de faturação referenciados no checkpoint, com versões/digests quando disponíveis, política que os retenha durante a janela e permissões de recuperação separadas. Não pressupor que o dump SQL inclui os objetos. |
| Operação | Configuração cifrada, referências às versões dos segredos, chave de recuperação guardada fora da VPS, configuração de proxy/DNS/certificados, inventário de serviços, jobs e timers de produção. |
| Verificação | Identificador único do checkpoint, instantes UTC de início/fim, hashes e tamanhos, localização da cópia fora da VPS, resultado do restauro de ensaio e tempo medido. |

Proposta de localização privada: `/srv/c4g-production/backup/checkpoints/<checkpoint-id>/`. A cópia externa deve ter namespace e credencial próprios, e a chave de recuperação não pode existir apenas na VPS. RPO, RTO, retenção e responsável operacional continuam por confirmar; nenhum valor foi assumido neste plano.

O [runbook de backups do staging](staging-backups.md) é apenas referência de implementação. Os seus scripts usam alvos e namespace de staging, não incluem a base Keycloak e partilham o bucket/token de documentos. **Não os executar com valores de produção nem apresentá-los como solução de backup produtiva.** Falta preparar e ensaiar o mecanismo completo de produção.

## 3. Criar um ponto de recuperação coerente

1. Confirmar a janela, o responsável pela decisão e os valores RPO/RTO. Registar o checkpoint e a lista exaustiva de bases e serviços de produção. Confirmar que nenhum alvo resolve para os recursos do staging.
2. Colocar apenas os domínios de produção em manutenção no proxy. Guardar a configuração anterior para eventual retorno do proxy. Não mudar rotas, certificados ou upstreams de staging.
3. Parar os produtores de trabalho: provisionamento, imports, jobs de retenção, worker de envio de faturação, convites/identidade, agendamentos e quaisquer integrações que possam escrever. A primeira release não deve ter worker de recolha EU nem de documentos de candidaturas.
4. Drenar apenas `api` do projeto `c4g-production-app` pelo seu shutdown normal; confirmar ausência de pedidos, transações e jobs ativos. Não considerar um simples 503 do proxy como prova de paragem dos escritores internos. Não recriar `pod`/`clamav` para uma troca normal de imagem da API: partilham namespace de rede e a sua recriação precisa de coordenação própria.
5. Impedir novas mutações no Keycloak de produção, incluindo registo e recuperação de passwords, enquanto se fecha o checkpoint de identidade. Usar o procedimento de paragem da instância própria; não reiniciar o Keycloak do staging.
6. Capturar as bases, papéis, configuração e inventário de objetos com os escritores parados. Se não for possível obter essa janela, exigir um mecanismo alternativo de consistência e um ensaio específico; dumps independentes tomados durante escrita não demonstram um checkpoint coerente.
7. Verificar hashes e recuperação a partir da cópia externa. Proteger o checkpoint contra a rotina normal de expiração durante a janela. Registar o último evento/operação de negócio confirmados antes da paragem.

Não se apagam volumes ou objetos durante esta sequência. Não se executam `docker compose down -v`, `docker system prune`, `DROP DATABASE`, limpeza do ledger ou alteração ad hoc de ACLs como medida de rollback.

## 4. Distinguir falha de migração e falha de deploy

Inspecionar apenas a instância de produção previamente identificada com uma ligação operacional privada. Esta consulta não contém segredos e pode constar da evidência:

```sql
SELECT version, checksum_sha256, irreversible, applied_at
FROM public.c4g_schema_migration
WHERE version IN ('056_email_delivery_history', '057_production_central_permissions')
ORDER BY version;
```

Comparar 057 com `backend/src/security/productionCentralMigrationPackage.js`: checksum `9ed39c76da6261753f0bfce22bb90b713bb499fa2b2e46e6ca85e766527b17a2`, schema fingerprint `8076e82b5c95658571cd331503b2b7af27ddcff4af1a75b5d3f1005bf2536dfe` e production security fingerprint `7863be506cb4637c31df92fc4d714f05b4be6ea14d0f8e0aeb47886cde6e424a`. A consulta do ledger não substitui o preflight que recolhe e compara o schema real.

Confirmar os seis logins, a autoridade existente e respetivos atributos/ACLs. O instalador recusa logins já existentes; isso não autoriza recriá-los ou rodar passwords silenciosamente. Distinguir uma tentativa parcialmente concluída de uma instalação anterior válida antes de preparar a recuperação. O erro genérico `PRODUCTION_INSTALL_FAILED` não deve ser tratado como confirmação de que nada mudou.

Se ledger e preflight estiverem corretos, recolher o erro sanitizado da prontidão e da aplicação. Corrigir imagem/configuração/perfis mantendo a base 057 é normalmente a opção que preserva mais dados. Não desativar o preflight para abrir o tráfego.

## 5. Restauro numa nova instância

1. Preservar a origem falhada, logs sanitizados e uma cópia pós-incidente; manter o tráfego e os produtores parados. Registar operações posteriores ao checkpoint e efeitos externos, nomeadamente emails enviados e ficheiros adicionados.
2. Provisionar um destino de recuperação com identidade única, por exemplo projeto `c4g-production-recovery-<incidente>` e pasta `/srv/c4g-production/recovery/<incidente>`, com redes, volumes e credenciais novos. Estes nomes são propostas; verificar os nomes finais antes da execução. Não ligar o destino à rede de staging nem publicar PostgreSQL na Internet.
3. Descarregar e verificar o checkpoint externo; restaurar a Central, todos os tenants e Keycloak pelo método previamente ensaiado, com versões compatíveis e ACLs/owners preservados. A preparação atual não fornece um comando genérico de restauro executável: os scripts de produção completos e o respetivo ensaio são pré-requisitos.
4. Verificar ledger, schema, fingerprints, roles/memberships, auditoria e contagens. O teste de restauro antigo que cria apenas papéis NOLOGIN e compara tabelas/eventos não valida o perfil 057 nem os logins produtivos.
5. Validar as identidades restauradas e os bindings de cada tenant. O código compara geração, `systemIdentifier` e `bindingDigest`; mudar cluster ou endpoints pode exigir publicação de novos bindings pelo procedimento confiável de provisionamento. Não editar estes valores para contornar uma recusa, e não transportar cegamente o estado do diretório antigo.
6. Resolver a correspondência entre os objetos R2 e as referências restauradas. Conservar objetos posteriores ao checkpoint como evidência; não os eliminar porque deixaram de aparecer numa base restaurada.
7. Configurar a imagem escolhida e os novos URLs privados. Repetir prontidão com cada login limitado, OIDC real numa instância de identidade isolada, testes por perfil e recusa de acesso cruzado entre tenants. Desativar envios reais e produtores durante o ensaio; não repetir um email já enviado por causa de um recibo que desapareceu no restauro.
8. Comparar o tempo efetivo e a perda de operações com o RTO/RPO acordados. Apresentar a lista de operações a recuperar/reconciliar e o risco residual antes de decidir o corte. Um restauro tecnicamente bem-sucedido não autoriza perda de dados silenciosa.

## 6. Reabrir produção e fechar o incidente

O decisor nomeado confirma o checkpoint, a release/imagens, as verificações funcionais e qualquer perda de dados ou reconciliação pendente. Só depois atualizar os endpoints e upstreams de **produção** para o destino validado. A mudança de host/base exige que todos os pools da API continuem ligados à mesma Central, com seis credenciais distintas e `c4g_authority_runtime` na autoridade.

Reabrir primeiro a API e confirmar `/health/ready`, login, membership, catálogo, consulta administrativa e uma operação controlada por tenant. Reativar produtores um a um, começando pelos necessários ao serviço, com deduplicação/recibos reconciliados. Reativar backups e alertas no destino novo antes de considerar a recuperação concluída. A retenção SQL e a limpeza Keycloak são componentes distintos; verificar ambos.

Conservar a origem e checkpoints durante o prazo definido pelo responsável. A remoção dos recursos antigos é uma ação posterior, com alvos explicitamente verificados e autorização própria. Registar instantes, versão de cada componente, decisão, impacto, RPO/RTO medidos, pendências e prova de que os recursos do staging não foram modificados.

## 7. Critério para aceitar este plano como ensaiado

- Release identificada e compatibilidade da imagem de regresso medida; na primeira entrada, manutenção e recuperação de raiz assumidas explicitamente.
- Backup externo completo inclui Central, todos os tenants, papéis, Keycloak, configuração e objetos referenciados.
- Restauro num destino limpo reproduz login, acesso por perfil, isolamento e uma operação funcional com logins sem superutilizador.
- Falha após commit da migração e antes do provisionamento dos logins foi simulada e diagnosticada sem apagar ledger/grants.
- Regresso de aplicação foi testado apenas com uma imagem comprovadamente compatível com 057; restauro coerente cobre o caso incompatível.
- RPO, RTO, responsável, decisão de corte e processo de reconciliação estão preenchidos; produtores e efeitos externos foram considerados.
- Nenhuma etapa do ensaio modifica staging, usa segredos de staging ou reutiliza os seus volumes/redes.

Até estes critérios terem evidência, o plano está preparado, mas a recuperação produtiva permanece por validar.
