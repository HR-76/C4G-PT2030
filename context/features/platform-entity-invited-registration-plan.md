# Plano técnico — convite e ficha de entidade portuguesa

Estado: Review — recortes A–E integrados no ambiente habitual. [Integração, backup/restauro, provas e limites atuais](platform-entity-registration-local.md). Convite e sessão limitada, rascunho português, contactos canónicos, conclusão, reserva fiscal e preparação/ativação foram validados primeiro em composição isolada; worker automático, resolvedor dinâmico e interface C4G estão ligados localmente. Contrato: [adesão restrita](platform-entity-invited-registration.md). Portugal/PT e EUR confirmados. Este plano substitui a sequência antiga em que a C4G preenchia a entidade antes de convidar o administrador. Próximo passo: rever o primeiro convite real com o utilizador.

## 1. Resultado e invariantes

C4G fornece apenas nome/email → convite limitado → identidade autenticada → ficha retomável → conclusão validada → criação e preparação da entidade → ativação de ORG_ADMIN → acesso normal. Sem signup público, aprovação manual adicional no caso normal, pagamento, envio de email ou novos motores/configuradores. Conflitos de identidade fiscal não concedem acesso e exigem intervenção C4G.

Uma identidade pode ter vários vínculos. Adesão pendente não é membership ativa; não permite catálogo nem funcionalidades operacionais a uma conta nova sem outro acesso legítimo. Outros vínculos ativos e papéis C4G existentes mantêm-se. A C4G gere dados administrativos de cliente; não ganha acesso às candidaturas ou ao conteúdo operacional privado.

## 2. Evidência atual e reutilização

| Evidência | Decisão técnica |
| --- | --- |
| `platformOnboarding/contracts.js` e `service.js` exigem entidade e criam organização logo no primeiro comando | Não chamar com nomes/NIF fictícios. Novo agregado pré-entidade; criar organização apenas após concluir a ficha. |
| `platformOnboarding/memberService.js`, `memberWorker.js` e migração Central 021 | Preservar criação de utilizadores em entidades existentes; não reutilizar este agregado para adesão de entidade. |
| `keycloakAdapter.js`, `oidcActivationAdapter.js`, `activationHttp.js` e módulo `dev/keycloak/manual-activation/` | Reutilizar componentes de identidade, PKCE, state/nonce e verificação antes de guardar password. Novo contexto de adesão, sem exigir organização READY nem ativar grants prematuramente. |
| `postgresProvisioner.js` e prova real isolada | Reutilizar provisionamento idempotente, journal privado e publicação do diretório. Composição local operacional para novas bases ainda precisa de implementação. |
| `public.organization` | Fonte atual de nome legal, nome apresentado, tipo, moeda, estado e datas; manter. |
| `organizationDirectory/repository.js` e tenant 025 | `organization_card` contém descrição, email e website, hoje editáveis juntos e com revisão/recibo no tenant. A integração exige migração explícita do email/website, não duas fichas independentes. |
| `organizationDirectory/composition.js` | Já agrega identidade central com perfil privado. Adaptar leitura para a ficha central sem expor dados operacionais à C4G. |
| `organization_membership` | Já possui `created_at` e `activated_at`; reutilizar, sem confundir com data de criação da conta. |
| `scripts/localPlatform/runtime.js` | Diretório real já registado, mas credenciais API ainda configuradas para a entidade inicial. Criar uma segunda base não basta: resolver/publicar as novas credenciais privadas antes da ativação. |

## 3. Fontes canónicas e integração com o perfil

Proposta técnica deste plano, a concretizar em migrações aditivas:

| Dados | Fonte após adoção | Leitura/edição |
| --- | --- | --- |
| Identidade global, email de login e password/MFA | Central para identidade; Keycloak para credenciais | Nunca editar através da ficha da entidade. |
| Nome legal/apresentado, tipo, PT, EUR, estado | Organização central + extensão administrativa | C4G e ficha autorizada; nomes existentes preservados. |
| NIF, morada, código postal, localidade, sigla | Extensão central de ficha da entidade | Mesmo registo para Administração C4G e Perfil da entidade. Identidade fiscal não alterável por um PUT genérico após conclusão. |
| Email institucional, telefone e website | Extensão central de ficha da entidade | Fonte única; o perfil passa a editar estes contactos por endpoint central autorizado. |
| Telefone/cargo profissional do administrador indicado | Contacto central associado ao vínculo/adesão | Não alterar perfil global nem apresentar o primeiro administrador como administrador atual para sempre. Destinatário autenticado fica imutável nesta adesão. |
| Número declarado de trabalhadores e data de referência | Extensão central de ficha administrativa | Dado declarado pelo cliente, sem gerar assertions F13, classificações ou matching automaticamente. |
| Descrição, competências, pessoas, unidades, candidaturas | Tenant, como atualmente | Mantêm permissões e fontes existentes. |
| Ficha submetida originalmente | Snapshot imutável de adesão central | Histórico identificado como Dados na adesão, nunca apresentado como contacto atual. |

