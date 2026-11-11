# Pesquisa — contrato consolidado de autorização funcional F5

## Estado e decisão em análise

Este documento consolida F5-D1–F5-D17 num único contrato recomendado. É pesquisa arquitetural: as recomendações são **propostas, ainda não aprovadas**. Não altera o estado `Draft` da F5, não autoriza implementação, migrations, rollout, F4.4 ou F4.5.

## 1. Factos vinculativos do projeto

O repositório já determina:

- `deny-by-default`; só grants positivos no MVP, sem `DENY` funcional;
- sessão F2, utilizador ativo, organização ativa, membership F3 ativa e contexto selecionado são gates prévios para sujeitos humanos;
- `baseRoleCode` existe no contexto F3, mas não é interpretado por controllers;
- permission codes são estáveis/versionados; perfis são conjuntos de permissions, não decisões finais;
- organização, unidade, equipa e recurso são scopes admitidos; herança só pode ser explícita;
- estado/relação do recurso, MFA, aprovação e separação de funções são requisitos adicionais, não grants negativos;
- enforcement ocorre no servidor; frontend, token, caller e roles PostgreSQL não decidem autorização;
- MFA/step-up pertence ao Keycloak e à evidência F2 (`auth_time`, `acr`, `amr`, versão);
- suporte C4G só existe por concessão explícita, temporária, limitada, aprovada, com MFA e auditoria;
- F4 resolve tenant e schema, mas não concede permissão funcional; não existe fallback Legacy/UBI;
- API, jobs, reporting, exports e documentos têm de usar a mesma política;
- auditoria futura é append-only, mas F5 pode emitir eventos sanitizados através de um port/double;
- a implementação atual `authorizeRoles("ADMIN")`, `ADMIN`/`PROFESSOR`, `platformRoles` e checks dispersos é apenas comportamento Legacy a substituir.

## 2. Evidência externa usada

Foi usada apenas para confirmar pontos não específicos do produto:

