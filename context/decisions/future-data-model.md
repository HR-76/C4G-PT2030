# Decisão: modelo lógico de dados futuro

## Estado

Aceite como baseline arquitetural.

Esta decisão promove `context/research/future-data-model.md`. O estudo mantém cardinalidades, ciclos de vida, Mermaid, riscos e migração UBI. Esta decisão prevalece quando o complementa. Não define ainda SQL, tipos físicos ou índices.

## Estrutura

- Base central C4G para identidade aplicacional, organizações, memberships, catálogo central, integrações, administração e diretório dos tenants.
- Uma base Neon por organização para estrutura, permissões detalhadas e dados operacionais privados.
- UUID v7 gerado pela aplicação para entidades partilhadas, sincronizadas, auditadas ou expostas.
- Sem foreign keys entre bases; consistência por outbox/inbox, eventos idempotentes, retries, dead-letter e reconciliação.
- Configurações publicadas são versões imutáveis; labels configuráveis usam códigos semânticos estáveis.
- Entidades de negócio são arquivadas. Snapshots seletivos preservam reporting e auditoria.

## Identidade e MFA

Keycloak, alojado e gerido pela C4G, é responsável por identidades, credenciais, autenticação, verificação de e-mail, recuperação, MFA, sessões de identidade e federação OIDC/SAML.

- Realm C4G único no MVP.
- OpenID Connect Authorization Code Flow com PKCE.
- Cookies `HttpOnly`, `Secure` e `SameSite` adequado; tokens não ficam em `localStorage`.
- MFA obrigatório para administradores C4G, administradores das organizações, suporte e ações administrativas sensíveis.
- Cada organização pode exigir MFA a todos os membros.
- Identidade Keycloak válida não concede acesso a uma organização.

A base central mantém `users`, referências `auth_identities`, sessões aplicacionais/revogação, `organizations`, `organization_memberships`, `invitations` e configuração de autenticação. A membership central é a fonte de verdade do acesso. Cada identidade pode conservar vínculos removidos como histórico, mas tem no máximo uma membership não removida em toda a plataforma.

## Base central C4G

### Diretório e administração

- `organization_connections`: localização da base e `secret_ref`, nunca credenciais em claro.
- `tenant_schema_states`: versão desejada/aplicada, saúde e lock de migração.
- `platform_admin_assignments`: privilégios C4G fora das memberships.
- `support_access_grants`: autorização temporária, limitada, justificada e auditada.
- `platform_audit_events`: evidência append-only da administração central e suporte.

### Catálogo e integrações

- `opportunities` e `opportunity_revisions`.
- `sources`, `connectors`, `connector_runs` e `external_opportunity_records`.
- `opportunity_source_links` para proveniência.
- `duplicate_candidates` e decisões humanas de merge.
- Taxonomias, versões, termos e classificações centrais.
- Desaparecimento da fonte marca indisponível/arquivada; nunca elimina histórico.

### Eventos

- Fila central PostgreSQL para provisionamento, migrations multi-base, integrações, sincronização, e-mail, webhooks, reconciliação, retenção, reporting, exportações e manutenção.
- Worker Node.js independente da API, através de uma abstração de jobs; `pg-boss` ou adaptador equivalente aprovado é detalhe substituível.
- Outbox criada na mesma transação da alteração, na base onde o evento nasce; inbox idempotente no consumidor.
- Retries limitados, locks recuperáveis, dead-letter, repetição autorizada e reconciliação periódica.
- Delivery state por consumidor/destino. Falhar a sinalização central depois do commit não perde o evento local.
- Índice mínimo de mensagens/eventos Resend quando necessário, sem duplicar conteúdo ou PII desnecessária.

### Pedidos de titulares e promoções

- Pedidos relativos a utilizadores globais são orquestrados na base central e executados por adaptadores conhecidos apenas nos tenants abrangidos pelas memberships.
- A central guarda pedido, verificação, aprovações, política, itens de execução, exceções e manifesto; não conserva cópias permanentes dos dados operacionais exportados.
- Contactos externos são tratados pela organização responsável. Documentos e texto livre exigem revisão manual no MVP.
- A promoção de uma oportunidade privada exige `opportunity.promote`, seleção explícita de campos, confirmação de autoridade, snapshot mínimo, deduplicação e decisão C4G.
- A promoção é uma saga auditável: cria ou liga a oportunidade central, preserva a oportunidade privada e nunca partilha matching, notas, candidaturas, documentos, contactos ou outros dados privados.