O backend compõe a vista, com revisões distintas para identificação/contactos centrais e descrição privada. A interface terá ações separadas para guardar Contactos e Descrição; não simular uma transação atómica sobre duas bases. Alterar contactos não pode apagar descrição ou modificar pessoas.

### Transição dos contactos existentes

1. Inventariar email/website atuais por organização em operação administrativa explicitamente limitada a estes campos, com binding físico verificado. Não consultar/exportar outros dados tenant.
2. Preparar cópia central fiel, com proveniência e recibo por organização/revisão. Valores divergentes no destino exigem reconciliação; nunca aplicar last-write-wins nem substituir por vazio.
3. Controlar escrita concorrente durante a passagem: bloquear brevemente a edição dos contactos dessa entidade, comparar novamente revisão/digest e só então publicar o marcador de fonte central. Se houver falha, continuar na fonte anterior com estado de transição explícito; retoma idempotente.
4. Depois da publicação, GET usa os contactos centrais; o endpoint antigo não aceita editar email/website. Durante compatibilidade, pode aceitar os valores canónicos inalterados para editar apenas a descrição; valor divergente é recusado com orientação para o novo endpoint.
5. Preservar colunas/valores legados para histórico, sem leitura de fallback silenciosa quando a fonte central falha. Nenhuma sincronização bidirecional. A descrição mantém o seu recibo/revisão e autoridade tenant.
6. Organizações existentes podem continuar sem NIF/morada/contagem completos. A obrigação aplica-se à nova adesão; não bloquear ou inventar valores nos registos antigos.

## 4. Modelo central proposto

Nomes abaixo conceptuais; DDL definitivo e numeração de migrations são fixados na implementação, verificando o head real (último incremento conhecido: Central 021, tenant 030).

- `entity_admission`: id, requested_by, recipient_name/email, expected_global_user_id/issuer/subject quando reconciliados, estado, revisão, chaves de intenção, datas, eventual organization_id e operation_id. Uma adesão conclui no máximo uma organização; nenhuma FK a organização obrigatória no início.
- `entity_admission_invitation`: emissão, digest do segredo, validade, revisão, substituição/revogação, troca vinculada ao browser e aceitação. Segredo apenas na emissão; nunca guardar em claro, localStorage, logs ou histórico de auditoria.
- `entity_admission_draft`: adesão, revisão, campos permitidos e preenchimento parcial, saved_at/by. Exclusivo à identidade aceite e C4G autorizada. Snapshot de conclusão congelado e digest estável após submit.
- `organization_registration`: ficha atual central e revisão; NIF normalizado textual com país PT, país de sede PT e moeda EUR impostos no servidor, contactos e restantes dados declarados. Restrições de completude apenas para novas adesões concluídas.
- `organization_fiscal_identity`: reserva/associação única por PT + NIF, ligada à adesão/organização. Unicidade cobre organização suspensa/arquivada e preparação concorrente. Uma falha técnica não liberta a reserva para criar outra entidade automaticamente.
- Recibos de intenção e progresso, auditoria e mecanismo durável de preparação reutilizam os padrões existentes. Guardar phase/lease/fence/resultado sanitizado, sem credenciais nas tabelas funcionais.

Sem apagar migrations 020/021 ou reescrever dados antigos. Registo de eventos e protocolo SQL fechado ganham apenas operações necessárias, com checksum/fingerprints/preflight e migrações testados. Não usar `valid_from` ou `updated_at` como substitutos de criação/ativação.

## 5. Estados e concorrência

Separar convite, ficha, preparação técnica e acesso. Rótulos de UI derivam dos estados persistidos, não criam um segundo motor no frontend.

| Transição | Condição e resultado |
| --- | --- |
| Criar adesão → convite pendente | C4G atual; nome/email válidos; requestId estável. Sem organização nem acesso operacional. |
| Convite pendente → preenchimento | Aceitação OIDC pela identidade esperada, ligação válida e não revogada. Consumo definitivo e direito limitado de retoma persistidos atomicamente. |
| Preenchimento → preenchimento | Guardar com expectedRevision; incompletude permitida, valores presentes inválidos recusados. |
| Preenchimento → preparação | Submit integral válido, identidade/convite/autoridade revalidados, NIF reservado e snapshot imutável. Criação única da organização PROVISIONING e membership pendente, com IDs estáveis. |
| Preparação → preparação | Retoma de falha com mesmo snapshot/IDs e fence; nunca repetir criação com intenção diferente. |
| Preparação → concluída | Tenant, credenciais, schema/binding e projeções comprovados; ativação central atómica de organização, membership, grants e auditoria. |
| Pendente/preenchimento/preparação → cancelada | Revogação autorizada C4G. Worker tardio não pode ativar após cancelamento; preservar recursos e recibos. |