- OWASP exige autorização ao nível do objeto em toda função que aceda a dados por um ID recebido e alerta que comparar apenas um user ID ou usar UUIDs não resolve BOLA. Isto sustenta carregar o recurso pelo repository interno e autorizar sobre os seus atributos, não sobre ownership fornecido pelo caller ([OWASP API1:2023](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization/)).
- OWASP recomenda enforcement próximo do recurso, `deny-by-default` e validação em cada pedido; separar decisão de enforcement não retira responsabilidade ao ponto que executa a operação ([OWASP Authorization Patterns](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Patterns_Cheat_Sheet.html)).
- NIST descreve ABAC como avaliação de atributos do sujeito, objeto, operação e ambiente contra políticas/relações. O modelo híbrido recomendado — perfil/grants mais atributos de scope, recurso, estado e assurance — é uma aplicação adequada desse princípio, não adoção de um motor externo ([NIST SP 800-162](https://www.nist.gov/publications/guide-attribute-based-access-control-abac-definition-and-considerations-0)).
- NIST trata separação de funções e menor privilégio como controlos organizacionais explícitos; isso sustenta uma matriz versionada de incompatibilidades, não inferência por labels ([NIST SP 800-53 Rev. 5.1](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)).
- Keycloak suporta step-up por ACR/LoA e `max_age`; a aplicação continua obrigada a verificar o ACR obtido. O projeto já fixa adicionalmente AMR, `auth_time` e versão reconhecida ([Keycloak Server Administration Guide](https://www.keycloak.org/docs/latest/server_admin/)).
- NIST SP 800-63B-4 exige limites definidos de reautenticação para AAL2 e reconhece reautenticação como extensão controlada da sessão. Não fixa o valor de risco específico da C4G; o valor de cinco minutos abaixo deriva da política F2 já implementada, não do NIST ([NIST SP 800-63B-4 — AAL2](https://pages.nist.gov/800-63-4/sp800-63b/aal/), [Session Management](https://pages.nist.gov/800-63-4/sp800-63b/session/)).

## 3. A. Contrato recomendado

### 3.1 Fluxo único de decisão

Todos os canais usam o mesmo `AuthorizationService`. O adaptador interno regista uma `operationCode` constante; o catálogo mapeia-a para uma `permissionCode`, tipo de recurso, scopes admitidos, regra de herança, requisitos de estado/relação, categoria de assurance, SoD e evento de auditoria.

Ordem normativa proposta:

1. validar catálogo/policy/versionamento no startup;
2. autenticar ator e validar sessão/identidade de serviço;
3. para humano, revalidar utilizador, organização, membership e contexto F3;
4. resolver operação apenas pelo adaptador interno;
5. verificar se o perfil/grants positivos fornecem a permission candidata;
6. carregar o recurso por repository interno limitado à organização validada;
7. comparar organização e avaliar scope, herança, participação/propriedade e estado do recurso;
8. avaliar SoD/aprovação e assurance/MFA recente;
9. emitir decisão imutável `{allowed, reasonCode, policyVersion, catalogVersion, authorizationVersion}`;
10. emitir evento allowlisted quando obrigatório;
11. só então executar o efeito, no mesmo contexto/lease; qualquer mismatch ou falha recusa.

Não existe `allow` parcial, fallback, first-match permissivo, SQL genérico, permission escolhida pelo caller ou união entre organizações.

### 3.2 Modelo recomendado

- **PAP:** catálogo/versionamento em código e, futuramente, perfis/grants administráveis por contrato tipado.
- **PDP:** `AuthorizationService`, puro/determinístico sobre snapshot validado.
- **PIP:** repositories internos de membership, perfil, grants, unidade/equipa, recurso, suporte e assurance.
- **PEP:** cada route/service/job/export/report/document adapter; nunca a UI.
- **Audit port:** recebe evento sanitizado; double local em F5, storage definitivo posterior.

### 3.3 Perfis e grants

Perfis base são templates C4G imutáveis e versionados, selecionados pela membership. No bootstrap produtivo recomendado, os quatro perfis têm conjunto vazio e concedem zero acesso funcional. Numa versão futura, um perfil poderá referenciar apenas permission codes publicadas nessa mesma versão; não cria linhas de grant por utilizador. Grants positivos adicionais só poderão referenciar permissions produtivas publicadas e serão registos diretos e temporais para sujeito `MEMBERSHIP`, `UNIT` ou `TEAM`, com permission e scope explícitos. `BASE_PROFILE` é fonte calculada, não grant editável.

A autorização acumula permissions positivas aplicáveis e depois aplica todos os gates obrigatórios. Como não há `DENY`, conflitos não são resolvidos por prioridade de grant: contexto inválido, scope insuficiente, estado/relação, SoD, aprovação ou MFA recusam sempre, mesmo existindo permission positiva.

### 3.4 Scopes e herança

Scopes fechados:

- `ORGANIZATION`: todos os recursos daquele tipo dentro da organização;
- `UNIT`: unidade exata;
- `UNIT_SUBTREE`: unidade e descendentes, apenas se a permission declarar `unitHierarchy=true`;
- `TEAM`: equipa exata e ativa; equipa não herda de unidade;
- `RESOURCE`: par exato `resourceType + resourceId`, sempre resolvido internamente.

Não existe scope global para dados tenant. Privilégios centrais C4G usam operações/plataforma separadas. Um grant mais amplo não contorna estado, relação, SoD ou assurance. Recursos com múltiplas relações são autorizados se pelo menos um scope positivo aplicável satisfizer a regra declarada; a relação usada entra na decisão/auditoria.

### 3.5 Revogação e cache

Primeira versão F5: **não guardar decisões `allow` nem snapshots mutáveis de grants/perfis em cache** (`TTL = 0`). O catálogo imutável validado pode permanecer em memória durante a vida do processo, identificado por `catalogVersion` e hash. Cada decisão humana revalida F3 e lê o `authorizationVersion` local corrente; alterações de perfil, grant, hierarquia, equipa ou suporte incrementam essa versão na mesma transação futura.

Esta escolha remove o conflito entre cache local e “revogação efetiva no pedido seguinte”. Cache distribuído fica adiado e exigirá ADR com chave mínima `(organizationId, actorType, actorId, membershipVersion, authorizationVersion, catalogVersion, policyVersion, operationCode, resourceType, resourceId/scopeDigest)`, invalidação multi-processo e testes. Métricas nunca usam tenant, utilizador ou recurso como label.

### 3.6 Jobs e canais não HTTP

- Job iniciado por humano conserva `organizationId`, `membershipId`, `membershipVersion`, `globalUserId`, operação interna, resource reference, correlation/causation e idempotency key; revalida membership e autorização no início de cada tentativa.
- Job estritamente sistémico usa `SERVICE` registado, organização fixa e allowlist mínima de operações; nunca inventa membership humana. Quando deriva de ação humana conserva também o ator originador.
- Retry/replay nunca amplia permission/scope e volta a resolver recurso/policy corrente. Suspensão/offboarding bloqueia jobs funcionais; só operações operacionais separadas e allowlisted podem continuar.
- API, export, report e documento usam a mesma decisão. Export guarda filtros/scope autorizados e revalida antes de gerar e antes de emitir acesso; documento autoriza metadata e objeto carregados internamente.

## 4. B. Matriz F5-D1–F5-D17

Todas as redações desta matriz são propostas.

### Bloco 1 — catálogo de permissões e perfis

#### F5-D1 — Catálogo inicial de permission codes

- **Pergunta:** qual formato, conteúdo e evolução do catálogo?
- **Alternativas viáveis:** bootstrap produtivo vazio; catálogo produtivo mínimo apenas se existirem operações funcionais já aprovadas de ponta a ponta.
- **Recomendação:** **Opção 1 — catálogo produtivo bootstrap vazio**, imutável por release e validado no startup. Não existem permission codes produtivas F5 v1. O mecanismo usa apenas permissions sintéticas em testes, obedecendo ao formato ASCII `^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$` (`resource.action`) e sem wildcard. Cada feature funcional futura adiciona operações e permissions na sua própria versão de catálogo, depois de aprovar recurso, ação, scopes, estados, adapter, schemas e testes.
- **Fundamento:** as features atuais descrevem capacidades, mas não definem ainda uma superfície executável completa por operação; não existe schema tenant funcional, query module produtivo ou endpoint F5. F4.3 fixa `tenant-read-only-bootstrap-v1` com `operations: []` e proíbe fallback Legacy/UBI.
- **Segurança:** evita string livre, typo permissivo e autorização pelo caller.
- **Implementação:** manifest produtivo congelado com version/hash e `permissions: []`; fixtures separadas fornecem catálogo sintético apenas à suite.
- **Risco residual:** catálogo incompleto bloqueia funcionalidade; é falha segura.
- **Dependências:** nenhuma externa.
- **Adiamento:** toda permission produtiva é adiada para a feature funcional correspondente; o engine e contrato estrutural não.
- **Redação proposta:** “F5 v1 publica catálogo produtivo vazio. Permissions sintéticas de teste seguem `resource.action`, são únicas, imutáveis por versão e sem wildcard. Operações produtivas só entram por versão posterior aprovada pela respetiva feature.”

#### F5-D2 — Perfis base

- **Pergunta:** que perfis existem e como concedem permissions?
- **Alternativas viáveis:** templates C4G rígidos/versionados; perfis locais livres baseados no mesmo catálogo.
- **Recomendação:** quatro templates estruturais versionados — `ORG_ADMIN`, `FUNDING_MANAGER`, `CONTRIBUTOR`, `VIEWER`; membership seleciona um template, mas no bootstrap todos referenciam o conjunto produtivo vazio. Perfil vazio é válido e concede zero permissions. Perfis sintéticos separados recebem permissions sintéticas nos testes. Custom profiles ficam posteriores.
- **Fundamento:** produto já define quatro papéis organizacionais funcionais; “professor” não é universal.
- **Segurança:** baseline pequeno, auditável, sem privilégios ocultos.
- **Implementação:** manifest `base-profile-catalog-v1`; labels localizáveis separadas do code.
- **Risco residual:** nenhum acesso funcional produtivo existe até uma feature posterior publicar catálogo e nova versão dos perfis; é bloqueio deliberado e seguro.
- **Dependências:** F5-D1 e aprovação da matriz perfil/permission.
- **Adiamento:** custom profiles sim; quatro templates não.
- **Redação proposta:** “Perfis base são templates C4G imutáveis/versionados escolhidos por membership. No bootstrap, todos são vazios e concedem zero acesso produtivo; permissions futuras exigem nova versão explícita do catálogo e dos perfis.”

### Bloco 2 — scopes, grants, herança e precedência

#### F5-D3 — Scopes e herança

- **Pergunta:** que scopes existem e como se propagam?
- **Alternativas viáveis:** scopes exatos sem hierarquia; hierarquia declarada por permission.
- **Recomendação:** `ORGANIZATION`, `UNIT`, `UNIT_SUBTREE`, `TEAM`, `RESOURCE`; subtree só quando metadata da permission permite; equipa nunca herda de unidade; resource é exato.
- **Fundamento:** arquitetura admite organização/unidade/equipa/recurso e exige herança explícita.
- **Segurança:** reduz privilégio transitivo e contém reorganizações.
- **Implementação:** scope union tipada; repository resolve paths/equipas e recurso real.
- **Risco residual:** custo de consulta da hierarquia sem cache; medir localmente.
- **Dependências:** modelo sintético de unidades/equipas e F5-D1.
- **Adiamento:** otimização sim; semântica não.
- **Redação proposta:** “Só os cinco scopes fechados são válidos; herança de unidade é opt-in por permission, equipa não implica unidade e resource scope exige recurso carregado internamente.”

#### F5-D4 — Grants, precedência e conflitos

- **Pergunta:** como combinar perfil, grants e requisitos sem `DENY`?
- **Alternativas viáveis:** first-match; união positiva seguida por gates obrigatórios.
- **Recomendação:** união de permissions positivas do perfil e grants aplicáveis; depois contexto, scope, recurso/estado/relação, SoD/aprovação e assurance são cumulativos. Qualquer desconhecido recusa. Não há prioridade entre grants positivos.
- **Fundamento:** é a única alternativa coerente com grants positivos e requisitos de domínio já aprovados.
- **Segurança:** impede que grant amplo anule controlos fortes.
- **Implementação:** pipeline fixo, reason codes e snapshot de versões.
- **Risco residual:** grants excessivos continuam possíveis; mitigados por autoridades/SoD/auditoria.
- **Dependências:** F5-D3, D5, D7 e D8.
- **Adiamento:** não.
- **Redação proposta:** “Permissions positivas são acumuladas; um `allow` só existe se todos os gates posteriores forem satisfeitos. Ausência, inconsistência ou dado desconhecido recusa.”

### Bloco 3 — SoD, ações sensíveis e MFA

#### F5-D5 — Separação de funções

- **Pergunta:** que combinações exigem intervenientes distintos?
- **Alternativas viáveis:** matriz mínima fixa; matriz versionada por ação.
- **Recomendação:** matriz versionada; no v1, requester/subject/approver não podem ser a mesma pessoa para grant/revogação de `ORG_ADMIN`, grant de suporte e alteração do catálogo/perfil publicado. Aprovação de candidatura não pode ser do mesmo ator que submeteu quando o pipeline exigir gate. Legal hold/eliminação permanecem fora de F5.
- **Fundamento:** segurança geral exige SoD, sem antecipar domínios posteriores.
- **Segurança:** limita autoelevação e fraude de aprovação.
- **Implementação:** requisitos SoD no catálogo e identities explícitas na intent.
- **Risco residual:** conluio entre atores distintos; mitigação organizacional/auditoria futura.
- **Dependências:** D8 e dados de workflow.
- **Adiamento:** regras de domínios ainda inexistentes sim; núcleo administrativo não.
- **Redação proposta:** “Ações SoD declaram papéis incompatíveis; igualdade entre atores proibidos recusa antes do efeito e é auditada.”

#### F5-D6 — Ações sensíveis

- **Pergunta:** que operações exigem step-up, motivo e/ou aprovação?
- **Alternativas viáveis:** todas as mutações privilegiadas; catálogo explícito por risco.
- **Recomendação:** catálogo explícito v1: atribuir/revogar `ORG_ADMIN`; alterar perfil/grant; conceder/revogar/usar suporte; alterar policy/catalog/profile publicado; exportar dados sensíveis ou auditoria; reabrir estado terminal/aprovar gate; promover oportunidade privada. Legal hold/retenção ficam reservados e recusados até feature própria.
- **Fundamento:** cobre mínimos já nomeados sem classificar toda mutação como sensível.
- **Segurança:** step-up focado e testável.
- **Implementação:** flag/categoria no operation catalog.
- **Risco residual:** nova ação pode não ser classificada; validação exige categoria explícita ou `NONE`, nunca default permissivo.
- **Dependências:** D7 e D13.
- **Adiamento:** ações de features não implementadas ficam reservadas; núcleo não.
- **Redação proposta:** “Cada operação declara categoria de assurance; ações da allowlist sensível exigem `RECENT_MFA`, motivo e evento, e requisitos SoD quando aplicáveis.”

#### F5-D7 — Freshness e mecanismo MFA

- **Pergunta:** que prova e janela são exigidas?
- **Alternativas viáveis:** janela por risco; MFA em cada ação.
- **Recomendação:** categoria v1 única `RECENT_MFA`, máximo 300 segundos, usando policy F2 `c4g-assurance-v1`: token OIDC validado, `acr=c4g-loa2`, `amr` contém `otp`, `auth_time` dentro da janela e policy version coincidente; SID roda após step-up. Ações comuns usam `NONE`, mantendo mínimos de MFA por perfil/organização no login.
- **Fundamento:** corresponde à configuração reconhecida já implementada; Keycloak suporta ACR/LoA e max age.
- **Segurança:** prova forte e recente sem criar MFA aplicacional.
- **Implementação:** reutilizar `evaluateAssurance`; não aceitar flags do browser.
- **Risco residual:** TOTP não é phishing-resistant; evolução futura para WebAuthn não é bloqueada.
- **Dependências:** rollout Keycloak apenas para produção, não para testes sintéticos.
- **Adiamento:** mecanismo alternativo sim; janela v1 não.
- **Redação proposta:** “Ação `RECENT_MFA` exige evidência F2 `c4g-assurance-v1` com LoA2+OTP e `auth_time` ≤300 s; falha/ambiguidade exige step-up Keycloak ou recusa.”

### Bloco 4 — suporte temporário e administração privilegiada

#### F5-D8 — Autoridades de concessão/revogação

- **Pergunta:** quem pode conceder e revogar acesso?
- **Alternativas viáveis:** autoridade única por organização; matriz por tipo com dupla aprovação para elevado.
- **Recomendação:** grants comuns dentro do âmbito: `ORG_ADMIN`; `ORG_ADMIN` e suporte: pedido por ator autorizado, aprovação por `ORG_ADMIN` distinto e, para suporte, aprovação C4G distinta. Revogação pode ser feita por qualquer autoridade que poderia aprovar, pelo titular da organização para suporte, ou por segurança C4G; revogar não exige dupla aprovação.
- **Fundamento:** menor privilégio, SoD e suporte explícito já vinculativos.
- **Segurança:** evita autoelevação e acelera contenção.
- **Implementação:** authority matrix versionada e actor roles centrais separados.
- **Risco residual:** indisponibilidade de aprovador; não justifica bypass.
- **Dependências:** D5 e D9.
- **Adiamento:** UI sim; regra não.
- **Redação proposta:** “Concessão elevada usa aprovador distinto; suporte exige aprovação organizacional e C4G distintas; qualquer autoridade aprovada pode revogar imediatamente sem segunda aprovação.”

#### F5-D9 — Processo de suporte C4G

- **Pergunta:** como nasce e é usado o acesso de suporte?
- **Alternativas viáveis:** pedido organizacional; pedido C4G aprovado pela organização; ambos com as mesmas garantias.
- **Recomendação:** ambos; grant inclui organização, operador nominativo, permission/scope fechado, reason code, texto de motivo, ticket externo obrigatório, requester, dois aprovadores, início/fim e status. O operador seleciona explicitamente “modo suporte”; cada uso revalida grant/MFA e emite evento. Emergency/break-glass é recusado no MVP.
- **Fundamento:** contrato central já modela `support_access_grant`; emergência permanece aberta.
- **Segurança:** acesso observável, limitado e não herdado do papel global.
- **Implementação:** port/repository sintético na F5; UI e persistência reais posteriores.
- **Risco residual:** dados no ticket externo; guardar só referência opaca, nunca conteúdo.
- **Dependências:** D8, D10 e D13.
- **Adiamento:** integração de ticket sim; referência obrigatória não.
- **Redação proposta:** “Suporte só opera em modo explícito com grant nominativo, ticket opaco, motivo, scope, dupla aprovação, vigência e MFA; break-glass não existe no MVP.”

#### F5-D10 — Duração e renovação do suporte

- **Pergunta:** qual duração máxima e como renovar?
- **Alternativas viáveis:** máximo único; máximos por risco.
- **Recomendação:** máximo v1 de 4 horas e nunca além do fim pedido/contratual; início futuro máximo 24 horas; sem renovação automática. Renovar cria novo grant, novo ticket/justificação e novas aprovações. Revogação/expiração bloqueia o pedido seguinte.
- **Fundamento:** concreto, testável e proporcional a intervenção operacional; não é política jurídica de retenção.
- **Segurança:** reduz janela de exposição.
- **Implementação:** relógio injetado, intervalos fechados `[startsAt, endsAt)` e status explícito.
- **Risco residual:** quatro horas pode ser demasiado/insuficiente; rever com dados operacionais antes de produção.
- **Dependências:** validação humana/operacional antes de rollout.
- **Adiamento:** ajuste de produção sim; valor normativo local v1 não.
- **Redação proposta:** “Grant de suporte dura no máximo 4 h, pode começar no máximo 24 h depois, não renova; nova janela requer novo grant e aprovações.”

### Bloco 5 — revogação, cache, jobs, auditoria e canais não HTTP

#### F5-D11 — Revogação imediata

- **Pergunta:** o que significa revogação efetiva?
- **Alternativas viáveis:** invalidação por TTL; versão transacional revalidada; versão mais push de invalidação.
- **Recomendação:** alteração central de membership usa F3; alterações locais incrementam `authorizationVersion` na mesma transação. Sem cache de `allow`, o pedido/tentativa seguinte relê versões e recusa. Operação já iniciada pode terminar até ao timeout/transaction boundary, coerente com F4 fencing.
- **Fundamento:** não há transação distribuída nem revogação instantânea de SQL em curso.
- **Segurança:** sem janela de cache permissiva.
- **Implementação:** version counter/snapshot; doubles locais agora, schema posterior no plano.
- **Risco residual:** operação em curso; limitar timeout e revalidar antes do primeiro efeito sensível.
- **Dependências:** eventual schema local e eventos, não F4.4.
- **Adiamento:** push multi-processo sim; semântica não.
- **Redação proposta:** “Revogação impede qualquer nova decisão e retry; incrementa a versão autoritativa na mesma transação. Trabalho em curso só termina dentro do limite já aprovado.”

#### F5-D12 — Cache

- **Pergunta:** onde, com que chave e TTL guardar decisões?
- **Alternativas viáveis:** nenhum cache de decisão; cache local versionado; store distribuído.
- **Recomendação:** nenhum cache de decisão/snapshot mutável em F5 v1 (`TTL=0`). Só catálogo imutável process-local pela duração da release. Um cache futuro precisa da chave completa indicada em 3.5, invalidação multi-processo e ADR.
- **Fundamento:** garante coerência com D11 e mantém F5 independente de infraestrutura.
- **Segurança:** elimina stale allow e contaminação cross-tenant.
- **Implementação:** mais leituras; medir antes de otimizar.
- **Risco residual:** performance; experiência local de carga antes do plano final.
- **Dependências:** nenhuma.
- **Adiamento:** cache funcional integralmente adiável.
- **Redação proposta:** “F5 v1 não cacheia decisões `allow` nem grants/perfis mutáveis; catálogo validado é o único cache, process-local e imutável.”

#### F5-D13 — Eventos mínimos de auditoria

- **Pergunta:** que eventos F5 emitir antes do ledger definitivo?
- **Alternativas viáveis:** todas as decisões; allowlist de administração/sensíveis/recusas relevantes.
- **Recomendação:** taxonomia fechada em 5.6: eventos críticos pré-efeito abortam; eventos de recusa nunca podem transformar deny em allow; observacionais admitem reconciliação; eventos que exigem ledger append-only real ficam fora de F5. Não emitir cada leitura permitida.
- **Fundamento:** contrato de segurança exige evidência crítica e limitação de ruído/PII.
- **Segurança:** rastreabilidade sem exfiltração por logs.
- **Implementação:** schema versionado, sink injetável/double; storage posterior.
- **Risco residual:** ausência de ledger real impede garantia operacional, logo cobertura permanece parcial.
- **Dependências:** feature futura de auditoria.
- **Adiamento:** storage sim; schema/eventos não.
- **Redação proposta:** “F5 emite eventos allowlisted versionados segundo quatro classes de falha; evento crítico tem de ser aceite antes do efeito, falha de evento de recusa preserva o deny, evento observacional pode reconciliar e evidência dependente de ledger real permanece fora de F5.”

#### F5-D14 — Múltiplas memberships

- **Pergunta:** como autorizar o mesmo utilizador em várias organizações?
- **Alternativas viáveis:** perfil global; união; apenas membership selecionada.
- **Recomendação:** apenas membership/contexto F3 selecionado; nenhuma união de perfil, grant, unidade, equipa ou cache entre organizações.
- **Fundamento:** isolamento e F3 já vinculativos.
- **Segurança:** evita confused deputy e privilégio cross-tenant.
- **Implementação:** `membershipId` obrigatório na decisão humana.
- **Risco residual:** erro de UX na organização selecionada; contexto visível, sem alterar enforcement.
- **Dependências:** F3.
- **Adiamento:** não.
- **Redação proposta:** “Cada decisão humana pertence a exatamente uma membership F3 selecionada; memberships distintas nunca são combinadas.”

#### F5-D15 — Jobs e identidades de serviço

- **Pergunta:** como autorizar execução assíncrona?
- **Alternativas viáveis:** revalidar ator humano; service actor; híbrido por origem.
- **Recomendação:** híbrido definido em 3.6. Job humano revalida membership/permissão por tentativa; job sistémico usa service actor registado, organização e operation allowlisted. Caller nunca escolhe a identidade de serviço.
- **Fundamento:** jobs devem preservar tenant/idempotência sem fingir sessão humana.
- **Segurança:** impede privilege laundering em retry/replay.
- **Implementação:** envelope fechado e authorization adapter comum; double local.
- **Risco residual:** operação longa muda de policy após início; revalidar antes do primeiro efeito e por unidade idempotente.
- **Dependências:** worker completo é posterior.
- **Adiamento:** runtime do worker sim; contrato não.
- **Redação proposta:** “Cada tentativa resolve autorização corrente; jobs humanos preservam/revalidam membership, jobs sistémicos usam service actor interno mínimo e ambos fixam organização/operação no produtor.”

#### F5-D16 — Suspensão e offboarding

- **Pergunta:** que operações sobrevivem à inelegibilidade?
- **Alternativas viáveis:** bloquear só sessões; bloquear funcional e permitir allowlist operacional.
- **Recomendação:** organização/membership inelegível bloqueia API e jobs funcionais. Apenas operações técnicas de suspensão, drenagem, export autorizado de offboarding e reconciliação, em catálogo operacional separado, podem continuar; nunca reativam acesso nem reutilizam F5 funcional.
- **Fundamento:** F3/F4 já separam estado contratual e operacional.
- **Segurança:** fail-closed sem impedir recuperação controlada.
- **Implementação:** dois catálogos/fronteiras explícitos; F5 só define a interface.
- **Risco residual:** allowlist operacional excessiva; revisão própria em F4.4.
- **Dependências:** implementação real F4.4 posterior.
- **Adiamento:** operações F4.4 sim; regra de bloqueio não.
- **Redação proposta:** “Suspensão/offboarding bloqueia toda autorização funcional; somente catálogo operacional separado e explícito pode executar recuperação/drenagem.”

#### F5-D17 — Fronteira da entrega F5

- **Pergunta:** quanto implementar sem antecipar features transversais?
- **Alternativas viáveis:** engine isolado; engine mais uma vertical slice e ports de canais.
- **Recomendação:** engine/catalog/policy, modelos/doubles, perfis produtivos vazios e uma vertical slice exclusivamente sintética com `synthetic_resource.read`/`synthetic_resource.update`; ports de API/job/export/report/document/audit provam equivalência. Não existe operação funcional produtiva. Persistências e features completas ficam posteriores.
- **Fundamento:** prova integração e IDOR sem F4.4/F4.5, UI ou dados reais.
- **Segurança:** evita engine “correto” mas não aplicado nos PEPs.
- **Implementação:** composição injetável e testes end-to-end locais, sem migration persistente.
- **Risco residual:** restantes adaptadores podem divergir; cada feature futura precisa de contract tests.
- **Dependências:** apenas dados sintéticos/doubles.
- **Adiamento:** integrações completas sim; vertical slice não.
- **Redação proposta:** “F5 entrega engine comum, catálogo produtivo vazio e vertical slice exclusivamente sintética através de todos os ports; cada feature posterior só entra no catálogo com recurso, adapter, scopes e contract tests próprios aprovados.”

## 5. Addendum — catálogo bootstrap e falhas de auditoria

As conclusões desta secção substituem os catálogos ilustrativos anteriores. Continuam **propostas, ainda não aprovadas**.

### 5.1 A. Escolha do catálogo produtivo

Escolha recomendada: **Opção 1 — catálogo produtivo bootstrap vazio**.

As especificações de catálogo, matching, candidaturas e reporting confirmam capacidades e linguagem de produto, mas ainda não fecham, por operação, recurso físico, adapter, transições/estados, scopes, schemas de input/output e testes de autorização. A feature geral de segurança continua `Draft`. F4.3 estabelece expressamente catálogo produtivo `tenant-read-only-bootstrap-v1` com `operations: []`, sem schema/query module funcional e sem fallback Legacy/UBI. Logo, publicar agora permissions como `applications.update` ou `documents.download` transformaria intenção de produto em política aprovada por inferência.

F5 v1 prova somente o mecanismo com catálogo e recursos sintéticos injetados em testes. Os códigos sintéticos recomendados são `synthetic_resource.read` e `synthetic_resource.update`; nunca são carregados pela composição produtiva nem aceites em sessão, HTTP ou job real.

#### Matriz produtiva bootstrap exata

| Permission code | ORG_ADMIN | FUNDING_MANAGER | CONTRIBUTOR | VIEWER | Scopes permitidos | Sensível | SoD |
|---|---:|---:|---:|---:|---|---:|---|
| _Nenhuma — catálogo produtivo vazio_ | 0 | 0 | 0 | 0 | Nenhum | Não aplicável | Não aplicável |

#### Regras estruturais

- Os quatro perfis existem como códigos estáveis e templates imutáveis versionados, todos com `permissions: []` no bootstrap.
- Perfil vazio é válido, selecionável por membership e concede zero acesso funcional. Não causa fallback para outro perfil, Legacy, UI, role PostgreSQL ou `platformRoles`.
- Membership/perfil vazio permite apenas autenticação global e seleção/contexto F3; qualquer operação funcional é recusada antes do recurso/lease.
- Operação desconhecida falha `OPERATION_NOT_REGISTERED` antes de permission, repository funcional, credencial, pool ou lease.
- Permission desconhecida, ou conhecida apenas por fixture sintética mas ausente do catálogo produtivo, impede startup se referenciada por adapter produtivo e é recusada em runtime se aparecer em dados inválidos.
- Catálogo e perfis são imutáveis por versão. Uma feature futura publica nova versão com operação, permission, recurso, scopes, constraints, assurance, SoD, audit class, schemas e contract tests coincidentes; versões antigas não são reescritas.
- Wildcards, prefix matching, permissions livres, aliases Legacy e defaults implícitos são proibidos.
- Mesmo numa versão futura não vazia, perfil nunca atravessa membership: `organizationId` e `membershipId` F3 são gates prévios, e permission só produz candidato dentro dos scopes do mesmo tenant.
- Fixtures sintéticas são fisicamente/configuracionalmente separadas da composição produtiva; startup produtivo falha se uma entrada `synthetic_*` estiver presente.

### 5.2 B. Contrato do port de auditoria F5

F5 define `AuditPort.accept(event)` como fronteira injetável. “Aceite” significa apenas que o port assumiu responsabilidade durável ou que o double local simulou essa aceitação; não afirma que existe ledger append-only operacional. O port recebe evento fechado e versionado, aplica timeout limitado e devolve `ACCEPTED`, `REJECTED` ou erro/timeout. Nunca decide autorização.

Campos permitidos comuns: `eventId`, `schemaVersion`, UTC, `eventType`, `actorType`, IDs internos mínimos do ator/originator/sessão ou execução de serviço, `organizationId`, `operationCode`, `permissionCode` quando registada, tipo/ID mínimo do recurso, tipo/digest do scope, resultado, `reasonCode`, versões de catálogo/policy/autorização, `correlationId`, `causationId` e referência opaca de ticket quando aplicável.

Campos proibidos comuns: tokens/cookies/claims integrais, segredos, connection strings, host/base/credential refs, SQL, payload/body completo, conteúdo ou nome livre de documento, filtros/resultado integral de report/export, conteúdo de ticket, texto livre não classificado, stack trace e PII não necessária. Métricas de falha usam `eventType`, classe e reason code limitados; nunca tenant, user ou resource como labels.

#### Classe 1 — aceitação prévia obrigatória; falha aborta

O evento é construído depois de todos os checks e antes do primeiro efeito. Timeout, exceção ou `REJECTED` produzem erro interno sanitizado `AUDIT_REQUIRED_UNAVAILABLE`; não há mutação, emissão de URL, criação de export, início de suporte ou dispatch de job.

| Evento allowlisted | Momento | Comportamento de falha/retry | Aborta? | Teste local |
| --- | --- | --- | ---: | --- |
| `authorization.grant_change_authorized` | antes de criar, alterar ou revogar grant | sem retry inline além de uma tentativa limitada; caller pode repetir com a mesma idempotency key | Sim | double timeout/reject prova zero escrita e mesma decisão |
| `authorization.profile_change_authorized` | antes de atribuir/mudar perfil ou publicar nova versão | igual; inclui versão anterior/nova, não matriz integral | Sim | double rejeita e repository spy fica intocado |
| `authorization.sod_policy_change_authorized` | antes de publicar matriz SoD/catalog/policy | nenhuma publicação sem aceitação; nova tentativa é idempotente | Sim | hash/version permanecem anteriores |
| `sensitive_action.authorized` | depois de permission/scope/SoD/MFA e antes do efeito sensível | repetir exige reavaliar tudo; evento tem novo `eventId`, mesma idempotency/correlation quando aplicável | Sim | timeout impede effect port |
| `support_access.grant_authorized` | antes de criar/aprovar grant de suporte | falha mantém pedido sem grant utilizável | Sim | nenhuma vigência ativa no double repository |
| `support_access.started` | antes de entrar em modo suporte/primeiro uso | falha impede contexto de suporte | Sim | session/support context não é criado |
| `support_access.used` | antes de cada efeito sob suporte | falha impede o efeito concreto | Sim | resource adapter não é chamado |
| `support_access.revocation_authorized` | antes de marcar revogado | falha de auditoria não pode preservar acesso: primeiro bloquear/fence transacionalmente e registar outbox/audit intent atómica; se esse contrato mínimo não estiver disponível, F5 não implementa revogação persistente | Sim para conclusão; acesso fica bloqueado | double prova fence antes de retorno de erro e retry idempotente |
| `export.generation_authorized` | antes de iniciar/dispatch de export | falha impede job/objeto; retry reautoriza | Sim | queue double não recebe job |
| `export.access_authorized` | antes de emitir acesso/URL ao export | falha não emite URL | Sim | signer double não é chamado |
| `document.access_authorized` | antes de upload, download, preview ou URL | falha não emite URL nem aceita objeto | Sim | storage/signing double intocado |
| `service_job.dispatch_authorized` | antes de publicar job que produz efeito funcional | falha impede dispatch | Sim | queue double intocado |

Revogação é o caso especial: a indisponibilidade do sink nunca pode manter um grant conhecido como utilizável. A implementação futura precisa de bloqueio/fence e audit intent na mesma transação do estado autoritativo ou deve falhar antes de oferecer essa mutação. F5 apenas fixa o contrato e testa-o com doubles; não cria já outbox/ledger.

#### Classe 2 — eventos de recusa; falha preserva a recusa

São emitidos depois da decisão `deny`, antes da resposta apenas quando a allowlist de risco exigir. O resultado público permanece deny mesmo com timeout/rejeição. A falha é reportada por telemetria sanitizada/bounded e pode gerar reconciliação; nunca repete a operação funcional nem chama o effect port.

| Evento allowlisted | Casos | Timeout/rejeição e reconciliação | Aborta? | Teste local |
| --- | --- | --- | ---: | --- |
| `authorization.denied_relevant` | IDOR/cross-tenant, scope, SoD, estado/relação, permission ausente relevante | devolve o deny original; regista contador técnico limitado; eventual replay contém só evento sanitizado | A ação já está recusada | audit double falha e resposta/zero efeito não mudam |
| `authorization.policy_invalid` | catálogo/policy/version inconsistente ou desconhecida | fail-closed; sinal operacional separado | A ação já está recusada | engine nunca passa ao repository/effect |
| `assurance.step_up_required` | prova MFA ausente/expirada/insuficiente | devolve requisito de step-up aprovado; falha do audit port não concede | A ação já está recusada | ausência de evento não muda reason code |
| `sensitive_action.denied` | SoD, aprovação ou assurance falha | deny preservado; possível reconciliação | A ação já está recusada | effect spy zero |
| `support_access.denied` | grant ausente/futuro/expirado/revogado/out-of-scope | deny preservado | A ação já está recusada | support context zero |
| `service_authorization.denied` | service actor/operação/org inválidos ou retry sem autoridade | job falha/dead-letter segundo contrato futuro, nunca executa | A tentativa já está recusada | worker double não chama recurso |
| `export.denied` | filtros/scope/recurso/MFA inválidos | nenhum job/URL; reconciliação só do evento | A ação já está recusada | queue/signer zero |
| `document_access.denied` | objeto/recurso/scope/MIME state não autorizado | nenhuma URL/stream | A ação já está recusada | storage zero |

Não se audita cada `allow` de leitura normal. Um deny banal pode não ser evento; a allowlist inclui tentativas cross-tenant, ações sensíveis, suporte, service actors, exports/documentos e policy inválida. Rate limiting/agregação futura nunca altera a decisão.

#### Classe 3 — observacionais reconciliáveis

São emitidos depois de uma transição que já ficou segura ou por observação temporal. Falha não reverte nem autoriza; o port pode retry/reconciliar por `eventId`/idempotency key. O contrato futuro define armazenamento.

| Evento allowlisted | Momento | Timeout/rejeição e reconciliação | Aborta? | Teste local |
| --- | --- | --- | ---: | --- |
| `support_access.expired` | observação de `endsAt` passado; decisões já recusam pela hora | retry assíncrono/idempotente; expiração lógica não depende do evento | Não | relógio prova deny mesmo sem evento |
| `support_access.revoked` | depois do fence/estado autoritativo seguro | retry idempotente; nunca reabre grant | Não | audit falha e grant continua bloqueado |
| `authorization.version_advanced` | depois de versão local incrementada | retry/reconciliação; caches v1 inexistentes | Não | versão nova permanece |
| `service_job.completed_observed` | depois de unidade idempotente concluída | reconciliação futura; não altera autorização anterior | Não | falha não repete efeito |
| `export.completed_observed` | depois de resultado temporário criado sob autorização válida | reconciliação/cleanup futuro; não emite acesso | Não | nenhum URL é devolvido |
| `document.access_completed_observed` | depois de acesso autorizado concluído, se observabilidade exigir | best-effort/reconciliação; não contém conteúdo | Não | resposta já autorizada não é duplicada |

#### Classe 4 — deliberadamente fora da F5

F5 não declara cobertos nem simula como operacionais: imutabilidade/encadeamento criptográfico do ledger; retenção/arquivo/export da auditoria; acesso ao próprio ledger; prova de entrega end-to-end; SIEM/alerting; reconstrução forense; eventos reais de fornecedor/R2/Resend/Keycloak; dead-letter/replay persistente; auditoria jurídica de legal hold, eliminação física e pedidos de titulares. F5 define apenas schemas/ports necessários e doubles que comprovam os comportamentos das Classes 1–3.

### 5.3 Step-up MFA e auditoria

O pedido de step-up não é efeito funcional sensível: se a evidência falha, a decisão permanece deny e `assurance.step_up_required` é Classe 2. Depois de callback F2 bem-sucedido, a rotação de SID e evento de autenticação continuam sob o contrato F2. Ao retomar a ação, `sensitive_action.authorized` é Classe 1 e tem de ser aceite antes do efeito. Assim, falha de auditoria nunca converte necessidade de MFA em autorização nem duplica a responsabilidade F2.

### 5.4 Classificação das três incertezas restantes

- **Decisão normativa proposta:** suporte máximo de quatro horas, início até 24 horas, intervalo `[startsAt, endsAt)`, sem renovação automática. É material e deve integrar a aprovação única; enquanto não aprovada, impede `Ready` porque a validade do grant seria ambígua.
- **Gate de implementação:** benchmark sintético sem cache (`TTL=0`) com duas organizações, hierarquia e grants concorrentes. Não impede `Ready`; não muda comportamento, apenas valida viabilidade antes de fechar a implementação/otimização. Resultado insatisfatório não autoriza cache: exige nova decisão/ADR.
- **Gate de integração futura:** cobertura real dos ports em API/jobs/exports/reporting/documentos e armazenamento append-only. Não impede `Ready` nem a implementação local F5 com doubles; impede declarar AC-13/14 operacionalmente cobertos, fechar as features consumidoras ou rollout.

Com catálogo produtivo vazio, matriz exata, duração de suporte e taxonomia de auditoria explicitadas, não resta escolha comportamental necessária para planear/implementar localmente o engine F5. Permanecem gates de execução e integração, não decisões normativas abertas.

## 6. D. Impacto nos 20 critérios

| Critério | Determinação | Resultado desta pesquisa |
| --- | --- | --- |
| F5-AC-01 | Completa | formato, versionamento, imutabilidade e startup definidos |
| F5-AC-02 | Completa | ordem de recusa anterior a repository/lease definida |
| F5-AC-03 | Completa | gate F3 e regra humana definidos |
| F5-AC-04 | Completa | recurso tenant-scoped e matriz A/B definidos |
| F5-AC-05 | Completa | quatro perfis bootstrap definidos com conjunto produtivo exatamente vazio; fixtures sintéticas separadas |
| F5-AC-06 | Completa | cinco scopes e herança definidos |
| F5-AC-07 | Completa | união positiva + gates cumulativos definidos |
| F5-AC-08 | Completa | matriz SoD v1 definida |
| F5-AC-09 | Completa | `RECENT_MFA`, prova F2 e 300 s definidos |
| F5-AC-10 | Completa | suporte, dupla aprovação, 4 h e renovação definidos |
| F5-AC-11 | Completa | versionamento, pedido seguinte e cache TTL 0 definidos |
| F5-AC-12 | Completa | load interno, resposta uniforme e no-enumeration definidos |
| F5-AC-13 | Parcial | contrato comum definido; integração real dos canais é posterior |
| F5-AC-14 | Parcial | schema/allowlist definidos; storage append-only é posterior |
| F5-AC-15 | Completa | dimensões obrigatórias da matriz definidas |
| F5-AC-16 | Completa | operation adapter e inputs fechados definidos |
| F5-AC-17 | Completa | falhas e ordem fail-closed definidas |
| F5-AC-18 | Completa | engine/ports/doubles e vertical slice sintética definidos |
| F5-AC-19 | Completa | nenhuma entrada Legacy no modelo recomendado |
| F5-AC-20 | Completa | repository interno e autorização sobre recurso carregado definidos |

Nenhum critério fica sem direção normativa. AC-13/14 só podem ganhar evidência operacional nas features dos canais/auditoria; isso não torna o comportamento local F5 ambíguo.

## 7. E. Riscos e experiências necessárias

1. **Performance sem cache:** benchmark sintético com duas organizações, hierarquia profunda e grants concorrentes; objetivo é medir antes de introduzir cache, não criar um gate produtivo nesta fase.
2. **Atomicidade resource load/efeito:** provar que o recurso autorizado não muda de organização/estado entre check e efeito; preferir mesma transação/lease e condição de versão.
3. **Evolução do catálogo vazio:** testar que composição produtiva rejeita `synthetic_*`, wildcard e adapter que referencie permission ausente; cada futura feature precisa de revisão própria da matriz perfil/permission.
4. **Service actors:** testar retry/replay, suspensão entre tentativas e impossibilidade de o payload escolher identidade/operação.
5. **Auditoria crítica e revogação:** provar com doubles que timeout/rejeição Classe 1 produz zero efeito e que revogação nunca deixa o acesso ativo; persistência/outbox real continua gate futuro.
6. **Suporte 4 h:** valor normativo proposto sujeito à aprovação única; antes de produção, validar operacionalmente sem o alterar silenciosamente.
7. **TOTP:** risco residual de phishing conhecido; WebAuthn/phishing-resistant MFA pode ser evolução, sem alterar o contrato de categoria de assurance.

## 8. Pontos mantidos fora da F5

Provisioning/lifecycle físico; F4.4/F4.5; migração UBI; modelo funcional completo; UI administrativa; legal hold/eliminação; ledger definitivo de auditoria; rollout Keycloak; secret manager; sizing, SLAs e políticas produtivas. F5 usa ports e doubles para auditoria, jobs, reports, exports, documentos, suporte e relógio.

## 9. F. Texto para aprovação humana única

> Aprovo conjuntamente F5-D1–F5-D17 conforme o contrato completo em context/research/f5-authorization-policy-decisions.md, com estas escolhas materiais: F5 v1 usa a Opção 1, catálogo produtivo bootstrap exatamente vazio (`permissions: []`, sem operações funcionais), proíbe wildcard/fallback Legacy e prova o engine apenas com `synthetic_resource.read` e `synthetic_resource.update` em fixtures não produtivas; os perfis versionados `ORG_ADMIN`, `FUNDING_MANAGER`, `CONTRIBUTOR` e `VIEWER` existem estruturalmente, todos com conjunto produtivo vazio e, portanto, zero acesso funcional, sempre limitado à membership F3 e aos scopes futuros `ORGANIZATION`, `UNIT`, `UNIT_SUBTREE`, `TEAM` e `RESOURCE`; permissions futuras seguem `resource.action` e só entram por nova versão aprovada da respetiva feature com recurso, adapter, scope e testes; a decisão futura acumula apenas grants positivos e exige contexto, scope, recurso/estado/relação, SoD, aprovação e assurance; SoD é versionada e ações sensíveis exigem `RECENT_MFA` F2/Keycloak de 300 segundos; suporte é nominativo, explícito, com ticket opaco, motivo, scope, aprovação organizacional e C4G distintas, máximo de 4 horas, início até 24 horas, sem renovação automática nem break-glass; revogação usa versões autoritativas no pedido seguinte e F5 v1 não cacheia decisões/grants/perfis (`TTL=0`), ficando o benchmark sem cache como gate de implementação que não reabre esta decisão; auditoria usa port/doubles, sem alegar ledger append-only, e quatro classes fechadas: eventos críticos de grants/revogações, perfis, SoD, ações sensíveis, suporte start/use/revoke, dispatch de jobs, exports e documentos têm de ser aceites antes do efeito ou a ação aborta; eventos de deny/step-up preservam sempre a recusa mesmo se o port falhar; eventos observacionais de expiração/conclusão podem ser reconciliados; ledger, retenção, SIEM e prova de entrega ficam fora de F5; jobs humanos revalidam membership, jobs sistémicos usam service actor interno com organização/operação fixas, e suspensão/offboarding bloqueia autorização funcional salvo catálogo operacional separado. A cobertura real dos canais e o armazenamento append-only são gate de integração futura, não decisão aberta nem condição para Ready. Esta aprovação permite promover a F5 para Ready e elaborar o plano técnico, mas não autoriza implementação, migrations persistentes, rollout, F4.4 ou F4.5.

## 10. G. Texto sugerido para `current-work.md` após aprovação

```markdown
## Decisões aprovadas

F5-D1–F5-D17 foram aprovadas conjuntamente por referência a `context/research/f5-authorization-policy-decisions.md`.

- F5 v1 usa catálogo produtivo bootstrap vazio (`permissions: []`). Não existem permission codes nem operações funcionais produtivas; a prova usa apenas `synthetic_resource.read`/`synthetic_resource.update` em fixtures separadas da composição produtiva.
- Permissions futuras usam `resource.action`, ASCII lowercase, sem wildcard, e exigem nova versão aprovada com recurso, adapter, scopes e contract tests.
- Perfis base v1 `ORG_ADMIN`, `FUNDING_MANAGER`, `CONTRIBUTOR`, `VIEWER` são templates versionados estruturalmente válidos, todos com `permissions: []`; perfil vazio concede zero acesso e nunca ativa fallback.
- Scopes v1: `ORGANIZATION`, `UNIT`, `UNIT_SUBTREE`, `TEAM`, `RESOURCE`; subtree é opt-in por permission, equipa não herda unidade e recurso é carregado internamente.
- A decisão acumula permissions positivas e exige cumulativamente contexto F3, scope, recurso/estado/relação, SoD/aprovação e assurance; desconhecido recusa.
- SoD usa matriz versionada; ações sensíveis usam catálogo explícito e `RECENT_MFA` F2/Keycloak com 300 segundos.
- Grants elevados exigem autoridade distinta. Suporte requer operador nominativo, modo explícito, ticket opaco, motivo, scope, aprovação organizacional e C4G distintas, máximo de 4 horas, início até 24 horas, sem renovação automática ou break-glass.
- Revogação incrementa versões autoritativas e bloqueia o pedido/retry seguinte. F5 v1 não cacheia decisões, grants ou perfis mutáveis (`TTL=0`); apenas o catálogo imutável fica process-local.
- Auditoria usa allowlist e port sanitizado: Classe 1 é aceite antes do efeito ou aborta; Classe 2 preserva sempre o deny; Classe 3 é observacional/reconciliável; ledger/retention/SIEM/prova de entrega são Classe 4 fora da F5. O port/double não equivale a armazenamento append-only operacional.
- Uma decisão humana usa apenas a membership F3 selecionada. Jobs humanos revalidam essa membership; jobs sistémicos usam service actor interno e operação/organização fixadas pelo produtor.
- Suspensão/offboarding bloqueia autorização funcional; operações de recuperação pertencem a catálogo operacional separado.
- F5 entrega engine comum, catálogo produtivo vazio, modelos/doubles e vertical slice exclusivamente sintética pelos ports de API, jobs, exports, reporting, documentos e auditoria; integrações completas permanecem nas respetivas features.
- O suporte tem máximo normativo de 4 h e início até 24 h. O benchmark com `TTL=0` é gate de implementação; canais reais e ledger append-only são gate de integração futura, não decisões abertas.

### Limitações preservadas

A aprovação não autoriza implementação, migrations persistentes, rollout, F4.4, F4.5, migração UBI, UI final, infraestrutura produtiva ou auditoria append-only completa. AC-13 e AC-14 só obtêm cobertura operacional nas features dos canais e auditoria.
```

## Fontes internas principais

`AGENTS.md`; `context/current-work.md`; overview, arquitetura e standards; feature geral de segurança; decisões de sessão, MFA, identidade/dados e tenant lifecycle; dicionário lógico; históricos F2, F3 e F4.0–F4.3; middleware/repositories de sessão, membership, contexto e tenant; routes/controllers/services Legacy; contratos de reporting, exports, documentos, jobs, suporte e auditoria.

Next step: aprovar ou alterar o contrato completo e, após aprovação, promover a F5 para `Ready`.
