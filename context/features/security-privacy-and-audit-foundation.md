# Fundação de Segurança, Privacidade e Auditoria

## Estado

In Progress. Contrato transversal parcialmente implementado pelas fases F2, F3, F4.0–F4.3, F5, F7, F9, F10 e F11, todas concluídas e arquivadas. A fundação, o enforcement local, o ledger F7, a execução assíncrona F9, a observabilidade F10 e o armazenamento documental abstrato F11 já existentes não demonstram operação multi-instituição, providers ou integrações funcionais reais, rollout, staging ou produção, nem tornam segura por inferência a implementação UBI atual.

Reconciliação documental: 2026-10-08, atualizada após a conclusão de F10 e F11. A classificação abaixo foi confrontada com os históricos, pesquisas aprovadas, código, migrations e testes existentes; interfaces, ports, doubles, exporters in-memory, PostgreSQL descartável e testes exclusivamente sintéticos provam implementação técnica local, não integração ou operação real.

## Objetivo

Definir requisitos executáveis para segurança multi-instituição antes da implementação do novo modelo, cobrindo identidade, isolamento, autorização, dados, auditoria, fornecedores e operação.

Este contrato especializa, sem repetir integralmente, `context/architecture.md`, `context/decisions/multi-tenant-identity-and-data.md`, `context/decisions/hosting-and-external-services.md` e `context/decisions/future-data-model.md`. O modelo lógico detalhado permanece em `context/references/logical-data-dictionary.md`. As diferenças do piloto estão em `context/references/current-implementation.md`.

## Princípios obrigatórios

- Falhar fechado quando identidade, membership, tenant, autorização, política ou classificação não puderem ser confirmados.
- Obter `organization_id` e a ligação do tenant exclusivamente de contexto validado no servidor; nunca confiar num identificador, nome de base, prefixo R2 ou ligação fornecidos pelo cliente.
- Tratar a membership central ativa como fonte de verdade do acesso.
- Aplicar menor privilégio, minimização, separação de funções e defesa em profundidade.
- Preservar histórico e evidência; arquivo, anonimização ou eliminação exigem política, autoridade e auditoria.
- Não colocar credenciais, tokens, strings de ligação, chaves ou segredos no repositório, frontend, logs ou eventos.
- Não considerar o isolamento completo até existirem testes negativos automatizados entre organizações.

## 1. Threat model

### Atores

| Ator | Intenção e capacidade relevante |
| --- | --- |
| Utilizador não autenticado | explorar autenticação, convites, recuperação, endpoints públicos e ficheiros |
| Membro autenticado | usar legitimamente uma ou mais organizações; pode tentar elevar privilégios ou atravessar tenants |
| Administrador da organização | gerir acesso local; pode cometer erro ou abuso dentro e fora do âmbito permitido |
| Administrador ou suporte C4G | operar a plataforma; representa risco privilegiado e exige controlo reforçado |
| Serviço interno | API, worker e jobs com identidade própria e privilégios limitados |
| Fornecedor externo | Keycloak, Neon, R2 e Resend, incluindo falha, compromisso ou indisponibilidade |
| Atacante externo | explorar aplicação, supply chain, infraestrutura, credenciais ou engenharia social |
| Insider do fornecedor ou C4G | abusar de acesso operacional ou de dados sem autorização |

### Ativos

- identidades, sessões, memberships, convites, MFA e concessões de suporte;
- dados operacionais e pessoais de cada organização;
- catálogo central e dados privados ainda não promovidos;
- candidaturas, decisões, documentos, snapshots e informação financeira;
- ligações dos tenants, segredos, chaves e configuração de ambientes;
- eventos de auditoria, logs, backups, exportações e manifestos de pedidos de titulares;
- disponibilidade e integridade da API, worker, jobs, filas e reconciliações.

### Fronteiras de confiança

1. navegador ↔ reverse proxy/API;
2. API/worker ↔ Keycloak;
3. API/worker ↔ base central Neon;
4. resolver de tenant ↔ base Neon da organização;
5. API/worker ↔ R2 e Resend;
6. base central ↔ bases dos clientes por eventos/outbox/inbox;
7. operação C4G/suporte ↔ dados da organização;
8. produção ↔ staging/desenvolvimento, backups e ferramentas de observabilidade.

### Superfícies de ataque

- login, callback OIDC, logout, recuperação, convites, seleção de organização e renovação de sessão;
- endpoints, parâmetros, filtros, IDs de recurso e permissões de campo;
- upload, download, preview, MIME, nomes, metadados e URLs assinadas R2;
- importações, conectores, webhooks, e-mail, jobs, filas, retries e dead-letter;
- caches, logs, métricas, tracing, exports, backups e tooling de suporte;
- configuração, CI/CD, dependências e painéis dos fornecedores;
- texto livre, extensões JSON, ficheiros e conteúdo renderizado no browser.

### Ameaças prioritárias e controlos

