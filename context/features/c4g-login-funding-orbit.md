# Órbita de financiamento no login C4G

Estado: Complete — fecho formal em 26/10/2026. Direção visual aprovada pelo utilizador em 2026-10-22; composição refinada após revisão visual do utilizador.

## Objetivo

Dar identidade e movimento ao painel direito do login Keycloak através de uma órbita inspirada no fluxo real da plataforma, preservando a clareza e estabilidade do formulário de autenticação.

## Direção visual

- Paleta: verde-petróleo `#075B59`, verde profundo `#064B4A`, lima C4G `#8CC63F`, realce `#B7EE62`, branco e verde-branco `#E0EEEB`.
- Tipografia: manter a família de sistema do tema Keycloak para coerência, com pesos e escalas já usados no login.
- Layout desktop: formulário intacto à esquerda; no painel de 42% à direita, órbita ampliada e centrada na largura útil da zona verde, com a mensagem do produto abaixo alinhada à esquerda.
- Layout móvel: painel continua depois do formulário; órbita compacta, labels secundárias reduzidas e sem overflow.
- Movimento: anéis lentos em sentidos alternados e pontos luminosos; texto imóvel; nenhum outro efeito concorrente.

## Contrato de conteúdo

- Centro: `C4G`, `Financiamento`, `em movimento`.
- Conceitos orbitais: `Catálogo central`, `Matching explicável`, `Candidaturas`, `Equipa e prazos`.
- Mensagem: `Encontre financiamento. Faça avançar os seus projetos.` e uma descrição curta do percurso.
- Não apresentar números, volumes, disponibilidade, IA ou outras afirmações não demonstradas.
- A órbita é decorativa para tecnologia assistiva; o título e a descrição continuam a comunicar o produto.

## Critérios de aceitação

1. O formulário, campos, botão, recuperação e fluxo OIDC permanecem inalterados e funcionais.
2. O painel apresenta uma única órbita com quatro conceitos reais da plataforma e sem duplicar a lista anterior.
3. O movimento usa apenas CSS, é lento e não move o texto.
4. `prefers-reduced-motion: reduce` remove animações e transições não essenciais.
5. Não existe overflow horizontal em 1440, 900 e 390 px; a composição permanece legível em alturas reduzidas.
6. O elemento visual não cria conteúdo acessível redundante nem interfere com foco ou interação.
7. Teste estático do contrato, gate visual Keycloak e inspeção desktop/móvel passam antes de Review.

## Fora do âmbito

- Alterar autenticação, realm, credenciais, MFA, recuperação ou sessões.
- Introduzir JavaScript, bibliotecas de animação, canvas ou dependências.
- Mostrar métricas dinâmicas ou consultar dados autenticados no login.
- Recriar o contentor Keycloak ou reinstalar a identidade.

## Implementação

- O painel direito mantém a mensagem principal e substitui a lista estática por uma órbita CSS com três anéis, quatro conceitos do produto e um núcleo C4G.
- O movimento está limitado aos anéis e ao brilho do núcleo; os textos permanecem estáveis.
- O breakpoint móvel reorganiza o painel depois do formulário e a variante de baixa altura reduz a órbita sem cortar conteúdo.
- A revisão pedida aumentou a órbita desktop até 420 px, a versão móvel até 330 px sem exceder 82% do viewport e a versão de baixa altura para 250 px; o contentor visual usa toda a largura útil do painel para assegurar centragem real em ecrãs largos.
- A segunda revisão aproxima a mensagem da órbita, centra o bloco de texto no mesmo eixo mantendo alinhamento textual à esquerda, reforça moderadamente o núcleo e as labels e versiona a folha de estilos para invalidar caches antigos do browser.
- O tema ativo no contentor Keycloak local foi atualizado apenas nos ficheiros `footer.ftl` e `c4g.css`; as versões anteriores ficaram guardadas em `.tmp/c4g-login-funding-orbit-before/`.
- A versão anterior ao refinamento de escala e centragem ficou guardada em `.tmp/c4g-login-funding-orbit-before-centering/c4g.css`.
- A versão anterior ao segundo refinamento ficou guardada em `.tmp/c4g-login-funding-orbit-before-composition/`.
- Realm, autenticação, contas, credenciais, MFA e recuperação não foram alterados.

## Evidência de validação

- `node --test backend/test/localIdentityThemePresentation.test.js backend/test/localIdentityBranding.test.js`: 5 testes PASS.
- `node --check backend/test/localIdentityThemePresentation.test.js`: PASS.
- Inspeção Chrome/Playwright em 1440 × 900, 1440 × 650, 900 × 1000 e 390 × 844: composição legível e sem overflow horizontal; a variante 1440 × 650 também não cria scroll vertical.
- Controlo de password confirmado no browser: `password` → `text` → `password`.
- Movimento normal confirmado em `c4g-orbit-spin`, 42 s; com `prefers-reduced-motion: reduce`, `animation-name` é `none`.
- Hashes SHA-256 do `footer.ftl` e `c4g.css` no contentor são idênticos aos ficheiros do repositório.
- O gate integrado `identity-branding.cjs` validou o layout e o controlo de password, mas parou depois na etapa de recuperação por uma expectativa textual antiga com mojibake; não foi tratado neste recorte por não resultar da órbita.
- Refinamento visual validado em 1440 × 900, 1440 × 650, 900 × 900 e 390 × 844: órbita com 420, 250, 330 e aproximadamente 320 px, respetivamente; desvio horizontal medido entre 0 e 0,01 px e sem overflow horizontal.
- Segunda revisão validada em sessão limpa a 1920 × 920, 1440 × 900 e 390 × 844: título com duas linhas nos dois viewports desktop, órbita centrada com desvio inferior a 0,01 px e sem overflow horizontal. O browser carregou `c4g.css?v=20261022.2`, confirmando a invalidação do cache anterior.

## Fecho formal (26/10/2026)

Os sete critérios de aceitação ficam satisfeitos no recorte visual aprovado. A reconferência executou novamente os cinco testes de identidade/apresentação incluídos na seleção backend, todos com sucesso. A falha atual do build global está localizada em `EntityAdmission.jsx`, fora desta feature; o build e as provas Keycloak/Chrome exigidos pela órbita tinham passado e permanecem registados acima. Autenticação, realm, credenciais, MFA, recuperação e sessões continuam inalterados.