## Base de cada organização

### Membros e estrutura

- `organization_member_profiles` por `membership_id` e `global_user_id`, sem credenciais.
- `organizational_units` hierárquicas e `organizational_unit_paths` para consultas de âmbito.
- `unit_memberships` temporais, com no máximo uma unidade principal ativa.
- `permission_grants` positivos por membro, equipa, unidade ou perfil base, com âmbito explícito. Não existe `DENY` no MVP.
- Configuração organizacional tipada; JSON apenas para extensão sem invariantes críticas.

O acesso exige, por ordem, identidade autenticada, utilizador ativo, organização ativa, membership central ativa, perfil base, âmbito local, concessões positivas, relação/estado do recurso e requisitos adicionais. As quatro primeiras falhas bloqueiam imediatamente. O serviço de autorização resolve códigos de permissão estáveis; controladores não interpretam diretamente perfis. A base guarda apenas concessões diretas e a herança é calculada. Ausência de concessão válida significa recusa.

### Competências e prioridades

- Taxonomias locais versionadas, eventualmente mapeadas para taxonomias C4G.
- Competências associáveis a organização, unidade, equipa ou pessoa.
- Prioridades estratégicas e perfis organizacionais versionados.
- Versões publicadas são imutáveis e referenciadas pelas avaliações.

### Oportunidades, matching e qualificação

- `organization_opportunities` contém dados privados e referencia exatamente uma oportunidade central ou privada.
- Estado de qualificação: nova, em análise, qualificada, não relevante ou arquivada.
- Scoring profiles e regras versionados, distinguindo elegibilidade obrigatória de critérios ponderados.
- Cada avaliação referencia revisão da oportunidade, versão de scoring e versão do perfil organizacional.
- Resultados por critério preservam score, correspondências, incompatibilidades e informação ausente.
- Decisão humana e feedback são registos separados do resultado automático.
- Reexecução cria nova avaliação; não reescreve a anterior.
- Promoções privadas guardam pedido, snapshot partilhável e proveniência. Depois da aprovação, a oportunidade central pode tornar-se origem canónica sem apagar a origem privada histórica.

### Candidaturas

- Pipelines, stages, transitions e requirements versionados.
- Stages configurados apontam para categorias semânticas C4G.
- Uma oportunidade pode originar várias candidaturas.
- A candidatura referencia a versão de pipeline utilizada.
- Stage history é append-only; reabertura terminal exige autorização, justificação e auditoria.
- Um responsável principal ativo por candidatura.
- Tarefas podem pertencer a pessoa, equipa ou unidade e bloquear transições.
- O MVP suporta uma aprovação interna ativa por gate; novos ciclos criam novos registos.

### Parceiros

Catálogo reutilizável, privado por organização:

- `partners`: entidade institucional, país, tipo, identificadores, contactos institucionais, competências, origem, estado e histórico;
- `partner_contacts`: pessoas separadas, com acesso, retenção e anonimização próprios;
- `application_partners`: participação, função, responsabilidade, orçamento, contribuição, estado, datas, observações e snapshot;
- `application_partner_contacts`: contactos usados na candidatura e snapshot necessário.

Alterações no catálogo não reescrevem candidaturas anteriores. Parceiros pontuais podem ser promovidos ao catálogo sem perder histórico. Não existe partilha automática entre clientes. Uma rede global futura exige consentimento, governação e nova decisão.

Dados de trabalho permanecem editáveis. Snapshots institucionais do parceiro são imutáveis, sequenciais por candidatura e criados na associação, em alterações relevantes antes da submissão, em cada versão formal submetida e em alterações contratuais. Participação, responsabilidades, contribuição, orçamento, datas, estado, observações, ordem e papel de coordenador continuam tipados em `application_partners`. Contactos pessoais e respetivos snapshots são separados do snapshot institucional.

