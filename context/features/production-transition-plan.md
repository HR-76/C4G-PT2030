# Transição para produção: plano por fases

Estado: Draft (15/11/2026). Proposta para análise; não autoriza implementação, deploy nem alterações na VPS. As decisões da fase 0 são do utilizador e ainda não foram tomadas.

Origem: análise do staging de 15/11/2026 (repositório, runbooks e sondagem só de leitura de `app-teste.c4g.ai` e `login-teste.c4g.ai`). O estado da VPS e do CI no GitHub não foi verificado diretamente.

## Princípio

A produção é um ambiente novo, instalado de raiz a partir de uma versão identificada. O staging não é promovido nem copiado: tem dados sintéticos, liga à Central como superutilizador e usa caminhos de código só de teste. O staging passa a ser o ensaio obrigatório de cada passo antes de chegar à produção.

## Decidido

- 15/11/2026: PostgreSQL de produção próprio, na VPS onde corre hoje o do staging ([decisão](../decisions/2026-11-15-production-postgresql-on-vps.md)). O Neon sai do plano.
- 15/11/2026: instância de PostgreSQL de produção separada da do staging, na mesma VPS, com contentor, volume, rede e credenciais próprios.
- 15/11/2026: API, worker, Keycloak e frontend de produção também nesta VPS. Staging e produção partilham a máquina, sem redes, volumes nem credenciais comuns.
- 15/11/2026: Keycloak de produção em instância e base próprias.
- 15/11/2026: a primeira versão sai sem os documentos das candidaturas (`DOCUMENTS_RUNTIME` não é gerado), como no staging desde [13/11/2026](../decisions/2026-11-13-staging-documents-deferred.md). As faturas PDF privadas e a importação PT2030 mantêm o R2 e o antivírus.
- 15/11/2026: na primeira versão, as oportunidades entram só por criação manual pela Administração C4G e pela importação PT2030. A recolha das fontes europeias fica desligada (`FUNDING_TENDERS_SOURCE=unconfigured`, sem worker de recolha) e é a primeira evolução depois da entrada.

## Fase 0 — Decisões

Bloqueia todas as outras. Cada decisão fica registada em `context/decisions/`.

| Decisão | Opções | Recomendação |
| --- | --- | --- |
| Fornecedor de PostgreSQL | **Decidido:** próprio, na VPS atual | — |
| Instância de PostgreSQL | **Decidido:** separada da do staging, na mesma VPS | — |
| Restantes serviços de produção | **Decidido:** na mesma VPS | — |
| Keycloak de produção | **Decidido:** instância própria, com base própria | — |
| Capacidade da VPS | **Medido a 15/11/2026:** chega | 15 GiB de memória (12 disponíveis), 4 CPU, 180 GB de disco livres; o staging inteiro usa cerca de 2,3 GiB em repouso. Sem swap e sem limites por contentor: tratar na fase 3 |
| Documentos das candidaturas | **Decidido:** fora da primeira versão | — |
| Fonte das oportunidades | **Decidido:** criação manual e PT2030 | — |
| Recolha de portugal2030.pt | Desligada; `facts`; `facts-and-summary` | No staging está `facts`. Em produção depende dos termos do site: confirmar antes de ligar |
| Primeiro cliente e data | — | Define quanto do provisionamento de tenants tem de estar pronto |
| RPO e RTO | — | Valores simples e mensuráveis (por exemplo, perda máxima de 24 h), a confirmar no ensaio da fase 3 |
| Domínios e remetente de email | — | Domínio de produção da aplicação e do login; domínio verificado no Resend |
| Responsável pela operação | — | Quem recebe alertas e quem decide um restauro |

Critério de saída: todas as linhas decididas e registadas.

## Fase 1 — Versão candidata

Objetivo: existir uma versão identificável, com o CI verde, de onde a produção se instala.

1. Commitar ou pôr de parte o trabalho pendente (44 ficheiros a 15/11, histórico de emails).
2. Tratar as falhas conhecidas das suites (3 a 5 no backend, tempo limite em `ApplicationPartners` no frontend): corrigir, ou registar cada uma com decisão explícita. Uma suite com falhas «alheias» não serve de gate.
3. Confirmar o CI verde em `staging-vps`.
4. Levar `staging-vps` para `main` (96 commits de diferença) e criar uma etiqueta de versão.
5. Validar no browser, no staging, as funcionalidades em Review que entram no âmbito e que hoje dizem «sem browser» ou «sem PostgreSQL real».
6. Congelar funcionalidades novas no ramo da versão; só correções.

Critério de saída: etiqueta em `main`, CI verde nessa etiqueta, lista de funcionalidades validadas e lista das que ficam desligadas.

## Fase 2 — Bloqueios de segurança e de dados

Tudo ensaiado no staging primeiro. Pode correr em paralelo com a fase 3.