Convite expirado pode ser substituído antes da aceitação. Após aceitação, expiração original não bloqueia a ficha. Depois de cancelada, este primeiro recorte não oferece reabertura automática: qualquer nova intenção exige reconciliação C4G, sobretudo se houver organização/reserva já criada. Depois de concluída, suspensão usa o percurso de acessos/entidades, não revogação de convite consumido.

Revogar/cancelar versus aceitar/submit/ativar deve ser serializado pelo coordinator central e revisões. Idempotência vinculada ao ator, adesão, operação e digest; replay reautoriza o acesso atual. Dois convites com mesmo NIF concorrem na restrição única, não num teste apenas no frontend. Uma conta existente nunca é adotada por coincidência de email não reconciliada.

## 6. APIs propostas

Todas as mutações exigem CSRF, sessão/autoridade apropriada, contrato fechado, limites, idempotência e auditoria. APIs não recebem roles C4G, tenant IDs técnicos, credenciais, nomes de bases ou URLs de callback arbitrários do cliente.

| Superfície | Operações |
| --- | --- |
| `/api/admin/directory/admissions` | GET lista paginada; POST criar com `{name,email,requestId}`. Só C4G. |
| `/api/admin/directory/admissions/:id` | GET estado/datas; comandos dedicados emitir/substituir ligação, cancelar e retomar preparação quando autorizado. |
| `/api/admissions/mine` | GET adesões da identidade autenticada; sem pesquisa por email ou leitura de outro destinatário. |
| `/api/admissions/:id/draft` | GET e PUT `{expectedRevision,requestId,fields}`; apenas titular aceite ou gestão C4G explícita/auditada. |
| `/api/admissions/:id/submit` | POST com revisão e requestId, sem edição simultânea da ficha; servidor valida snapshot persistido. |
| `/api/admissions/:id/status` | GET progresso e ações permitidas, sem segredos ou detalhes de infraestrutura. |
| `/api/organization-directory/registration` | GET ficha central do contexto autorizado; PUT dedicado aos contactos mutáveis com revisão. Não editar NIF/país/titular através deste comando. |
| `/api/admin/directory/entities/:id/registration` | GET mesma fonte de ficha; comandos administrativos separados quando necessários. Nenhum acesso implícito ao tenant privado. |

Ponte de aceitação isolada por propósito ADMISSION, com contexto/callback próprios ou dispatcher validado no servidor. Nunca permitir que ID/token de adesão seja interpretado como convite de membership ou vice-versa. Reutilizar PKCE/nonces/associação ao browser. O retorno OIDC da aceitação limitada não deve apresentar Acesso à entidade ativado; encaminha para Completar ficha e estabelece a sessão normal pelo fluxo existente, sem forjar uma sessão.

Respostas com códigos estáveis: campo inválido, revisão desatualizada, convite indisponível, adesão indisponível, identificação fiscal exige verificação, preparação por confirmar. Não revelar a entidade encontrada ao convidado. Dados sensíveis só após autenticação e autorização; `no-store` nas respostas.

## 7. Sessão limitada e autorização

Adicionar ao contexto de sessão uma projeção de adesões elegíveis resolvida no servidor. Não conceder permissões operacionais por um campo enviado no browser ou por uma role OIDC genérica.

Para identidade criada apenas por adesão, sem membership ativa nem papel C4G: permitir sessão, logout, segurança da conta e APIs da própria adesão; recusar todo o resto, incluindo catálogo central. Verificar os endpoints normalmente acessíveis com mera autenticação, não apenas rotas tenant. Contas sem adesão criadas por outros percursos não devem mudar silenciosamente de comportamento.

Identidade com outros vínculos mantém catálogo e funcionalidades autorizadas desses vínculos. Adesão não aparece como organização ativa no seletor. Após ativação, recarregar a autoridade e selecionar a nova organização pelo percurso existente. Sem alterar permissões de técnicos ou gestão de acessos já instalada.

Manter a edição de contactos por administrador/gestor compatível com `ORGANIZATION_DIRECTORY_EDIT`, hoje usado pelo perfil. C4G usa autoridade de plataforma separada; técnico sem essa permissão não recebe edição. Para identidade fiscal/dados de constituição não introduzir edição genérica nesta fatia; necessidade de correção após conclusão é tratada por comando administrativo específico em incremento próprio.

## 8. Provisionamento e recuperação

API não recebe credenciais DDL/Keycloak master. Adaptadores de identidade continuam num worker com conta técnica; provisionamento de bases usa processo/credenciais próprios e operações fechadas, sem ampliar o worker de utilizadores atuais para comandos SQL arbitrários. Journal privado conserva IDs/segredos de recursos já criados; nunca recriar ou eliminar automaticamente após resposta perdida.