| Ameaça | Controlos mínimos | Risco residual a acompanhar |
| --- | --- | --- |
| acesso cruzado entre organizações | tenant resolvido no servidor, base por organização, autorização por recurso e testes negativos | erro de configuração, cache ou job com contexto incorreto |
| elevação de privilégio/IDOR | permissões positivas, âmbito explícito, deny-by-default e verificação por pedido | regra de domínio incompleta ou concessão excessiva |
| roubo/fixation de sessão | OIDC com PKCE, cookies seguros, rotação de sessão, MFA e revogação | compromisso do dispositivo ou sessão antes da deteção |
| CSRF e XSS | proteção CSRF adequada ao padrão de cookie, CSP/encoding/sanitização e ausência de tokens em storage JS | vulnerabilidade em dependência ou conteúdo permitido |
| fuga por documentos/exports | R2 privado, autorização antes de URL curta, prefixo/bucket isolado, expiração e auditoria | partilha do URL durante a validade ou conteúdo mal classificado |
| confusão/replay de jobs e eventos | tenant no envelope validado, idempotência, assinatura/autenticação, locks e reconciliação | duplicação ou atraso sem perda de isolamento |
| abuso privilegiado | MFA, separação de funções, acesso temporário, motivo, aprovação, alerta e auditoria | abuso por múltiplos privilegiados ou falha de supervisão |
| fuga por logs, JSON ou telemetria | allowlist, redaction, classificação, limites e testes | conteúdo livre inesperado ou configuração externa |
| perda ou corrupção | backups cifrados, restore testado, hashes, versionamento e reconciliação | RPO/RTO ainda não aprovados |
| compromisso de fornecedor/supply chain | menor privilégio, ambientes separados, rotação, alertas e inventário | dependência de controlos e disponibilidade de terceiros |

O threat model é revisto antes de produção, após mudança material de arquitetura ou fornecedor e após incidente relevante.

## 2. Identidade e sessão

### Contrato

- Keycloak C4G gere credenciais, autenticação, recuperação, verificação, MFA e sessões de identidade; a aplicação não duplica credenciais.
- O login usa OIDC Authorization Code Flow com PKCE, validando `state`, `nonce`, redirect URI, issuer, audience e tempos dos tokens.
- A sessão aplicacional usa cookies `HttpOnly`, `Secure` e `SameSite` adequado ao fluxo aprovado. Tokens OIDC nunca ficam em `localStorage`, `sessionStorage`, URLs ou logs.
- O identificador da sessão é regenerado no login, elevação de privilégio, troca de organização e outros limites de confiança definidos no desenho de sessão.
- MFA é obrigatório para administradores C4G, suporte, administradores das organizações e ações administrativas sensíveis; uma organização pode exigi-lo a todos os membros.
- A API confirma em cada pedido protegido: sessão, utilizador, organização ativa e membership ativa. Autorização funcional não depende apenas de roles do token.
- Suspensão ou revogação central impede imediatamente novos acessos. Caches de acesso têm invalidação explícita e duração compatível com este requisito.
- A troca de organização aceita apenas uma membership ativa do utilizador, roda o contexto de sessão, limpa caches derivados e nunca conserva IDs, permissões ou dados do tenant anterior.
- Logout local invalida a sessão aplicacional; os fluxos de logout/revogação coordenam Keycloak conforme a decisão operacional futura.
- Operações mutáveis protegidas por cookie exigem defesa CSRF. O método escolhido deve cobrir formulários, APIs, CORS/origin e pedidos cross-site.
- Conteúdo não confiável é codificado por contexto; HTML arbitrário é proibido por omissão. A política CSP e sanitização complementam, não substituem, encoding seguro.
- Erros de autenticação não revelam existência de conta, organização, membership ou detalhes internos.

### Revogação obrigatória

Desativação do utilizador, suspensão/remoção da membership, revogação de suporte, perda de perfil, alteração crítica de permissões e incidente de segurança invalidam sessões e caches afetados. Se Keycloak ou a base central não permitirem confirmar acesso, o sistema falha fechado.

## 3. Isolamento multi-instituição

### Bases e resolução do tenant

- A base central contém identidade aplicacional, organizações, memberships, diretório de ligações e dados centrais; cada organização usa uma base Neon separada para dados operacionais.
- O resolver recebe `organization_id` do contexto autenticado, confirma a membership e consulta uma referência opaca de ligação. Credenciais ou nomes físicos nunca vêm do frontend.
- Uma ligação não resolvida, versão incompatível, organização suspensa ou mismatch entre contexto e dados bloqueia a operação e gera evento operacional/auditoria adequado.
- Queries locais não aceitam mudança de tenant durante a unidade de trabalho. Pools, transações e objetos de acesso não são partilhados de forma que permita reutilizar contexto entre organizações.

### R2, jobs, caches, logs e exports

- R2 é privado, com bucket por organização ou prefixo obrigatório e validado. A chave do objeto incorpora contexto gerado pelo servidor, não caminho livre do cliente.
- Upload/download usa URL temporária emitida após autorização; confirmação valida organização, objeto esperado, tamanho, MIME e checksum. Reconciliação deteta órfãos e metadados sem objeto.
- Cada job/evento inclui identificador imutável, tipo/schema, `organization_id`, correlation/idempotency key e identidade do produtor. O consumidor valida o tenant antes de abrir a ligação.
- Retries, dead-letter e replay preservam tenant e idempotência; um erro num tenant não muda nem bloqueia dados dos restantes.
- Chaves de cache incluem organização, sujeito, recurso, âmbito e versão de autorização relevantes. Revogação e troca de organização invalidam entradas afetadas.
- Logs e métricas incluem apenas contexto organizacional mínimo e pseudonimizado quando possível; nunca payloads de negócio por omissão.
- Exports reaplicam as permissões da consulta, ficam em área R2 isolada e temporária, têm expiração, autor, filtros, organização e auditoria. A central não guarda cópia permanente dos dados operacionais exportados.

## 4. Autorização

