# Arquitetura

## Arquitetura futura aprovada

O produto usa uma arquitetura híbrida multi-tenant: identidade e catálogo central na base C4G; uma base PostgreSQL separada por organização para dados operacionais. Instalações totalmente dedicadas podem ser contratadas sem criar forks do código.

No MVP, frontend, API e worker executam como serviços ou contentores independentes numa VPS C4G partilhada, atrás de reverse proxy HTTPS.

## Componentes

| Componente | Responsabilidade |
| --- | --- |
| Frontend | Interface pública sem segredos; apresenta a organização única resolvida pela sessão |
| API | Autenticação, resolução do tenant, autorização, regras de negócio e URLs assinados |
| Worker Node.js | Serviço independente da API; executa fila central, integrações, importações, dispatch de outboxes, notificações, reconciliação, retenção, reporting e tarefas assíncronas |
| Reverse proxy | HTTPS e encaminhamento; portas internas não são públicas |
| Base central Neon | Identidade, sessões, organizações, memberships, convites, catálogo central e diretório de ligações |
| Bases Neon dos clientes | Unidades, perfis locais, permissões detalhadas, qualificação, candidaturas, documentos, reporting e auditoria |
| Cloudflare R2 | Documentos, anexos, importações e exportações privadas |
| Resend | E-mail transacional e eventos de entrega |
| Keycloak C4G | Identidade, credenciais, autenticação, MFA, sessões de identidade e federação OIDC/SAML |

## Identidade e resolução da organização

MFA é opcional por escolha individual em toda a aplicação, incluindo administração e operações sensíveis, conforme [decisão de 2026-10-17](decisions/2026-10-17-user-optional-mfa.md). O login inicial usa utilizador/password; ativação e desativação pertencem ao titular no serviço de identidade. A autenticação recente e os restantes controlos de autoridade mantêm-se.

1. O utilizador autentica-se no Keycloak por OIDC Authorization Code Flow com PKCE.
2. A API confirma sessão, utilizador e a única membership de entidade elegível, quando existe.
3. A API fixa na sessão a organização dessa membership; o utilizador não escolhe entre entidades.
4. A API resolve internamente a ligação registada para essa organização.
5. A autorização detalhada usa perfil local, unidades, equipas e recurso.
6. A ação é auditada com `global_user_id`, `organization_id`, sessão e contexto local.

Uma identidade pode ter atribuições de Administração C4G sem membership de entidade. Para contas operacionais, a Central admite no máximo uma membership não removida por `global_user_id`; memberships removidas permanecem como histórico. Uma mudança de entidade termina explicitamente o vínculo anterior antes de criar o novo.

A aplicação usa cookies `HttpOnly`, `Secure` e `SameSite` adequado; tokens não ficam em `localStorage`. A autorização não confia exclusivamente em roles incluídas num token. Credenciais nunca são duplicadas nas bases dos clientes.

## Criação de oportunidades — decisão de 29/10/2026

A criação manual pertence exclusivamente à Administração C4G, com atribuição central atual e sem membership de cliente, e escreve no catálogo central. Complementa fontes sem API. Clientes consultam as oportunidades e mantêm qualificação/candidaturas nos tenants. Oportunidades privadas históricas permanecem isoladas, sem migração ou publicação automática; novas mutações de catálogo privadas deixam de ser expostas. [Contrato](features/central-manual-opportunity-authoring.md).

## Distribuição de dados

O [interesse organizacional separado da candidatura](features/organizational-opportunity-interest.md), confirmado em 30/10/2026 e ainda por implementar, pertence à base do cliente. As suas unidades e as unidades da candidatura são afetações explícitas independentes; a abertura copia a seleção confirmada sem sincronização posterior. Esta segmentação não muda a autoridade central nem as regras de acesso por equipa.

### Base central C4G

- `users`, `auth_identities`, `sessions`;
- `organizations`, `organization_memberships`, `invitations`;
- `organization_connection` como controlo corrente, `tenant_database_generation` como ownership físico, `organization_connection_version` como histórico recuperável, e versão do esquema;
- contratos, planos e configuração global;
- catálogo central, proveniência, qualidade e integrações comuns;
- administração C4G e eventos centrais.