1. **Perfil de runtime da Central.** Aprovar a matriz de leituras e escritas por capacidade, registar a migração, e medir a API e o worker com os logins limitados durante 24 h sem `permission denied` ([registo](staging-central-runtime-login.md)). A produção não arranca com `postgres`.
2. **Cabeçalhos.** Enviar `Content-Security-Policy` com `frame-ancestors`, `X-Frame-Options` e `Referrer-Policy` como cabeçalhos HTTP no proxy; a CSP em `meta` não protege contra enquadramento.
3. **Oportunidades.** Só criação manual e importação PT2030. Provar no staging o percurso completo sem recolha: criar, importar, publicar e consultar como cliente. Confirmar que o perfil de produção não gera a recolha de staging nem a etiqueta «Financiador não indicado pela fonte (recolha de staging)», e que o ecrã Fontes fica coerente com a recolha desligada. O realinhamento do escritor EU com o mapeamento v2.1 ([plano](../references/opportunity-v2/eu-writer-v2.1-reactivation.md)) passa para a fase 6.
4. **Provisionamento de entidades.** Criar uma segunda organização e tenant no staging pelo caminho que a produção vai usar, e provar a recusa de acesso cruzado entre as duas.
5. **Documentos.** Fora da primeira versão. Confirmar no staging que a interface não oferece carregamento de documentos nas candidaturas, ou que o indica como indisponível sem erro. O provisionamento do worker de documentos passa para a fase 6.
6. **Matching.** Decidir se o limite de 1000 itens do PERF-03 é aceite na primeira versão; se for, registar.
7. **Segredos.** Definir onde vivem e como rodam as credenciais de PostgreSQL, R2, Resend e Keycloak.

Critério de saída: staging a correr 24 h com logins limitados; dois tenants isolados; cabeçalhos confirmados por sondagem externa.

## Fase 3 — Operação

1. **Backups.** Correr e validar os scripts na VPS ([runbook](../runbooks/staging-backups.md)); incluir a base do Keycloak; bucket e token só para backups, com versionamento ou bloqueio de objetos; chave de cifra guardada fora do servidor.
2. **Ensaio de recuperação completo.** Num servidor limpo: restaurar Central, tenant e Keycloak, arrancar a API e entrar com uma conta. Medir o tempo e a perda de dados e comparar com o RPO e o RTO da fase 0.
3. **Monitorização.** Sonda externa do percurso essencial, alerta quando falha, e exportação das métricas para fora do processo (hoje ficam em memória). Alertas para backup em falta e disco cheio.
4. **Servidor.** Firewall ativa, SSH só com chave, atualizações de segurança automáticas, acesso de administração nominal. Como a VPS é partilhada com o staging: limites de memória por contentor (hoje nenhum tem, e sem swap um contentor do staging que esgote a memória pode derrubar os de produção), limite de ligações, alerta de disco, e nenhuma rede, volume ou credencial comum entre os dois ambientes.
5. **Rotinas.** Rotação das partições de auditoria, retenção do chat e renovação de certificados com dono e data.
6. **Incidentes.** Um runbook curto: quem é avisado, como se volta atrás, como se comunica.

Critério de saída: ensaio de recuperação dentro do RPO e do RTO; um alerta de teste recebido pelo responsável.

## Fase 4 — Montar a produção

1. **Instalador e compose de produção.** Generalizar `scripts/staging/install.js` e `deploy/staging/` para um perfil de produção, sem nomes de staging no código e sem a flag de admissão de staging. A confirmar: o que hoje está fixado a `c4g_central_staging` e ao anfitrião `c4g-postgres`.
2. **Infraestrutura.** Na VPS atual: pasta própria (por exemplo `/srv/c4g-production`), PostgreSQL de produção com TLS e sem porta publicada, rede Docker própria, DNS, Cloudflare e entradas novas no proxy.
3. **Identidade.** Keycloak de produção em instância e base próprias, com a mesma versão já ensaiada no staging; realm de produção com os módulos de ativação e de email, política de palavras-passe e MFA opcional; nenhuma conta de teste.
4. **Serviços externos.** Buckets R2 de produção na UE, domínio verificado no Resend, antivírus.
5. **Instalação de raiz** a partir da etiqueta da fase 1, com os logins limitados da fase 2 desde o primeiro arranque.
6. **Backups e monitorização** da fase 3 ligados antes de entrar o primeiro dado real.

Critério de saída: `/health/ready` com 200, login completo, backups a correr, nenhum dado ou credencial vindo do staging.

## Fase 5 — Ensaio geral e piloto

1. Percurso completo por perfil (Admin C4G, Administrador, Gestor, Técnico, Consulta) e recusa de acesso cruzado.
2. Ensaio de atualização e de regresso: aplicar uma release nova e voltar atrás. As migrações são irreversíveis, por isso o regresso real é o restauro; cada release declara se a anterior ainda arranca.
3. Requisitos legais: política de privacidade e termos na aplicação, registo de subcontratantes (Cloudflare, Resend, alojamento), prazos de retenção e autorização para a recolha de portugal2030.pt.
4. Lista de verificação de entrada em produção, assinada por quem decide.
5. Piloto com a primeira entidade, com acompanhamento diário e critério de paragem definido.

Critério de saída: lista de verificação completa e período de piloto sem incidentes graves.

## Fase 6 — Depois da entrada

- Regime de releases: tudo passa pelo staging, com etiqueta, CI verde e cópia das bases antes de cada migração.
- Iniciar a [medição de 30 dias](baseline-metas-30-dias.md) com dados reais.
- Retomar o que ficou fora do âmbito, por esta ordem: recolha das fontes europeias com o escritor EU e revisão humana, documentos das candidaturas, PERF-03.

## Dependências

- A fase 0 bloqueia tudo.
- As fases 1, 2 e 3 podem correr em paralelo.
- A fase 4 precisa da etiqueta (1), dos logins limitados (2) e dos backups e da monitorização (3).
- A fase 5 precisa da fase 4 completa.

## Fora deste plano

Migração de dados do staging (não há: são sintéticos), integração da UBI como tenant, instalações dedicadas e fornecedor fiscal de faturação.