### Documentos e R2

- `documents`, `document_versions`, `storage_objects`, requirements e reconciliações.
- Versões são imutáveis e guardam autor, hash, MIME, tamanho e estado.
- Fluxo: registo pending, URL assinada, confirmação/checksum e estado available.
- Eliminação física permitida usa `delete_pending` e worker idempotente.
- Reconciliação deteta objetos órfãos e registos sem objeto.

### Notificações, reporting e auditoria

- Notificações in-app e preferências.
- Outbox Resend com idempotency key e estados de entrega.
- Definições/versionamento de métricas; projeções são regeneráveis, não source of truth.
- Exportações guardam filtros, âmbito autorizado e objeto R2 temporário.
- Auditoria local append-only com actor, membership, sessão, recurso, resultado e correlation ID.

## Retenção, legal hold e pedidos de titulares

Não existe prazo universal. Existe uma política-base C4G versionada e exceções documentadas por organização, contrato, programa ou obrigação legal/regulamentar. A precedência é `legal_hold` → obrigação legal ou programa específico → contrato → organização → política-base C4G. Uma regra específica substitui a geral apenas no seu âmbito.

Cada versão define classe, âmbito, finalidade, evento inicial explícito, duração configurada, ação final, condições, exceções, revisão manual, aprovador, aprovação, vigência, versão substituída, fundamento e possibilidade de hold. Prazos não ficam hardcoded.

Classes iniciais: identidade/autenticação, memberships/perfis, oportunidades, matching/qualificação, candidaturas, documentos, tarefas/aprovações, comunicações, auditoria, logs técnicos e dados temporários.

Ações finais: `PRESERVE`, `ARCHIVE`, `ANONYMIZE`, `PSEUDONYMIZE`, `DELETE` ou `REVIEW_MANUAL`.

- Eventos iniciais suportam criação, encerramento da oportunidade/projeto/contrato, decisão final, saída do utilizador, remoção da membership, expiração do convite, última atividade, evento de auditoria, resolução de incidente ou data definida pelo programa. O sistema regista o evento escolhido; não o infere apenas do estado atual.
- `legal_hold` prevalece sobre qualquer ação incompatível.
- No MVP, `REVIEW_MANUAL` é o padrão: o sistema calcula elegibilidade e gera uma lista, mas não elimina nem anonimiza automaticamente. Arquivo lógico exige ação autorizada e auditada. Falhas não alteram o registo.
- Cada decisão ou execução referencia a versão da política, utilizador, data e motivo. Antes da produção de cada cliente existe uma matriz de retenção aprovada.
- Pedidos de titulares distinguem acesso/exportação, correção, restrição, oposição e apagamento/anonimização; podem terminar completos, parciais, anonimizados, preservados ou rejeitados com fundamento.
- Identidade Keycloak só é tratada depois das operações necessárias nos tenants. Sessões e acessos são revogados quando aplicável.
- Documentos e texto livre têm revisão manual; exportações temporárias usam R2, encriptação, URL assinada, expiração e auditoria.
- Reporting e auditoria podem conservar snapshots anonimizados sem PII desnecessária.
- Oportunidades e candidaturas não são eliminadas apenas por encerramento.
- PII é proibida em JSON livre, payloads não classificados, logs, correlation IDs e campos genéricos. Uma extensão com PII declara finalidade, classificação, exportação, anonimização e retenção no schema.

## Valores monetários

Cada valor guarda montante decimal, código ISO 4217, natureza, data de referência, origem e precisão. Não usar ponto flutuante JavaScript.

Naturezas mínimas: custo total, solicitado, aprovado, contribuição própria, orçamento do parceiro, orçamento da organização e despesas realizadas.

- Cada candidatura tem moeda principal e pode conter outras moedas.
- Valor e moeda originais são preservados.
- Cada organização define moeda de reporting; EUR é o padrão português.
- Conversão guarda base, destino, taxa, fonte, data e valor convertido como snapshot.
- Histórico não é recalculado silenciosamente com taxas atuais.
- Valores sem taxa válida não entram em totais consolidados e são assinalados.
- Cálculo e arredondamento ficam num serviço de domínio monetário.

