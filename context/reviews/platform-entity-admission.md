# Convite pré-entidade e sessão limitada — prova isolada

Estado: Review / prova isolada PASS, 18/10/2026. Recorte de convite e sessão limitada do [plano técnico](../features/platform-entity-invited-registration-plan.md); não representa a conclusão de toda a persistência da ficha/reserva fiscal da entrega A nem a instalação habitual.

## Implementação

- `backend/src/entityAdmission/`: contrato fechado nome/email/requestId; criação C4G idempotente, preparação de identidade retomável, convite de 24 horas, substituição, cancelamento e aceitação autenticada. Sem criar organização, membership ou grants.
- `022_entity_admission`: tabelas próprias, unicidade da intenção e do convite aberto, estado/datas, digests dos segredos, SQL fechado e eventos F7. Manifesto com checksum e fingerprints medidos em PostgreSQL descartável. Migrações 020/021 preservadas. Aplicação da 022 exclusivamente nas bases de teste neste incremento.
- Reutilização dos adaptadores Keycloak/OIDC com propósito ADMISSION, binding sem organização fictícia, cookie e callback `/api/admission-activation` próprios. O worker de identidade deste propósito não carrega o adaptador de projeção tenant.
- `/api/admin/directory/admissions`: criar/consultar/preparar/emitir/cancelar, apenas C4G. `/api/admissions/mine`: contexto autenticado e adesões aceites do próprio titular. API integrada na composição por dependência explícita, ausente do arranque habitual.
- Fronteira de sessão antes dos routers operacionais. Conta criada pela adesão sem outro vínculo ativo nem papel C4G só usa sessão, segurança, logout e a própria adesão. Catálogo, dados de entidades e endpoints futuros são recusados por omissão. A origem de adesão continua registada depois de cancelamento; cancelar não desbloqueia o catálogo.
- Identidade com memberships válidas conserva o acesso anterior. Adesões nunca aparecem no seletor de organizações. Não mudar silenciosamente contas sem origem de adesão.
- Aceitação e auditoria atómicas. Revalidação depois da prova OIDC impede cancelamento concorrente de ser ultrapassado. Expiração do convite não apaga o direito autenticado de retomar uma adesão já aceite.

## Validação

- 74 testes focados PASS: contratos/HTTP, adaptadores, auditoria, manifesto/preflight, composição, diretório, configuração/identidade local e readiness. Os testes que usam subprocessos foram executados fora da restrição de spawn da sandbox, sem alterar as asserções.
- `node --check` nos módulos de runtime e harness alterados PASS; build frontend PASS, sem alterações ao código frontend neste recorte.
- Prova de serviço PostgreSQL: 10 grupos PASS, incluindo emissão, substituição, replay, destinatário/browser incorretos, resposta de identidade perdida, falha de auditoria, cancelamento concorrente, expiração, revogação do emissor/sessão, memberships anteriores e separação de propósitos. Evidência em `output/playwright/c4g-admission/service-verification.json`. Regressão do serviço de utilizadores adicionais: 12 grupos PASS em `output/playwright/c4g-member-onboarding/service-verification.json`.
- Prova real PostgreSQL/Keycloak/browser PASS: conta nova com password nativa e sessão OIDC limitada; identidade existente aceita a adesão preservando password, catálogo e dois vínculos; cancelamento antes da gravação da password, recusa de CSRF e de criação por não-C4G, ausência de organização/grants e logout comprovados. [Resultado](../../output/playwright/c4g-admission/real-verification.json).
- O harness repetiu primeiro os 12 grupos originais de onboarding e o percurso real de utilizadores adicionais, ambos PASS; candidaturas, tarefas e isolamento preservados. Porta de bridge isolada 5295, admitida apenas no realm descartável `c4g-manual-proof`, sem parar o serviço existente na porta 5285. Falhas de ensaio anteriores (colisão de porta, allowlist do SPI e classificação HTTP de CSRF) corrigidas e prova repetida integralmente.
- Capturas de confirmação conferidas em [1440](../../output/playwright/c4g-admission/accepted-1440.png) e [390](../../output/playwright/c4g-admission/accepted-390.png): texto português, cores C4G, sem overflow; não são o formulário da ficha ainda pendente.

## Limites e instalação futura

Sem formulário da ficha, rascunho dos dados portugueses, migração de email/website, criação do tenant ou ativação do primeiro administrador de uma nova entidade nesta fatia. Sem SMTP nem registo público. O cliente habitual `frontend/src/api/api.js` mantém o contrato atual de utilizadores; os novos endpoints são exercitados pelo harness isolado, ainda sem ligação ao frontend habitual.

O código conhece a migração 022. A composição sem adesões continua a aceitar Central 021; a composição com adesões exige 022, e qualquer 022 presente tem sempre o checksum validado. Antes de instalar o novo percurso no ambiente habitual é necessário atualizar a base central com backup/restauro e ligar explicitamente a fronteira de sessão. Não executar migrações automaticamente nem considerar a base habitual atualizada por estes testes. Não alterámos configuração, contas ou bases habituais para provar o recorte. Uma consulta de diagnóstico ao runtime habitual devolveu `/health/live` 200 e `/health/db` 503; a prova desta entrega é isolada e não certifica a saúde desse runtime, que não foi reiniciado nem reconfigurado.

Próximo passo: implementar o rascunho e formulário obrigatório da ficha portuguesa, mantendo a sessão limitada até à preparação e ativação efetivas da entidade.