Submissão grava intenção e trabalho durável na Central, atomicamente. Execução usa coordenação/fila existente e retoma por estado; não depender de promessa em memória do pedido HTTP. Adaptar o provisioner já testado para consumir apenas o snapshot confiável desta adesão, sob revalidação de estado/fence.

Publicar credenciais novas no resolvedor privado por `credentialRef` antes de marcar a operação pronta. O runtime habitual deixa de depender de uma única credencial literal; resolução falha fechada para referências desconhecidas. A composição isolada deve provar API e worker ligados à nova base e sem fallback para a base inicial. Recibos e ficheiros privados nunca entram no frontend.

Projeções: pessoa/ligação ao primeiro administrador, ficha e metadados necessários. Colisão com ficha de pessoa existente exige associação explícita, não adoção por email. Depois da evidência física, uma transação central revalida cancelamento/autoridade, ativa organização/membership, atribui grants do perfil fixo e grava auditoria. Falha na auditoria mantém acesso fechado. Crash depois de criar base ou password não apaga nem redefine nada.

## 9. Frontend e experiência

- C4G: lista Convites de novas entidades separada das entidades ativas; formulário nome/email, revisão, ligação manual e acompanhamento. Detalhe mostra dados e datas com ações server-side.
- Convidado: `/adesao/:id`, quatro passos da ficha, guardar/sair, erro junto ao campo, revisão, submissão e estado de preparação. PT/EUR fixos e visíveis. Sem guardar PII ou segredo no armazenamento persistente do browser.
- `AuthContext`, navegação pós-login e guards de `App.jsx`: retoma limitada quando necessária, preservando outros vínculos. Sem signup nem redirecionamentos em ciclo.
- `OrganizationProfile.jsx`: ficha/contactos centrais e descrição privada com ações de gravação distintas. Componentes de campos/revisão partilhados com adesão e ficha C4G, respeitando capacidades e dados expostos a cada perfil.
- Listas de utilizadores passam a distinguir criação da conta, criação do vínculo e ativação. Datas sem evidência são Não disponível, não data da migração. Instantes UTC e apresentação com fuso; data de referência dos trabalhadores continua data civil.

## 10. Entregas e validação

| Entrega | Saída verificável | Prova obrigatória |
| --- | --- | --- |
| A — Contratos e persistência | Migrações de adesão/ficha/identidade fiscal, fontes canónicas e contratos HTTP | Upgrade sobre Central/tenant existentes, checksums/preflight, backup/restauro, dados antigos intactos, reserva NIF concorrente e falha de auditoria. |
| B — Convite e acesso limitado | C4G cria nome/email, aceita/retoma sem entidade | Keycloak real, conta nova/existente, propósito errado, revogação/expiração/replay, novo utilizador recusado no catálogo/API e vínculos antigos preservados. |
| C — Ficha e integração | Quatro passos, rascunho/revisão, contactos únicos no perfil | Validações PT, zero trabalhadores, data futura, duas abas/revisões, migração concorrente de email/website, sem divergência nem perda de descrição. |
| D — Preparação e ativação | Segunda entidade operacional após conclusão | Duas bases reais, novos secrets resolvidos privadamente, falhas após cada fase, resposta perdida, cancelamento em corrida, grants/auditoria atómicos, tarefas existentes preservadas. |
| E — Revisão habitual | UI C4G e convidado integradas e datas visíveis | Build, testes backend, browser 1440/390/teclado, login original sem signup, backup/restauro e conferência local. Não usar contas fictícias no ambiente habitual para demonstrar sucesso. |

Testes de NIF/postal validam regras locais com casos válidos/inválidos e não alegam consulta a registo oficial. Confirmar algoritmo/cobertura em fontes oficiais antes de implementar o validador; evitar listas restritivas de prefixos sem evidência. Telefone do administrador pode ser estrangeiro, email não precisa de `.pt`. NIF/país/tipo/moeda/revisão e capabilities adulterados devem ser recusados no servidor.

Nenhum teste unitário substitui a composição real nem a revisão visual. Não executar importações externas, alterar passwords existentes, enviar emails, ativar faturação ou publicar o serviço como parte desta entrega.

## 11. Ordem imediata e definição de pronto

Iniciar por A+B em ambiente isolado: persistência pré-entidade, convite de propósito próprio e sessão limitada. Prosseguir para C+D, ligar UI e só depois instalar no ambiente habitual. Não montar o formulário sobre serviços atuais assumindo que já suportam adesão sem organização.

A implementação conserva as fronteiras e provas acima; o estado do recorte isolado consta da revisão ligada no início. SMTP, recuperação por email, faturação, anexos/antivírus, países estrangeiros e domínio público continuam pendentes nos seus próprios incrementos.