- Perfis base fornecem conjuntos versionados de códigos de permissão; controladores e UI não interpretam nomes de role como autorização final.
- Concessões são apenas positivas. Ausência de permissão aplicável significa recusa; não existe `DENY` no MVP.
- Âmbitos suportados incluem organização, unidade, equipa, oportunidade qualificada, candidatura, relatório, exportação e outros recursos explicitamente modelados.
- A autorização acumula perfil base, membership/unidades/equipas ativas, participação, propriedade e grants diretos. Herança por hierarquia organizacional só ocorre quando a regra do código de permissão a declarar explicitamente.
- Cada decisão verifica ação, sujeito, organização, recurso, âmbito, estado do recurso e requisitos adicionais como MFA, propriedade, aprovação ou separação de funções.
- Separação de funções aplica-se, pelo menos, a concessão de privilégios elevados, acesso de suporte, aprovação sensível, execução futura de retenção e alterações críticas de segurança. O autor não pode ser o único aprovador quando a ação exigir dupla intervenção.
- Ações sensíveis exigem autenticação recente/MFA quando definido, motivo obrigatório, auditoria e confirmação explícita. Incluem gestão privilegiada, suporte, exportação sensível, promoção privada, legal hold e decisões de retenção.
- A interface pode ocultar ações indisponíveis, mas a API executa sempre a decisão de autorização.

### Suporte C4G

O acesso de suporte é recusado por omissão e só existe por concessão temporária com organização, operador, âmbito, motivo, aprovador, início e expiração. Exige MFA, indicador visível de contexto, auditoria de início/uso/fim e revogação imediata. Não permite extração ou alteração fora do âmbito concedido. Acesso de emergência requer fluxo próprio ainda por decidir, nunca uma conta partilhada.

## 5. Dados e privacidade

### Classificação e minimização

Cada campo, documento, evento e exportação relevante tem classe e finalidade. O conjunto inicial segue `context/decisions/future-data-model.md`: identidade/autenticação, memberships/perfis, oportunidades, matching/qualificação, candidaturas, documentos, tarefas/aprovações, comunicações, auditoria, logs técnicos e dados temporários.

- recolher e expor apenas dados necessários à finalidade e ao âmbito autorizado;
- não usar dados reais em desenvolvimento sem autorização e anonimização;
- proibir PII em correlation IDs, logs, nomes técnicos, payloads não classificados e JSON livre;
- uma extensão JSON com PII exige schema versionado, finalidade, classificação, regras de acesso, exportação, anonimização e retenção;
- documentos e texto livre requerem revisão manual em pedidos de titulares e ações de retenção no MVP.

### Retenção, legal hold e anonimização

- Políticas são versionadas; prazos não ficam hardcoded.
- Precedência: `legal_hold` → obrigação/programa → contrato → organização → política-base C4G.
- `legal_hold` bloqueia qualquer ação incompatível e a sua colocação/libertação é autorizada e auditada.
- No MVP, `REVIEW_MANUAL` é o padrão: o sistema calcula elegibilidade, mas não elimina nem anonimiza automaticamente.
- Arquivo, anonimização, pseudonimização ou eliminação registam política/versão, autor, aprovação quando aplicável, motivo, resultado e itens afetados; falhas deixam itens não concluídos intactos.
- Anonimização é verificada contra identificadores diretos, indiretos, snapshots, documentos, caches, índices e exports; não é declarada concluída quando subsiste reidentificação razoável.

### Pedidos de titulares

- O pedido é verificado e orquestrado centralmente, mas executado apenas nos tenants abrangidos por adaptadores explícitos e idempotentes.
- Suporta acesso/exportação, correção, restrição, oposição e apagamento/anonimização, com preservação fundamentada quando obrigação ou legal hold prevalecer.
- O manifesto temporário fica cifrado em R2, com URL assinada, expiração, acesso auditado e sem cópia operacional permanente na base central.
- A identidade Keycloak é tratada apenas depois das operações necessárias nos tenants; sessões e acessos são revogados quando aplicável.

### Snapshots e documentos

- Snapshots preservam apenas os campos necessários à finalidade histórica; não copiam texto livre, contactos ou dados privados por conveniência.
- Snapshots imutáveis mantêm proveniência, autor, instante, versão e classificação. Promoção privada partilha apenas o snapshot explicitamente selecionado e autorizado.
- Versões de documentos são imutáveis e associadas a metadados, hash, MIME, tamanho, organização e estado. Download, preview e exportação passam por autorização.

## 6. Auditoria

### Eventos obrigatórios

Registar, quando aplicável:

- login, logout, falha relevante, MFA, revogação e troca de organização;
- criação, ativação, suspensão e remoção de utilizador/membership;
- alterações de perfil, grant, unidade, equipa e configuração de segurança;
- concessão, utilização, expiração e revogação de suporte;
- acesso ou alteração de recurso sensível, download/upload de documento e emissão/uso observável de exportação;
- criação de URL assinada, reconciliação R2 e deteção de mismatch;
- ações sensíveis, aprovações, promoção privada, legal hold, retenção e pedidos de titulares;
- execução, retry, dead-letter, replay e falha de jobs/eventos críticos;
- mudanças de configuração, segredos/referências, schema, fornecedor e backup/restore;
- decisões de autorização recusadas relevantes para deteção, com limitação de ruído e sem dados sensíveis.

### Estrutura comum

Cada evento contém, quando aplicável: `event_id`, versão do schema, instante UTC, tipo, autor humano ou serviço, `global_user_id`, sessão, `organization_id`, ação, tipo/ID do recurso, âmbito, `correlation_id`, `causation_id`, resultado, código de motivo, origem/canal e metadados classificados mínimos. Não contém segredo, token, conteúdo documental, payload integral nem PII desnecessária.