### Base de cliente

- referência `global_user_id` e `organization_member_profile`;
- unidades e memberships em unidades;
- competências, prioridades, permissões e equipas;
- relação privada com oportunidades e oportunidades privadas;
- matching, qualificação e feedback;
- candidaturas, pipelines, tarefas, aprovações e parceiros;
- documentos e metadados;
- notificações, reporting e auditoria local.

A membership central é a fonte de verdade do acesso. Projeções locais são auxiliares.

## Diretório e lifecycle de tenants

`organization_id`, `tenant_id` e `database_ref` são conceitos distintos. No modo inicial `DATABASE_PER_ORGANIZATION`, cada organização possui um tenant operacional e cada tenant pertence a uma única organização; o identificador tenant permanece estável quando a infraestrutura é restaurada, migrada ou rodada.

A API e o worker resolvem o tenant exclusivamente a partir de contexto organizacional validado no servidor e `operationCode` selecionado por adaptador interno registado. O cliente nunca fornece tenant, operação técnica, região, host, nome de base, referência de credencial ou connection string. A Central guarda apenas referências opacas e não existe fallback para a Central, Legacy ou outro tenant.

O lifecycle separa estado contratual da organização, estado operacional da ligação, progresso de provisioning, compatibilidade do schema e saúde observada. `organization.status` continua a determinar elegibilidade F3; a ligação apenas expressa disponibilidade operacional e não pode reativar a organização. Acesso exige simultaneamente organização/membership elegíveis, contexto F3 válido, tenant associado, ligação `AVAILABLE`, schema compatível e operação admitida pelo catálogo da release. Saúde recente não substitui estas verificações. O contrato e a única matriz normativa estão em `context/decisions/tenant-directory-and-lifecycle.md`.

`READ_ONLY` é deny-by-default e aceita apenas `operationCode` presente no catálogo versionado da release, com query module registado, testes obrigatórios e transação PostgreSQL realmente read-only. Não admite DDL, DML, estado local, jobs, locks de escrita, timestamps funcionais, funções com efeitos ou SQL arbitrário. Catálogo ou compatibilidade desconhecida falha antes da lease/query. Só `COMPATIBLE` permite operação normal de leitura e escrita.

O catálogo é validado integralmente no startup: códigos são únicos por release, adaptadores possuem códigos constantes e módulos/modos têm de coincidir. A lease fixa tenant, versão, revisão, binding digest, `operationCode`, módulo e modo; o executor rejeita mismatch e executa `BEGIN READ ONLY` antes de qualquer SQL de leitura.

Pools são internos, limitados e identificados por tenant e versão de ligação. A política exige limites por tenant e processo, reserva operacional, timeouts, expiração idle, single-flight, backoff com jitter, circuit breaker isolado, métricas e testes sob carga; valores de produção dependem de capacidade comprovada. Rotação cria e valida uma versão imutável, troca atomicamente o ponteiro corrente, incrementa o fence, bloqueia leases antigas, drena e revoga. Mudança de versão/revisão durante aquisição reinicia a resolução. Credenciais são obtidas por `credential_ref` opaca através de contrato vendor-neutral e nunca entram em sessões, respostas, logs ou eventos funcionais.

O binding físico distingue marker (`tenant_id` e `database_generation_id`), fingerprint do schema, `system_identifier` observado, `connection_version` aprovada e digest do binding. `tenant_database_generation` fixa geração e referência física a um único tenant, permitindo que rotações de credencial do mesmo tenant reutilizem essa geração sem associação cruzada. A lease revalida versão e digest antes da primeira query. Ligações usam FKs imediatas com ações restritivas; provisioning usa `tenant_assignment_state`, `MATCH SIMPLE NOT DEFERRABLE INITIALLY IMMEDIATE`, `ON UPDATE RESTRICT`, `ON DELETE RESTRICT`, `CHECK` fechado de atribuição/estado e trigger write-once. Eliminação física só ocorre em workflow aprovado e auditado.