Dados financeiros de trabalho são editáveis; snapshots são imutáveis e sequenciais por candidatura. Criam-se, pelo menos, na aprovação interna, submissão, alteração formal, decisão e encerramento.

- O cabeçalho tipado identifica candidatura, versão, momento, estado, referência, moeda de reporting, regra de cálculo, autor e schema de extensão opcional.
- Linhas tipadas guardam natureza, montante/moeda originais, origem e entidade/parceiro quando aplicável. Naturezas mínimas incluem custo total, solicitado, aprovado, contribuição própria, cofinanciamento, orçamento da organização/parceiro e despesa realizada.
- Conversões associadas preservam montantes, moedas, taxa, base/destino, fonte, data, precisão, arredondamento e estado. O conjunto é integralmente presente ou ausente.
- Extensões JSON são imutáveis, identificadas e validadas por schema/version; não substituem identificadores, autoria, moedas ou montantes centrais, nem suportam isoladamente reporting comum.
- Uma correção cria nova versão ligada à anterior, com motivo, autor e data.

## Jobs, eventos e compatibilidade

- A fila central reclama jobs atomicamente, com prioridade, scheduling, tentativas, lock expirável, timeout, idempotency key, correlation ID e estados `PENDING/SCHEDULED/RUNNING/RETRY/COMPLETED/FAILED/DEAD_LETTER/CANCELLED`.
- O worker descobre tenants ativos pelo diretório central, usa polling adaptativo, lotes, backoff e limites de concorrência globais e por organização. Não mantém ligações permanentes a todas as bases.
- Eventos incluem `event_id`, tipo, `schema_version`, origem, organização, agregado, instante, correlation/causation IDs, idempotency key e payload validado. Versões desconhecidas são rejeitadas de forma controlada, nunca descartadas.
- Durante rollout, a aplicação suporta schema/eventos `N` e temporariamente `N-1`. Compatibilidade de leitura/escrita é declarada; writes incompatíveis são bloqueados e tenants com migration em erro entram em modo restrito.
- Releases seguem `expand → migrate → contract`. Eventos publicados são imutáveis e transformações entre versões são explícitas e testadas.

## Source of truth

| Dado | Fonte de verdade |
| --- | --- |
| Credenciais, MFA e autenticação | Keycloak |
| Identidade aplicacional, organização e membership | Base central C4G |
| Ligação e versão do tenant | Base central C4G |
| Catálogo e proveniência central | Base central C4G |
| Perfil local, unidades e permissões | Base do cliente |
| Relação privada, matching e qualificação | Base do cliente |
| Candidaturas, equipas, parceiros e documentos | Base do cliente |
| Binários | R2; metadados e autorização no cliente |
| Reporting | Histórico local; projeções derivadas |

## Provisionamento e migrações

- Provisionamento é saga explícita até a organização ficar ativa.
- Cada base regista migrations locais; a central agrega o estado dos tenants.
- Migrações usam lock, preflight, ponto de recuperação, timeout e verificação.
- A API conhece versões compatíveis e bloqueia writes incompatíveis.
- `tenant_schema_state` regista versão atual/alvo, estado, mínimos de leitura/escrita, verificação, erro e atualização.
- Instalações dedicadas usam o mesmo manifesto e versões.

## Migração UBI

Criar os novos esquemas e executar ETL validada, mantendo o legado read-only no cutover. Migrar por ordem: identidade/memberships; unidades; taxonomias/competências; catálogo; relações e qualificações; candidaturas/pipeline; parceiros; documentos R2; histórico necessário; reconciliação; delta final.

IDs antigos ficam numa tabela de mapping, não como chaves novas. Não inferir decisões humanas ausentes. Exceções de estado, orçamento, ficheiros ou deduplicação exigem relatório e revisão.

## Questões ainda abertas

- Prazos concretos de retenção por classe.
- Requisitos de residência e soberania por contrato.
- Fontes aprovadas para taxas de câmbio.
- Consentimento e governação de eventual rede global de parceiros.