### Integridade, acesso e retenção

- Auditoria é append-only; correções são novos eventos ligados ao anterior.
- Escrita de auditoria crítica ocorre na mesma transação do dado ou por outbox durável; uma falha que impedir evidência obrigatória faz a ação sensível falhar fechado.
- Acesso a auditoria exige permissão própria, âmbito organizacional e registo do próprio acesso. Operadores não podem alterar ou apagar eventos.
- Exportação de auditoria preserva filtros, autor e cadeia de custódia.
- Retenção da auditoria é política versionada, sujeita a legal hold e requisitos contratuais; o prazo concreto permanece aberto.
- Alertas não substituem a evidência persistente; correlation IDs permitem ligar API, worker, fornecedor e auditoria sem transportar PII.

## 7. Segredos e fornecedores

- Neon, R2, Resend e Keycloak usam identidades/credenciais distintas por ambiente e, quando suportado, por serviço e organização.
- API e worker recebem apenas os privilégios necessários; o frontend não recebe segredos nem acesso direto privilegiado.
- O diretório guarda referências opacas ao cofre, nunca credenciais em claro. O mecanismo de cofre é uma decisão aberta.
- Produção, staging e desenvolvimento são isolados. Dados e segredos de produção não são reutilizados em ambientes inferiores.
- Rotação tem proprietário, periodicidade, gatilhos por incidente/saída, sobreposição segura, teste e prova de conclusão. Periodicidades concretas permanecem abertas.
- Acesso humano aos painéis de fornecedores exige conta individual, MFA e revisão periódica; contas partilhadas são proibidas.
- Webhooks validam autenticidade, replay e idempotência antes de mutar estado.
- Falha ou indisponibilidade de fornecedor degrada de forma segura: não contorna autorização, isolamento, auditoria ou retenção.
- Dependências externas têm inventário, versão, finalidade, dados partilhados, região, contactos de incidente e procedimento de substituição/saída.

## 8. Operação segura

- Logging estruturado usa allowlist e redaction na origem; exceções e erros não devolvem stack, SQL, ligação ou payload em produção.
- Alertas cobrem falhas/repetições de autenticação, anomalias de autorização, acesso cruzado bloqueado, suporte, exports sensíveis, dead-letter, mismatch R2, falha de auditoria, alteração de segredo e degradação de fornecedor.
- Incidentes têm severidade, responsável, contenção, preservação de evidência, comunicação, recuperação, revisão e ações corretivas. Procedimentos e tempos concretos ficam para decisão operacional.
- Acessos operacionais são nominativos, com MFA, menor privilégio, duração limitada e revisão. Acesso a produção não implica acesso aos dados de clientes.
- Backups são cifrados, segregados por ambiente, sujeitos a controlo de acesso, retenção e legal hold aplicáveis. Restores são testados em ambiente isolado e comprovam tenant, integridade e versões.
- Recuperação valida base central, bases dos clientes, R2, eventos pendentes e consistência; não restaura um tenant sobre outro.
- Runbooks cobrem revogação, fornecedor indisponível, fila parada, fuga suspeita, compromisso de segredo, restore e reconciliação.
- Alterações de dependências e configuração passam por revisão, validação e rollback; vulnerabilidades críticas têm triagem e resposta rastreáveis.

## 9. Critérios de aceitação

Os testes usam pelo menos duas organizações, utilizadores com memberships/perfis diferentes e recursos com IDs conhecidos. Todos são automatizados antes de produção quando a implementação correspondente existir.

### Autenticação e sessão

- **SEC-AC-01:** o login OIDC válido conclui Authorization Code com PKCE e cria sessão por cookie seguro sem expor tokens ao storage JavaScript, URL ou logs.
- **SEC-AC-02:** callback com `state`, `nonce`, issuer, audience, redirect URI ou código inválido é recusado sem criar sessão.
- **SEC-AC-03:** fixation é impedida por rotação do identificador nos limites definidos; pedidos mutáveis sem prova CSRF válida são recusados.
- **SEC-AC-04:** perfis privilegiados e ações sensíveis exigem MFA segundo a política aplicável.
- **SEC-AC-05:** suspensão/remoção de membership ou revogação crítica bloqueia imediatamente novo pedido e invalida caches/sessões afetados.
- **SEC-AC-06:** troca para organização sem membership ativa falha; troca válida não conserva dados, cache ou permissões da organização anterior.

### Autorização e isolamento

- **SEC-AC-07:** cada endpoint protegido recusa por omissão quando falta permissão, âmbito, requisito de estado, MFA ou separação de funções.
- **SEC-AC-08:** perfis, grants, unidades, equipas e participação produzem decisões previstas em testes de tabela, incluindo herança permitida e não permitida.
- **SEC-AC-09:** leitura, pesquisa, escrita, arquivo, exportação e acesso por ID de um recurso da organização B são recusados a sujeitos/jobs da organização A, mesmo com ID válido.
- **SEC-AC-10:** manipular `organization_id`, ligação, prefixo, cabeçalho, filtro ou payload não altera o tenant resolvido no servidor.
- **SEC-AC-11:** pools, transações, caches, paginação, jobs, retries e processamento paralelo não misturam contexto entre organizações.

### R2, jobs e idempotência

