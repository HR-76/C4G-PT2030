# Staging completo: o que falta

Estado: avaliação de 12/11/2026, pedida pelo utilizador. Só leitura do código e dos documentos; nada foi alterado na VPS. Complementa [staging-vps-deployment.md](staging-vps-deployment.md) e [staging-opportunity-collection.md](staging-opportunity-collection.md). Os pontos marcados **por verificar** não foram confirmados no código nem na VPS.

## Já a funcionar (verificado em sessões anteriores)

Início de sessão OIDC com Keycloak (`login-teste.c4g.ai`), três contas, Dashboard e Catálogo vazios, esquemas Central 050 e tenant 040, página Fontes de oportunidades, fila `pg-boss`.

## Lacunas, por prioridade

### P0. Concluir a recolha de oportunidades (código pronto, falta publicar)
- Publicar os commits locais e reconstruir a imagem; regerar o ambiente com `--collection all`; arrancar o worker; recolha real com autorização expressa.
- Fontes CORDIS, Erasmus+, Interreg Europe e POCTEP estão desligadas em staging pela política de aprovação. Para as testar é preciso uma aprovação própria («fontes oficiais») e mais chamadas externas. **Decisão do utilizador.**
- Recolha diária (04:00): `FUNDING_TENDERS_SCHEDULE=daily-v1` mais a conta de serviço (`fundingServiceAccount.js --apply`), desligada por omissão. Só depois de a recolha manual estar validada.

### P1. Cloudflare R2 e ClamAV (desbloqueia três funcionalidades)
Precisam do mesmo par, R2 privado na jurisdição UE mais ClamAV:
- **Documentos das candidaturas** (`DOCUMENTS_RUNTIME=f11-r2`, API e worker de documentos, instalação da fila de documentos): variáveis `C4G_R2_ENDPOINT` (formato `https://<conta>.eu.r2.cloudflarestorage.com`), `C4G_R2_DOCUMENTS_BUCKET`, `C4G_R2_QUARANTINE_BUCKET` (dois buckets distintos), `C4G_R2_ACCESS_KEY_ID`, `C4G_R2_SECRET_ACCESS_KEY`, `C4G_CLAMAV_HOST`, `C4G_CLAMAV_PORT`. O diagnóstico do código lista como pendentes a verificação de acesso privado, a «camada C» do R2 e o scanner; o ClamAV só é aceite em `127.0.0.1` ou `::1`, por isso tem de partilhar a rede do contentor da API e do worker.
- **PDFs de faturação** (`BILLING_PDF_RUNTIME=private`; Central 050 já aplicada): [runbook](../runbooks/billing-private-pdfs.md).
- **Carregamento central PT2030** (`CENTRAL_PT2030_IMPORT_RUNTIME=preview`; Central 049 já aplicada): [runbook](../runbooks/central-import-upload-preview.md).
- **Implementado (12/11/2026), por implantar:** serviço `clamav` no compose (perfil `storage`, partilha a rede da API para escutar em loopback), `env --storage <ficheiro>` que valida os valores R2 com o carregador do próprio runtime e liga `BILLING_PDF_RUNTIME=private` e `CENTRAL_PT2030_IMPORT_RUNTIME=preview`, e `storage-check` (HEAD dos dois buckets e PING ao antivírus, só booleanos). Testes: ficheiro incompleto, desconhecido, duplicado, não-UE, buckets iguais ou sem declaração são recusados sem expor valores; as variáveis geradas são aceites pelos dois runtimes. Runbook em [deploy/staging/README.md](../../deploy/staging/README.md).
- **Limite:** o runtime só constrói o armazenamento com `C4G_R2_LAYER_C_VALIDATED=true`, uma declaração do operador. O `storage-check` prova credenciais, buckets e antivírus, não a escrita condicional nem ficheiros grandes (`C4G_R2_MULTIPART_CONDITIONAL_VALIDATED` fica desligado). A validação funcional completa é o primeiro carregamento real. Nunca testado contra um R2 real; nem o ClamAV nem o compose foram executados aqui (sem Docker nesta máquina).
- **Ensaio real (12/11/2026):** R2 e ClamAV ligados na VPS (`storage-check` com `r2` e `scanner` verdadeiros; API estável depois de corrigido o desenho de rede, ver `pod` no compose). O carregamento de um Excel PT2030 e a pré-visualização funcionam, o que prova o envio real ao R2, o antivírus e a releitura verificada para um ficheiro pequeno. **Limite do produto, não da configuração:** o percurso central é só pré-visualização (sem stage, confirmação nem publicação, por contrato em [central-import-upload-preview.md](central-import-upload-preview.md)); o utilizador viu que os dados não ficam persistidos nas oportunidades nem no Catálogo. As 178 oportunidades do ambiente local entraram por outro caminho (cópia isolada de evidência arquivada com adaptadores v2, ver [catalog-real-data-isolated.md](catalog-real-data-isolated.md)), não por este carregamento. Levar o PT2030 ao Catálogo exigia funcionalidade nova, entretanto **implementada** (gravar, rever e aceitar as novas, sem migração): ver [pt2030-central-import-to-catalog.md](pt2030-central-import-to-catalog.md). Falta implantar (imagem nova, `env --storage` e recriar a API).
- **Fora deste passo:** documentos das candidaturas (`DOCUMENTS_RUNTIME=f11-r2`) exigem ainda fila de documentos, worker próprio e perfis de base de dados dedicados (`provisionDocumentApiProfile.js`, `provisionDocumentQueueProfile.js`); nunca foram provisionados nem no ambiente local. Passo seguinte, a especificar.
- Trabalho teu: criar a conta/buckets R2 e as chaves de API na Cloudflare e colocá-las no ficheiro privado da VPS (não as colo no chat).

