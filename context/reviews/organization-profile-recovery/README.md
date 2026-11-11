# Perfil da Organização C4G — evidência local

2026-10-17. Estado **Complete — recorte local**. Contrato: [estrutura e pessoas](../../features/organization-directory-recovery.md). Implementação e revisão local concluídas, incluindo a correção dos dois atalhos solicitada pelo utilizador; não constitui validação de produção nem ativação dos serviços editoriais.

## Resultado disponível

Em [Perfil da organização](http://localhost:5189/perfil-organizacao), a entidade selecionada tem três separadores:

- **Organização**: identificação central, descrição, email de contacto e website. O nome legal e o tipo continuam sob administração central.
- **Departamentos / Unidades**: criação, renomeação, mudança da unidade superior e hierarquia visível, sem nomenclatura universitária obrigatória.
- **Pessoas**: nome obrigatório, email/função opcionais, afetação direta à organização ou a várias unidades com uma principal, edição/inativação, pesquisa, filtros e paginação de 25 registos.

Registar uma pessoa não cria conta, membership ou acesso. A estrutura não concede permissões por herança. A edição exige grants explícitos; a consulta não apresenta controlos de edição. A ficha não exige publicação editorial ou matching.

## Reutilização e alterações mínimas de dados

| Elemento | Implementação |
|---|---|
| Organização e acesso | Identidade/memberships centrais, sessão, seletor de organização, engine de autorização e coordinator existentes. |
| Departamentos/unidades | `organizational_scope.scope` e serviço preparado [organizationalScopes/repository.js](../../../backend/src/organizationalScopes/repository.js); as operações novas chamam esse serviço. Não existe uma segunda árvore. |
| Pessoas e ficha | [Migration 025](../../../backend/database/tenant/migrations/025_organization_directory.up.sql) acrescenta quatro tabelas no schema existente: `organization_card`, `person`, `person_unit`, `directory_receipt`. O legado tinha professores globais, inadequados ao isolamento pretendido. |
| Interface | [OrganizationProfile.jsx](../../../frontend/src/pages/Organization/OrganizationProfile.jsx), reutilizando classes/tokens/formulários/tabelas responsivas do frontend existente e navegação C4G. Rotas editoriais existentes preservadas em `/perfil-organizacao/editorial` e respetivos caminhos específicos. |
| API | [Rotas](../../../backend/src/routes/organizationDirectoryRoutes.js), [contratos](../../../backend/src/organizationDirectory/contracts.js), [repositório](../../../backend/src/organizationDirectory/repository.js) e [composição](../../../backend/src/organizationDirectory/composition.js), montados na aplicação F12 existente. Cliente centralizado em [api.js](../../../frontend/src/api/api.js). |

A extensão usa o runtime tenant existente; não cria outra base ou ligação para o diretório. A migration é aditiva, sem down automático que elimine pessoas/histórico. Não reativa consultas globais de professores do piloto nem importa esses dados.

## Garantias verificadas

- Contexto organizacional capturado no servidor. `X-C4G-Organization` é apenas a expectativa do cliente, comparada com esse contexto; uma mudança de organização recusa o envio antigo.
- `organization_directory.read/edit` explícitas; operações de unidades acumulam os grants específicos existentes. Base roles não recebem capacidades implícitas.
- RLS forçado, chaves compostas por organização, SQL parametrizado, revisão concorrente, recibos idempotentes e auditoria crítica na transação.
- Afetações apenas a unidades ativas da mesma organização; uma principal quando há afetações; nenhuma quando a pessoa está diretamente na organização. Limite explícito de 50 afetações e 1 000 unidades na árvore consultada.
- Guarda de arquivo impede arquivar pelo serviço existente uma unidade com pessoas associadas. A interface desta entrega não oferece arquivo de unidades.
- Sem eliminação de pessoas; inativação conserva registo. Recibos guardam os resultados anteriores das alterações. Eventos de auditoria não incluem os campos pessoais.
- Respostas tardias são ignoradas após mudança de organização. Envio de resultado incerto pode ser repetido explicitamente com a mesma intenção depois de recarregar; não há repetição automática nem duplicação. Pendências locais são separadas por pessoa/organização e limpas no logout/401.

## Verificações efetivamente executadas

| Prova | Resultado e alcance |
|---|---|
| Backend direcionado | **103/103 PASS**: `organizationDirectory`, `f13P1OrganizationalScopes`, `f5AuthorityCommitGuard`, `f42TenantLeaseExecutor`, `f43TenantManifest`, `f43TenantPreflight`, `f7AppendOnlyAudit` e `productionCompositionParity`, em `backend/test/`. |
| Frontend | Suite **129/129 PASS** antes de acrescentar os dois testes de fila. Após a alteração final, **17/17 PASS** em OrganizationProfile, OrganizationRequestQueue, OrganizationSelector e C4gShell, incluindo os dois novos testes. Não se apresenta isto como nova execução integral de 131 testes. |
| Build/sintaxe | `npm run build` no frontend PASS. `node --check` dos 17 ficheiros backend alterados PASS; composição final e scripts de browser/ativação reconferidos. `git diff --check` no recorte rastreado PASS. |
| Migration PostgreSQL 17/18 | Aplicação em bases de prova isoladas; mesmo fingerprint final nas duas versões. Rollback transacional da prova restaura o schema anterior. Constraints diferidas, principal, estado da unidade, imutabilidade/revisão e RLS provados por [integrity.js](../../../test/integration/organization-directory/integrity.js). |
| HTTP integrado | [flow.js](../../../test/integration/organization-directory/flow.js): árvore/ciclo, edição, pessoas, filtros/inativação, grants assimétricos, A/B, expectativa de organização, CAS/idempotência, falha de auditoria com rollback e confirmação de COMMIT perdida para pessoa **e unidade** recuperada por recibo. Sem conta criada; leituras de catálogo/candidaturas preservadas. |
| Chrome com dados sintéticos e PostgreSQL real | [browser.js](../../../test/integration/organization-directory/browser.js): edição da ficha, unidade filha, pessoa, resposta de gravação deliberadamente perdida, recarregamento/repetição sem duplicação, pesquisa/inativação, consulta sem edição e separação A/B. Larguras 1440 e 390, sem overflow horizontal ou erros JavaScript. [Resultado](browser-verification.json). |
| Demonstração real 5189 | Login OIDC/MFA real, perfil e formulários nas duas entidades, diretório vazio, quatro oportunidades atuais/nove preservadas, candidatura existente acessível em A e 404 em B, **zero escritas de negócio e zero erros JavaScript**. [Resultado](demo-browser-verification.json). |

Os testes do backend foram executados com `node --test --experimental-test-isolation=none`, por restrição de criação de processos do sandbox. Build/Chrome usaram execução autorizada fora dessa restrição, sem alterar os controlos da aplicação.

A primeira prova de browser revelou `AUTHORITY_WRITE_PENDING` no arranque: a consulta de organizações do seletor podia sobrepor-se à leitura do diretório. `authApi.organizations()` passou pela fila existente das consultas organizacionais. Dois testes verificam ordem e libertação após falha; a abertura passou depois no Chrome e com OIDC real. Não foram removidos guards nem alargadas permissões para contornar a corrida.

Uma falha posterior foi de localização de um `select` pelo teste; foram explicitados os nomes acessíveis. Capturas transitórias durante pesquisa/animação móvel foram repetidas depois de aguardar o estado estável. `browser-failure.png` preserva um ensaio anterior e **não representa o resultado final**.

## Ambiente e preservação

[enable-organization-directory.js](../../../scripts/catalog-demo/enable-organization-directory.js) limita-se ao ambiente já identificado `localhost:5189`, PostgreSQL `127.0.0.1:5561` e respetivos dois tenants. Usou o runner canónico para 025 e concedeu as seis permissões explícitas apenas às memberships do gestor de demonstração já existente. Configuração anterior conservada em ficheiro privado; nenhum segredo no relatório.

Comparação de contagem **e digest do conteúdo integral das linhas** antes/depois confirmou nove oportunidades centrais e candidaturas privadas `[1, 0]` inalteradas. [Resultado da atualização](demo-upgrade.json). Não houve recolha externa, seed de departamentos/pessoas, alteração de identidade, deploy ou operação Git mutável. API/worker da demonstração foram reiniciados pelos scripts existentes.

Os três PostgreSQL de prova próprios usaram portas 5566/5567/5568 e etiqueta `c4g.environment=organization-directory-proof`; foram parados após confirmação dessa etiqueta, sem eliminar contentores ou volumes. As bases sintéticas da integração são descartadas pelo seu fixture; a prova de integridade usa rollback. A demonstração persistente e a instalação nativa não são alvos desse cleanup. A instalação nativa/5432 foi concluída pela tarefa paralela, com evidência própria em [local-postgres-platform.md](../local-postgres-platform.md); esta entrega não a reconfigurou nem repete essa prova.

## Capturas finais e limites

- Demonstração real, sem dados inventados: [organização A](demo-organization-0.png) e [organização B](demo-organization-1.png).
- Ensaio sintético: [organização](organization-desktop.png), [unidades](units-desktop.png), [pessoas](people-desktop.png) e [telemóvel](people-mobile.png).

As pessoas/unidades da demonstração permanecem vazias para preenchimento pelo utilizador. As provas de escrita ocorreram apenas em bases sintéticas isoladas. O diretório não é gestão de contas ou RH e não altera o perfil publicado usado no matching. Os percursos editoriais/matching conservam os seus gates e configuração; não foram ativados por esta entrega. Outros adapters editoriais já não admitiam 023/024 antes desta alteração e não foram generalizados para 025 sem prova própria.

Sem validação de produção, carga, importação de pessoas, arquivo de unidades ou gestão de convites. A revisão do percurso e a correção pedidas posteriormente estão concluídas abaixo.

## Correção dos atalhos e conclusão da revisão

A revisão na demonstração identificou um finding médio: “Temas e prioridades” e “Perfil publicado” apareciam como atalhos ativos e conduziam a páginas de erro, com ambos os contextos a devolver 503. **Finding resolvido no âmbito da navegação do perfil.** Os serviços continuam indisponíveis neste ambiente; não se declara a sua recuperação funcional.

- [ProfileLinks.jsx](../../../frontend/src/pages/Organization/ProfileLinks.jsx) apresenta cada serviço independentemente: ligação apenas após GET de contexto bem-sucedido; 503 mostra “Indisponível neste ambiente”, 403 mostra “Sem acesso nesta organização” e falhas sem confirmação têm mensagem distinta. Durante a consulta não há ligação ativa. “Verificar disponibilidade” repete a consulta mantendo a página atual.
- [api.js](../../../frontend/src/api/api.js) reutiliza os dois endpoints existentes, o cabeçalho da organização esperada e a fila de pedidos atual, com timeout de cinco segundos por consulta. Não acrescenta backend, tabelas, grants ou configuração. Autorização nos destinos permanece obrigatória.
- Respostas atrasadas não ativam ligações depois de mudar de organização. As unidades/pessoas e os formulários mantêm o seu percurso próprio. Rotas editoriais existentes permanecem intactas.
- **21/21 testes direcionados PASS**: OrganizationProfile, ProfileLinks, OrganizationRequestQueue, OrganizationSelector e C4gShell. Cobrem 503/403/timeout, ativação independente após recuperação, estado inicial, resposta antiga e serialização/libertação da fila. `npm run build` PASS. Não foram repetidas as provas backend/migrations, porque esta correção não alterou esses componentes.
- **Chrome/OIDC real PASS**, duas entidades, build estável e larguras 1440/768/390. Mensagens visíveis sem links indisponíveis; nova verificação mantém a rota; menu móvel/teclado, formulários abertos/cancelados e ausência de overflow reconferidos. Sete leituras do diretório responderam 200; nove oportunidades centrais, quatro atuais e candidatura A 200/B 404 preservadas. Zero escritas de negócio e zero erros JavaScript. Os 503 das duas consultas de disponibilidade são resultados esperados e tratados, não sucesso dos serviços editoriais.

[Resultado final](profile-links-verification.json) e capturas revistas: [computador](profile-links-1440.png), [tablet](profile-links-768.png), [telemóvel](profile-links-390.png).

Um ensaio intermédio antecipou a asserção antes de terminarem as consultas; outro lançou a leitura manual da candidatura em paralelo com a consulta de pessoas e observou um 503 nesta última. A prova final aguarda explicitamente cada consulta antes da leitura independente e exige sucesso em todas as leituras do diretório; não se alterou a aplicação para contornar estas situações da automação.

**Veredicto:** revisão local do perfil concluída, sem findings pendentes no recorte autorizado. Nenhuma outra funcionalidade iniciada, nenhum dado de negócio alterado nesta correção e nenhuma operação Git mutável. A disponibilidade global de matching/publicação mantém o seu trabalho próprio.