- **SEC-AC-12:** URL R2 só é emitida após autorização, aponta ao âmbito correto, expira e não permite trocar chave/prefixo por objeto de outro tenant.
- **SEC-AC-13:** upload com tamanho, MIME, checksum, organização ou objeto inesperado não fica disponível; reconciliação identifica órfãos e ausências.
- **SEC-AC-14:** o mesmo job/evento processado repetidamente produz um único efeito; mismatch de tenant/schema/idempotency key falha fechado e é auditado.
- **SEC-AC-15:** retry, dead-letter e replay mantêm o tenant original e não impedem processamento seguro dos restantes tenants.

### Auditoria, privacidade e operação

- **SEC-AC-16:** cada evento obrigatório contém estrutura comum, resultado e motivo aplicáveis, sem token, segredo, documento, payload integral ou PII não autorizada.
- **SEC-AC-17:** eventos são append-only, acessos à auditoria são autorizados/auditados e falha da evidência crítica impede a ação sensível.
- **SEC-AC-18:** pedido de titular localiza apenas tenants abrangidos, é idempotente, respeita legal hold e produz manifesto temporário sem cópia operacional central permanente.
- **SEC-AC-19:** anonimização não conclui enquanto identificadores, snapshots, documentos, JSON, cache ou exportações aplicáveis permitirem reidentificação não aceite.
- **SEC-AC-20:** testes de logs, erros, tracing e métricas demonstram ausência de segredos, tokens, strings de ligação, payloads e PII proibida.
- **SEC-AC-21:** indisponibilidade de Keycloak, base central, tenant, R2, Resend ou auditoria produz o modo seguro definido, sem bypass de acesso nem mistura/perda silenciosa.
- **SEC-AC-22:** concessão de suporte expirada, revogada, sem MFA, sem motivo, sem aprovação ou fora do âmbito é recusada; cada uso autorizado é rastreável.
- **SEC-AC-23:** restore testado recupera o tenant correto, mantém isolamento, verifica integridade e reconcilia base/R2/eventos dentro dos objetivos aprovados.

## 10. Reconciliação de cobertura em 2026-10-08

### Fases concluídas reconhecidas

- F2 implementou a fundação local de OIDC, sessão server-side, PKCE, proteção de callback, rotação, CSRF e assurance; o rollout real de Keycloak/Central continua ausente.
- F3 implementou membership central, revogação e contexto organizacional local; a aplicação às rotas Legacy/UBI e a validação em ambientes alvo continuam ausentes.
- F4.0–F4.3 aprovaram o contrato de tenant e implementaram diretório Central, runtime isolado, resolução server-side, leases/pools e compatibilidade de schema. F4.4 (provisioning/operação real) e F4.5 (migração UBI) continuam por iniciar.
- F5 implementou localmente o motor deny-by-default, perfis e scopes estruturais, SoD, MFA, suporte temporário, revogação versionada, adapters comuns e auditoria por port. F7 evoluiu o catálogo produtivo apenas com quatro permissions de auditoria; os perfis continuam sem grants e as operações funcionais permanecem ausentes.
- F7 implementou o ledger append-only/tamper-evident source-local, catálogo fechado de 25 eventos, JCS-1/SHA-256, hash chain/checkpoints, roles insert-only/read-only, query/export ports, migrations Central/tenant sintético e restore verificável. A prova usa PostgreSQL 17 descartável; não existe rollout em tenants reais, WORM, HMAC/assinatura, âncora externa, SIEM, retenção jurídica ou garantia contra owner/superuser.
- F9 implementou worker separado, `QueuePort` com adapter `pg-boss`, envelope fechado, outbox/inbox, entrega pelo menos uma vez, idempotência, fencing, retries, dead-letter, replay autorizado, fairness e reconciliação. As migrations e crashes foram validados em PostgreSQL 17 descartável; não existem consumers/jobs produtivos nem integrações Resend, R2, imports ou conectores.
- F10 implementou logging estruturado e sanitizado, tracing e métricas por contrato comum, propagação F9 v2 com parent/links, cardinalidade limitada sem IDs, health/live e readiness, lifecycle/shutdown de API e worker, catálogo local de alertas/runbooks e instrumentação F5/F7/F9/F11. Os 28 critérios foram satisfeitos localmente com exporters exclusivamente in-memory; não existem OTLP, Collector, backend, SIEM, credentials, thresholds produtivos, SLI/SLO, on-call ou rollout.
- F11 implementou metadata tenant-local, `ObjectStoragePort`, upload streaming com SHA-256, validação MIME/magic bytes, quarentena e scanning fail-closed, versões imutáveis, download temporário autorizado abstrato, integração F5/F7/F9, reconciliação e composição fail-closed. Os 30 critérios locais foram satisfeitos com double in-process sem equivalência com R2; não existem R2/S3, SigV4, URLs assinadas ou CORS reais, scanner real, residência UE comprovada, conta/DPA, encryption/lifecycle produtivos, retenção jurídica ou rollout.

### Classificação das diferenças desta reconciliação

- **Nova informação confirmada:** as fundações técnicas locais F10 e F11, respetivos gates completos e cobertura 28/28 e 30/30 documentada nos históricos concluídos.
- **Clarificação:** health, telemetria e armazenamento documental existem como contratos e implementação local; exporters in-memory e o double documental não provam providers, infraestrutura, operação ou rollout reais.
- **Informação ultrapassada:** referências a ausência total de observabilidade, health/readiness, armazenamento privado abstrato, upload seguro, scanning/quarentena e reconciliação documental.
- **Conflito que exige decisão:** nenhum nesta reconciliação; residência UE/DPA, providers reais, retenção jurídica e operação produtiva permanecem gates externos, não contradições documentais.