### P2. E-mail (três coisas distintas)
1. **Convite e ativação de membros** (Resend). O worker `platformOnboarding/memberWorker.js` usa `RESEND_API_KEY`, `ACTIVATION_EMAIL_FROM`, `ACTIVATION_PUBLIC_URL`, mas está fixado a um Keycloak **local**: recusa um emissor que não seja `https://localhost:8443` ou `:8283` (`LOCAL_IDENTITY_REQUIRED`). Para staging é preciso **código novo**: suportar o Keycloak de staging, com cliente de conta de serviço, e contrato escrito antes.
2. **E-mails de mudança de estado da candidatura.** A [prontidão](application-status-emails-readiness.md) diz «validado em simulação isolada; não pronto para ativação real»: falta compor e validar o percurso produtivo. É desenvolvimento, não só configuração.
3. **E-mails do próprio Keycloak** (verificação de e-mail, recuperação de palavra-passe): exigem SMTP no realm `c4g-staging` (`OIDC_EMAIL_VERIFICATION=keycloak-account-v1`). **Por verificar** como o realm está hoje.
- Para qualquer envio: domínio verificado no Resend (registos SPF/DKIM na Cloudflare) e chave de API. Em staging, enviar só para endereços de teste.

### P3. Funcionalidades ainda desligadas por seleção explícita (por verificar o que dependem)
`PROFILE_EDITORIAL_RUNTIME=f13-editorial` e `PQ1_ACTIVATION_RUNTIME=f13-f14-pq1` (perfil editorial e pré-qualificação), `OPPORTUNITY_IMPORTS_RUNTIME=f12-xlsx` (importação Excel de oportunidades; exige processo próprio, diferente do worker de recolha), `CATALOG_READ_RUNTIME=controlled` (leitor unificado do catálogo), `PLATFORM_ACCESS_RUNTIME=central`. Preciso de confirmar, página a página no frontend, quais destas estão em falta no staging atual antes de as ligar.

### P4. Operação
- **Partições de auditoria:** a partir de 2026-12-01 os eventos vão para a partição `DEFAULT` sem a [rotação mensal](../runbooks/audit-partition-rotation.md). Convém agendar antes dessa data.
- Retenção do chat (`CHAT_RETENTION_CREDENTIALS_JSON`, [runbook](../runbooks/chat-retention.md)).
- Cópias de segurança com política e teste de restauro; monitorização; firewall (`ufw` inativo) e SSH por endurecer.
- Código do perfil Neon só existe na VPS (`api-release-0715f01`): preservar no Git ou descartar por decisão.
- Contas: palavra-passe do `admin-staging` sem confirmação; conta `tecnico-staging` por confirmar.

## O que fica fora do staging por decisão
Escritor EU v2 com revisão humana, perfil de runtime de Central sem superutilizador, alojamento definitivo do PostgreSQL de produção: são desenho de produção ([staging só para testar](../decisions/2026-11-12-staging-postgresql-on-vps.md)).

## Ordem proposta
1. P0: publicar, implantar, primeira recolha real.
2. P1: R2 e ClamAV (um passo desbloqueia documentos, faturação e PT2030).
3. P2.3 e P2.1 conforme a prioridade do utilizador; P2.2 é a maior.
4. P4 antes de 1 de dezembro (auditoria) e P3 após levantamento por página.

## Decisões pedidas ao utilizador
- Criar o R2 (UE) agora? Nomes de buckets e conta.
- Domínio e remetente de e-mail de staging; quais dos três e-mails são necessários neste staging.
- Incluir as fontes oficiais (CORDIS, Erasmus+, Interreg, POCTEP) no teste?