Versões de ligação seguem `CANDIDATE → VALIDATED → DRAINING → REVOKED` ou `CANDIDATE/VALIDATED → FAILED`; `REVOKED` e `FAILED` são terminais. Apenas a versão `VALIDATED` apontada pelo controlo corrente recebe leases. O cutover troca o ponteiro e move a versão anterior para drenagem na mesma transação Central; resultados incertos são reconciliados pelo estado persistido e nunca assumidos como sucesso.

A Central conserva no máximo um snapshot de health por tenant e versão de ligação, atualizado por probes controlados ou transições operacionais, nunca sincronamente por cada request. Séries temporais ficam na observabilidade com labels limitadas; circuit breaker vive por tenant no processo ou em store operacional aprovado. Health não autoriza, não substitui validação atual, não causa fallback e não expõe infraestrutura em respostas ou logs públicos.

Onboarding e offboarding são sagas idempotentes e reconciliáveis. Suspensão contratual usa `organization.status`; bloqueio/drenagem da ligação usa `operational_state`. Offboarding torna primeiro a organização inelegível e coordena os registos afetados numa transação Central, sem transformar o estado operacional numa segunda fonte contratual. Retenção, exportação, legal hold, arquivo e eliminação física são decisões distintas; backups expiram pela sua política própria. A residência na União Europeia é a política inicial por defeito, mas região concreta, exceções, RPO/RTO e políticas contratuais têm gates próprios antes de provisioning real. Restore testado é requisito de ativação operacional. A UBI é integrada posteriormente como primeiro tenant através do mesmo contrato, sem caminhos específicos no núcleo.

`organization.status` segue allowlist: `PROVISIONING → ACTIVE`, `PROVISIONING → ARCHIVED`, `ACTIVE → SUSPENDED`, `SUSPENDED → ACTIVE`, `ACTIVE/SUSPENDED → TERMINATING` e `TERMINATING → ARCHIVED`. `TERMINATING` é irreversível no MVP e `ARCHIVED` não é reativável. O fence bloqueia novas leases imediatamente; operações já iniciadas podem concluir até ao timeout, sem garantia de revogação instantânea, e passos irreversíveis aguardam drenagem.

O contrato lógico está pronto para F4.1. Integração operacional F4.2 e provisioning real F4.4 continuam bloqueados pelos fornecedores, valores e políticas identificados na decisão; nenhum rollout tenant em produção está autorizado. Neon permanece o fornecedor PostgreSQL aprovado/previsto pelos ADRs existentes, mas domínio, diretório e resolver são vendor-neutral. Neon não seleciona secret manager nem provisioning orchestrator; substituição futura exige ADR, não alteração do contrato de domínio.

## Consistência entre bases

- Não assumir transações distribuídas.
- Usar fila central PostgreSQL por abstração própria, inicialmente com `pg-boss` ou adaptador equivalente aprovado; não usar Redis ou broker dedicado no MVP.
- Usar outbox na mesma transação do dado de negócio, inbox idempotente, retries limitados, locks expiráveis, dead-letter e reconciliação.
- A falha ao sinalizar a fila central depois de um commit local não perde o evento; polling adaptativo encontra outboxes pendentes sem manter ligações permanentes a todos os tenants.
- Uma membership permanece em estado intermédio até o perfil local obrigatório existir.
- Desativação central bloqueia imediatamente novos acessos, mesmo com projeção local atrasada.

## Autorização

- Avaliar identidade, utilizador, organização e membership centrais antes de qualquer permissão local.
- Perfis base fornecem conjuntos versionados de códigos de permissão; controladores não interpretam roles diretamente.
- Concessões locais são apenas positivas e podem abranger organização, unidade, candidatura, oportunidade qualificada, equipa, relatório ou exportação.
- Ausência de concessão válida significa recusa. A base guarda concessões diretas; o serviço acumula perfil, unidades, equipas, relação com o recurso e grants diretos.
- Não existe `DENY` no MVP. Estado do recurso, separação de funções, autenticação recente, aprovação e propriedade são requisitos de domínio, não permissões negativas. MFA é uma escolha individual, não uma condição obrigatória de autorização.
- Mudanças de hierarquia, suspensão, arquivo ou revogação invalidam caches relevantes.

## Catálogo e conectores