### Semântica da classificação

- `Satisfied`: requisito integralmente implementado e validado no âmbito que afirma.
- `Partially satisfied`: existe implementação ou enforcement local substantivo, mas falta parte funcional, integração real ou validação operacional exigida pelo próprio critério.
- `Not started`: existem apenas requisitos, decisões, interfaces ou preparação, sem implementação substantiva do comportamento pedido.
- `Blocked by external decision`: o comportamento não pode ser fechado sem decisão jurídica, operacional ou de infraestrutura ainda pendente.
- `Future integration gate`: implementação local considerada completa, dependendo apenas de integração futura. Nenhum critério recebe esta classificação nesta reconciliação; os critérios transversais continuam a exigir capacidade funcional, integração ou prova operacional adicional.

### Matriz `SEC-AC-*`

| Critério | Classificação | Evidência concreta | Limitação ou dependência restante |
| --- | --- | --- | --- |
| `SEC-AC-01` | Partially satisfied | F2: `backend/src/security/oidcClient.js`, `sessionAuth.js`, `sessionSecurity.js`; testes de segurança e gate descartável documentados em `context/history/f2-identidade-e-sessao-segura.md`. | O histórico mantém o critério `partial`; faltam rollout e validação no ambiente alvo. |
| `SEC-AC-02` | Partially satisfied | F2 valida callback OIDC e recusas sem sessão nos módulos e gates do histórico F2. | Falta evidência de configuração e rollout reais de Keycloak/Central. |
| `SEC-AC-03` | Partially satisfied | F2 implementa rotação de SID, cookie seguro, CSRF e origem; cobertura browser/nginx descartável no histórico F2. | Faltam configuração por ambiente e validação de staging/produção. |
| `SEC-AC-04` | Partially satisfied | F2 fornece assurance/step-up em `backend/src/security/assurance.js`; F5 aplica `RECENT_MFA` no policy engine sintético. | Não há catálogo produtivo de ações sensíveis nem integração nos endpoints administrativos reais. |
| `SEC-AC-05` | Partially satisfied | F3 implementa estado/versão de membership, revogação de sessão e revalidação por pedido; testes e gate PostgreSQL descartável no histórico F3. | O próprio fecho F3 mantém `partial`; faltam rollout e adoção integral nas rotas reais. |
| `SEC-AC-06` | Partially satisfied | F3 implementa seleção/troca server-side e rotação do contexto organizacional, com testes negativos. | Experiência final e rollout não estão completos; rotas Legacy não constituem prova universal. |
| `SEC-AC-07` | Partially satisfied | F5: `backend/src/authorization/policyEngine.js`, `authorizationService.js` e `productionAuthorization.js` implementam deny-by-default com catálogo produtivo vazio. | Não existem permissions/operações produtivas nem cobertura de cada endpoint protegido real. |
| `SEC-AC-08` | Partially satisfied | F5 implementa perfis estruturais, grants positivos, scopes, herança e SoD em catálogos/engine, com matrizes sintéticas. | Perfis têm zero permissions produtivas; grants, unidades, equipas e relações reais não estão persistidos ou integrados. |
| `SEC-AC-09` | Partially satisfied | F4/F5 têm testes A/B, IDOR e scope sobre recurso carregado; F11 aplica F5 aos fluxos documentais locais e testa isolamento A/B e IDOR. | Não há tenants provisionados, grants produtivos, provider documental real nem cobertura integral das operações funcionais. |
| `SEC-AC-10` | Partially satisfied | F3/F4 resolvem organização, binding e ligação exclusivamente no servidor em `tenantResolver.js`, `tenantBindingVerifier.js` e runtime associado. | Falta adoção integral por todos os canais e operação com tenants reais de F4.4. |
| `SEC-AC-11` | Partially satisfied | F4.2 implementa leases/pools isolados; F9 acrescenta envelope com organização confiável, worker separado, outbox/inbox, fencing, fairness e testes A/B/múltiplos workers em `backend/src/async/`, migrations `004_f9_async_execution`/`001_f9_async_execution` e testes F9. | Não existem tenants F4.4 nem consumers/jobs funcionais reais; caches, paginação e todos os canais não estão integrados end-to-end. |
| `SEC-AC-12` | Partially satisfied | F11 implementa autorização F5 por pedido, recurso carregado internamente, estado/scan elegíveis e capability de download abstrata com TTL de cinco minutos, `attachment`, `no-store`, `no-referrer` e single-range. | O double não valida R2/S3, SigV4, URL assinada, CORS, revogação ou comportamento HTTP reais; faltam residência UE, conta/DPA, credentials e rollout. |
| `SEC-AC-13` | Partially satisfied | F11 implementa upload streaming limitado, SHA-256, MIME/magic bytes, confirmação idempotente, quarentena fail-closed, estados fechados e reconciliação metadata↔objeto com dados sintéticos. | Não existem R2/S3 nem scanner reais; multipart/checksum do provider, órfãos reais e operação em tenants reais permanecem por validar. |
| `SEC-AC-14` | Partially satisfied | F9 implementa outbox/inbox, digests autoritativos, idempotência, fencing e redelivery; F11 acrescenta handlers idempotentes de scan/reconciliação, e F10 propaga contexto não autoritativo no envelope F9 v2 sem alterar o efeito. | Não existem jobs/consumers produtivos, tenants reais ou efeitos de providers integrados; a prova sintética não demonstra idempotência end-to-end de cada integração futura. |
| `SEC-AC-15` | Partially satisfied | F9 implementa retries limitados, dead-letter, replay reautorizado, fairness e reconciliação; F11 cobre jobs documentais locais e F10 instrumenta backlog, retry, dead-letter e reconciliação sem IDs. | Resend, R2, scanner, imports, conectores e outros consumers reais não existem; thresholds, operação multi-tenant e replay administrativo produtivo continuam gates futuros. |
| `SEC-AC-16` | Partially satisfied | F7 mantém evento fechado e ledger sanitizado; F11 evolui o catálogo com nove códigos documentais allowlisted; F10 usa signal codes fechados e não copia payloads de auditoria para telemetria. | Emissores/provider reais de R2, scanner, privacidade, retenção e operação não estão implementados; logging operacional não substitui o ledger F7. |
| `SEC-AC-17` | Partially satisfied | F7 implementa ledger source-local append-only/tamper-evident e classes de falha; F11 emite os nove eventos documentais nos fluxos locais e F10 instrumenta saúde/resultado sem duplicar o ledger. | Não há rollout do ledger em Central/tenants reais, grants produtivos de consulta, integração de providers ou WORM/HMAC/âncora; owner/superuser pode reescrever e recalcular a cadeia. |
| `SEC-AC-18` | Blocked by external decision | O contrato e o modelo futuro delimitam pedidos de titulares; não existe implementação operacional. | Exige política jurídica aprovada para titulares, legal hold, prazos, autoridades e cobertura de tenants/documentos. |
| `SEC-AC-19` | Blocked by external decision | Existem requisitos de preservação/minimização, sem workflow de anonimização completo. | Exige decisões jurídicas de retenção/reidentificação e integração com bases, R2, caches, snapshots e exports. |
| `SEC-AC-20` | Partially satisfied | F10 implementa logging NDJSON sanitizado, tracing e métricas comuns, propagação F9 v2, labels sem IDs e budgets de cardinalidade; testes adversariais cobrem segredos, PII, erros externos, overflow e instrumentação F5/F7/F9/F11. | Exporters são apenas in-memory; faltam OTLP/Collector/backend/SIEM, credentials, retenção, thresholds, SLI/SLO, on-call e validação com canais/providers reais. |
| `SEC-AC-21` | Partially satisfied | F2–F9 implementam fail-closed local; F10 acrescenta liveness, readiness `READY`/`DEGRADED`/`UNAVAILABLE` e lifecycle/shutdown de API/worker; F11 mantém storage/scanning fail-closed e reconciliável no double. | Keycloak/Central, R2, scanner, Resend, ledger e workers reais não têm modos degradados validados end-to-end em staging/produção. |
| `SEC-AC-22` | Partially satisfied | F5 implementa política temporal, aprovações distintas, MFA, scope e eventos de suporte em `backend/src/authorization/supportPolicy.js` e `audit.js`. | Concessões são sintéticas; faltam persistência autoritativa, administração real e integração operacional. |
| `SEC-AC-23` | Blocked by external decision | F4.1 preserva o modelo de tenant/gerações; F7 valida dump/restore sintético, cadeia, checkpoints, roles e partições após restart; F9 valida restart/redelivery em PostgreSQL 17 descartável. | Restore sintético não prova recuperação do tenant real nem R2/eventos dentro de objetivos; RPO/RTO, backups, regiões, autoridades e operação dependem de F4.4 e decisões externas. |

