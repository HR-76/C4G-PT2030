# Ficha portuguesa — rascunho e formulário

Estado: Review / prova isolada PASS (18/10/2026). Recorte C do plano de adesão restrita; não instalado no ambiente habitual.

## Contrato e aceitação

- Rascunho persistente por adesão aceite, exclusivamente do titular; sessão e cancelamento revalidados em cada leitura, gravação e replay.
- PUT substitui os campos editáveis com revisão esperada e intenção idempotente. Campos vazios são permitidos no rascunho; valores presentes inválidos são recusados. Identidade do administrador vem do convite, nunca do browser.
- Validação integral e por passo no servidor; Portugal/PT e EUR fixos; zero trabalhadores válido; datas civis reais não futuras. Não criar entidade, membership ou acesso operacional ao guardar/validar.
- Quatro passos com revisão, erros por campo, resumo, retoma, guardar/sair e indicação apenas da última gravação confirmada. Nenhuma ficha em localStorage/sessionStorage.
- Integração com o perfil através de uma ficha administrativa central, contactos canónicos e descrição privada preservada. A transição dos contactos antigos exige prova explícita de concorrência; não instalar migrações no ambiente habitual neste recorte.
- Provisionamento e ativação finais pertencem ao recorte D. Não apresentar validação como entidade ativa.

## Apresentação antes da implementação

Paleta: petróleo #075b59, verde #39751f, fundo #f4f7f6, branco #ffffff, texto #173431, erro #a32626. Tipografia: herdar a fonte da aplicação; títulos 26/20px, campos 15px. Formulário com largura máxima 1000px, duas colunas no desktop e uma em mobile, labels visíveis e ações no rodapé.

```text
C4G                         Guardar e sair
Completar ficha da entidade · Por completar
1 Identificação | 2 Morada | 3 Administrador | 4 Rever
[ campos obrigatórios * em duas colunas ]
Última gravação confirmada     Voltar | Continuar
```

Princípios: densidade legível, contraste, estado explícito, foco no primeiro erro, sem navegação operacional para a sessão limitada.

## Validação do NIF

O [guia oficial PRODERAM, páginas 2–3](https://proderam2020.madeira.gov.pt/images/documentos/Candidaturas/ACAPORAMA/Guia_de_validacao_M19.2.1.i_04bf8.pdf) documenta o módulo 11 com pesos 9 a 2 e controlo zero para restos 0/1. Usar apenas o algoritmo, sem importar a lista histórica de prefixos. A [AT confirma os nove dígitos e a gama 3](https://info.portaldasfinancas.gov.pt/pt/destaques/Paginas/Nota_Informativa_20190704_NIF_Gama.aspx). Esta validação não consulta nem comprova existência fiscal.

## Implementação

- Central 023: `entity_admission_draft` e recibos por adesão/intenção, sem FK obrigatória a uma organização. Alterações e auditoria na mesma transação; revisão inicial zero; cancelamento/sessão revalidados antes de qualquer replay.
- Central 024: `organization_registration` e recibos dos contactos. Fonte administrativa central única; identificadores legais continuam em `organization`; a descrição e os dados operacionais permanecem no tenant.
- APIs do titular: GET/PUT `/api/admissions/:id/draft`; POST `/api/admissions/:id/validate`, com `step` 0–2 ou null para validação integral. Campos de país, moeda e identidade do convite são imutáveis e não são aceites como input. Sessão limitada só recebe estas rotas exatas e as rotas de conta já autorizadas.
- `AuthContext` recebe projeção de adesões do servidor. Uma sessão exclusivamente de adesão retoma `/adesao/:id`, sem seletor de organização nem acesso ao catálogo. A confirmação nativa oferece ligação OIDC com retorno à ficha, também para identidades com outros vínculos.
- `RegistrationFields`/`RegistrationSummary` partilham a apresentação da ficha e do perfil. O botão atual é **Validar e guardar ficha**: não simula a conclusão/provisionamento ainda pendentes.
- Perfil: PUT `/api/organization-directory/registration/contacts` altera apenas email/telefone/website, com revisão central e autorização F5 `ORGANIZATION_DIRECTORY_EDIT` atual. PUT `/api/organization-directory/description` não transporta contactos e mantém revisão/recibos privados. O PUT antigo recusa contactos divergentes depois da adoção.
- `contactMigration.migrateContacts` é um adaptador administrativo explícito, sem endpoint público. Verifica binding físico/schema do tenant, adquire o mesmo lock usado pelas edições do perfil e lê apenas email/website/revisão; a publicação central é atómica com proveniência/digest e auditoria C4G. Não altera colunas antigas. Se a resposta se perder após a publicação, a retoma não recopia os contactos atuais por cima dos centrais. Revisões decorrentes apenas de alterações da descrição não provocam conflito; contactos legados divergentes provocam.
- A composição é opt-in através de `admissionService` e `enableRegistration`. A ficha é construída com o mesmo coordinator usado pela autorização do perfil, evitando transações concorrentes aninhadas sobre o mesmo lock de autoridade. Nenhuma configuração habitual foi alterada; antes de qualquer adoção habitual, todos os processos que escrevem no perfil têm de usar a composição com fonte central. Não é suportada uma implantação mista com escritores legados sem esta verificação.

## Validação concluída

60 testes focados de backend, 25 de frontend e oito grupos de PostgreSQL PASS. Build frontend, sintaxe JavaScript e verificação de whitespace dos ficheiros deste recorte PASS. Capturas de identificação, administrador e revisão conferidas em 1440/390 px, sem overflow; perfil existente e formulário separado de contactos conferidos em desktop.

Prova integrada `member-real-gate.ps1 -SkipBuild -Admission` terminou com código zero: Keycloak, PostgreSQL e Chrome reais e descartáveis; convite e reautenticação nativos, sessão limitada, rascunho/retoma, validação completa, regresso da segurança da conta, contactos canónicos no perfil, revogação antes de replay, concorrência na adoção e preservação das tarefas. A interface apresentou os contactos guardados e a persistência foi confirmada independentemente no PostgreSQL. Pedidos adicionais de leitura concorrentes com alterações de autoridade podem devolver os conflitos previstos `AUTHORITY_STALE`/`AUTHORITY_WRITE_PENDING`; não são tratados como gravação perdida nem contornam autorização.

Evidência em `output/playwright/c4g-registration/{service,browser,profile}-verification.json`, `output/playwright/c4g-admission/real-verification.json` e `output/playwright/c4g-onboarding-real/verification.json`. Os recursos descartáveis foram limpos pelo ensaio. Nenhuma migração, conta ou configuração habitual foi alterada.

## Limite do recorte

Este recorte C não inclui submit ou provisionamento. A ligação final dos dados da nova adesão à ficha central foi implementada e validada posteriormente no [recorte D](platform-entity-registration-completion.md), incluindo snapshot, reserva PT+NIF, organização/membership pendentes e preparação/ativação. O contrato de dados, a apresentação partilhada e a edição canónica dos contactos do perfil ficam neste recorte C. Sem registo público, SMTP ou alterações às entidades habituais.