- Catálogo central C4G partilhado e relações organizacionais privadas.
- Conectores independentes por fonte, preferindo APIs, feeds e ficheiros oficiais.
- Scraping apenas quando permitido, necessário e monitorizado.
- Importações idempotentes e isoladas; falha de uma fonte não bloqueia as restantes.
- Alterações externas criam histórico e preservam correções manuais e dados privados.
- Correspondências exatas podem ser fundidas; duplicados incertos exigem revisão humana.

## Armazenamento e e-mail

- R2 privado, preferencialmente bucket por organização ou prefixo obrigatório.
- Upload/download por URL temporário após autorização na API.
- Disco da VPS apenas para dados efémeros de desenvolvimento/processamento.
- Metadados e objetos devem ter reconciliação para impedir ficheiros órfãos.
- Resend é processado por outbox persistente no worker, com idempotência, retries e webhooks.

## Operação e evolução

- Bases distintas para desenvolvimento, staging e produção.
- Branches Neon apenas para desenvolvimento, testes e ambientes temporários.
- Provisionamento, migrações e verificação de versão automatizados para todas as bases.
- Backups e recuperação testados; configuração da VPS reproduzível.
- Logs e métricas separados por serviço e organização.
- Dados reais não entram em desenvolvimento sem autorização e anonimização.
- API, workers e frontend podem ser separados fisicamente quando carga ou contratos justificarem.
- A fila central executa provisionamento, migrations, integrações, sincronização, e-mail, webhooks, reconciliação, retenção, relatórios, exportações e manutenção.
- Durante rollout, API e worker suportam `N` e temporariamente `N-1`; compatibilidade de leitura/escrita é declarada por migration.
- Releases usam `expand → migrate → contract`; writes incompatíveis são bloqueados e erros de migration produzem modo restrito controlado.

## Privacidade, retenção e promoção

- Política-base C4G versionada admite exceções por organização, contrato, programa ou obrigação, com `legal_hold` como precedência máxima.
- No MVP, retenção apenas calcula elegibilidade; `REVIEW_MANUAL` é o padrão e não há eliminação ou anonimização automática.
- A classificação operacional distingue existência e acesso online, arquivo lógico e eliminação física: `ARCHIVED` identifica um estado lógico e não comprova remoção ou transferência dos bytes para armazenamento frio. A disponibilidade deve ser verificada por recurso e permissão.
- Nos documentos F11, `DELETE_PENDING` e `DELETED` são vocabulário reservado, sem transição implementada; a migração inicial impede `DELETED`. Um eventual fluxo de eliminação exige contrato aprovado e evidência auditável separada para metadados, objetos, réplicas e expiração dos backups, incluindo legal hold. Ausência numa consulta não prova eliminação.
- Pedidos de titulares globais são orquestrados centralmente e executados apenas nos tenants abrangidos. A central não conserva cópias permanentes dos dados exportados.
- Exportações temporárias ficam em R2 com URL assinada, expiração e auditoria; documentos e texto livre exigem revisão manual.
- Promoção privada é uma saga autorizada e auditável. Apenas o snapshot explicitamente selecionado chega à C4G; dados operacionais privados permanecem no tenant.

## Instalações dedicadas

Podem usar VPS, Neon, R2, domínio ou e-mail dedicados. O padrão mantém identidade central; identidade autónoma é uma exceção contratual suportada por adaptadores, não por fork.

## Implementação atual, não aprovada como destino

O repositório atual é uma SPA React/Vite e uma API Express ligada a uma única base PostgreSQL. API, cron jobs, SMTP e uploads locais estão acoplados ao backend. O modelo contém estruturas UBI fixas e perfis globais `ADMIN`/`PROFESSOR`.

Consultar `context/references/current-implementation.md` para factos e diferenças detalhadas.

## Riscos a tratar

- Resolução segura e eficiente de ligações por organização.
- Migrações consistentes em muitas bases.
- Falhas parciais entre base central, base do cliente, R2 e Resend.
- Observabilidade sem mistura de dados entre clientes.
- Instalações dedicadas ou desligadas sem divergência do produto.

## Questões em aberto

- Gestão e rotação das credenciais Neon, R2 e Resend.
- Objetivos contratuais de disponibilidade, recuperação e residência de dados.
- Prazos concretos de retenção e fontes aprovadas para taxas de câmbio.