Contagem anterior: `Satisfied` 0; `Partially satisfied` 16; `Not started` 4; `Blocked by external decision` 3; `Future integration gate` 0.

Contagem após F7/F9: `Satisfied` 0; `Partially satisfied` 18; `Not started` 2; `Blocked by external decision` 3; `Future integration gate` 0.

Contagem após F10/F11: `Satisfied` 0; `Partially satisfied` 20; `Not started` 0; `Blocked by external decision` 3; `Future integration gate` 0. Alteraram classificação apenas `SEC-AC-12` e `SEC-AC-13`, de `Not started` para `Partially satisfied`; `SEC-AC-09`, `SEC-AC-14`–`SEC-AC-17`, `SEC-AC-20` e `SEC-AC-21` receberam evidência/limitações atualizadas sem mudança de estado.

### Trabalho ainda pendente

- F4.4: provisioning, lifecycle físico, operação e recuperação reais de tenants; F4.5: migração e adaptação UBI.
- Rollout e integração real do ledger F7 nos emissores Central/tenant, grants explícitos de consulta e export e operação/verificação contínua; HMAC/assinaturas/âncoras, WORM e SIEM continuam ausentes.
- Integração R2/S3 real, SigV4, URLs assinadas e CORS reais, scanner real, residência UE comprovada, conta/DPA e encryption/lifecycle produtivos; a fundação local F11 não valida semântica de provider.
- Consumers/jobs produtivos sobre F9 e integração real de Resend, R2, scanner, imports e conectores; sizing e operação multi-tenant permanecem pendentes.
- Privacidade, retenção, legal hold, anonimização e pedidos de titulares com validação jurídica.
- OTLP, Collector, backend de observabilidade, SIEM, credentials/secret manager, retenção de telemetria, thresholds, SLI/SLO, ownership, paging/on-call e validação dos modos degradados com fornecedores reais.
- Backups/restore produtivos, RPO/RTO e reconciliação integrada de base, R2 e eventos; os restores sintéticos F7/F9 não substituem esta prova.
- Rollout real de Keycloak/Central, secret management, staging, produção, carga, rollback e segurança operacional.
- Integração do motor F5 nos canais e operações funcionais reais à medida que forem aprovados; os catálogos incluem os quatro permissions de auditoria F7 e os sete permissions documentais F11, mas nenhum perfil recebe grants produtivos.

## Fora do âmbito desta feature

- implementação de código, SQL, migrations, infraestrutura ou configuração de fornecedores;
- escolha de bibliotecas, produto de cofre, SIEM ou plataforma de incidentes;
- testes de penetração e certificações formais;
- definição de prazos legais ou contratuais sem validação jurídica e comercial;
- identidade autónoma de instalações dedicadas, exceto a exigência de adaptadores sem fork.

## Decisões e gates ainda abertos

1. Tempos máximos e absolutos de sessão, estratégia de refresh e coordenação exata de logout/revogação com Keycloak.
2. Valor `SameSite`, mecanismo CSRF e política CORS definitivos por fluxo e domínio de deployment.
3. Regras de step-up/reautenticação recente por ação sensível.
4. Modelo de aprovação e procedimento de acesso de suporte de emergência.
5. Cofre de segredos, responsáveis, periodicidades de rotação e isolamento de credenciais Neon/R2/Resend/Keycloak.
6. Conta, endpoints jurisdicionais, residência UE/DPA e capabilities reais de R2/scanner; F11 já fixou localmente classes de bucket, keys opacas, TTLs e controlos de conteúdo, sem validar o provider.
7. Plataforma e prazos de retenção de auditoria, logs, exports, backups e classes de dados; matriz por contrato/organização.
8. RPO, RTO, disponibilidade, regiões/residência e frequência dos testes de recuperação.
9. Backend/SIEM, limiares produtivos, tempos de resposta, ownership, paging e canais de incidente; F10 já fixou severidades, catálogo e runbooks locais.
10. HMAC/assinaturas, gestão de keys, âncora externa, WORM, arquivo e prova operacional de imutabilidade da auditoria; F7 já fixou JCS-1/SHA-256 e hash chain local tamper-evident.
11. Catálogo final de ações sensíveis e pares de funções incompatíveis.
12. Processo de classificação, revisão e aprovação de schemas de extensões JSON.

Estado após a reconciliação: os pontos 3 e 4 foram resolvidos para o âmbito local por F5; o ponto 6 foi parcialmente fechado por F11 apenas quanto ao contrato e defaults locais; o ponto 9 foi parcialmente fechado por F10 quanto a severidades, catálogo e runbooks locais; o ponto 10 foi parcialmente fechado por F7 quanto a JCS-1/SHA-256, cadeia e checkpoints locais; o ponto 11 tem catálogos versionados, mas futuras operações exigem aprovação própria. Os pontos 1, 2, 5, as partes externas de 6–10 e o ponto 12 permanecem decisões ou gates; rollout e integração real dos restantes controlos também permanecem futuros. Nenhuma destas decisões autoriza produção por si só.

### Riscos residuais após F10/F11

- O ledger deteta alterações dentro do trust boundary testado, mas owner/superuser pode reescrever dados e recalcular a cadeia; não existe âncora independente.
- A fila, outbox/inbox e worker foram provados com jobs sintéticos; cada integração real precisa de idempotência, classificação de dados, autorização e reconciliação próprias.
- Central continua potencial ponto comum de indisponibilidade para coordenação; sizing, backpressure, thresholds e recuperação produtiva não foram validados.
- Exporters in-memory e alertas/runbooks locais não asseguram recolha, retenção, resposta a incidentes ou SLOs produtivos.
- O double documental não equivale a R2; assinatura, CORS, residência, scanner e lifecycle reais permanecem sem validação.
- Sem F4.4 não existe operação real de tenants; sem F4.5 não existe migração segura do piloto UBI.
- Retenção, legal hold, pedidos de titulares, R2 e backups continuam a impedir uma afirmação de prontidão operacional ou compliance.

### Próximo bloco recomendado

Selecionar a próxima feature independente de F4.4 a partir das lacunas ainda parciais, ou levantar as decisões externas de F4.4, sem antecipar residência, retenção jurídica ou rollout produtivo.

## Referências

- `context/project-overview.md`
- `context/architecture.md`
- `context/coding-standards.md`
- `context/decisions/multi-tenant-identity-and-data.md`
- `context/decisions/hosting-and-external-services.md`
- `context/decisions/future-data-model.md`
- `context/references/logical-data-dictionary.md`
- `context/references/current-implementation.md`
- `context/history/f2-identidade-e-sessao-segura.md`
- `context/history/f3-membership-session-context.md`
- `context/history/f4-tenant-contract-lifecycle.md`
- `context/history/f4-tenant-central-directory.md`
- `context/history/f4-tenant-runtime-access.md`
- `context/history/f43-tenant-schema-compatibility.md`
- `context/history/f5-functional-authorization.md`
- `context/research/f5-authorization-policy-decisions.md`
- `context/history/f7-append-only-audit.md`
- `context/research/f7-append-only-audit-decisions.md`
- `context/history/f9-async-execution-foundation.md`
- `context/research/f9-async-execution-decisions.md`
- `context/history/f10-operational-observability.md`
- `context/research/f10-observability-decisions.md`
- `context/research/f10-f9-trace-propagation.md`
- `context/history/f11-private-document-storage.md`
- `context/research/private-document-storage-decisions.md`
