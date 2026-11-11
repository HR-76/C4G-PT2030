# Arranque local a partir da raiz

Estado: Complete — fecho formal em 26/10/2026. Arranque agregado autorizado em 2026-10-22; recuperação automática do Keycloak local existente autorizada e implementada em 2026-10-23.

## Objetivo

Permitir arrancar o ambiente de desenvolvimento C4G habitual a partir da raiz do repositório com `npm run dev`, mantendo API, worker e frontend como processos separados e visíveis no mesmo terminal.

## Contrato

- O comando raiz supervisiona a API, o worker de Funding & Tenders quando configurado e o frontend.
- O arranque diário não executa setup, migrations, seeds, recolhas, alterações de passwords ou operações sobre dados.
- PostgreSQL permanece um pré-requisito externo. Se o Keycloak habitual ou o seu proxy HTTPS estiverem parados, o comando inicia apenas os contentores locais já existentes `keycloak` e `proxy` através de `docker compose start`.
- O arranque nunca cria, recria, atualiza ou remove contentores, volumes, realms, utilizadores, credenciais ou configuração de identidade. Ausência do perfil preparado, Docker indisponível ou falha no arranque produzem remediação explícita.
- Os contentores de identidade iniciados automaticamente permanecem ativos depois de `Ctrl+C`; o supervisor encerra apenas API, worker e frontend.
- Os logs identificam o serviço de origem sem expor configuração privada.
- `Ctrl+C` e a falha inesperada de um serviço encerram os restantes processos iniciados pelo supervisor.
- A aplicação só é anunciada como pronta depois de `http://localhost:3000/api/local-health` confirmar frontend, API e componentes exigidos pelo runtime.
- Os comandos individuais de API, worker e frontend permanecem disponíveis para diagnóstico.

## Critérios de aceitação

1. `npm run dev`, executado na raiz, arranca os componentes exigidos pela instalação local preparada.
2. Uma instalação já pronta é reconhecida sem criar processos duplicados.
3. Com a identidade já disponível, o comando não invoca Docker nem cria processos de identidade duplicados.
4. Com os contentores habituais `keycloak` e `proxy` existentes mas parados, o comando inicia-os sem os recriar e aguarda pela porta HTTPS e pelo documento OIDC válido do realm antes de iniciar a aplicação.
5. Estado local ausente/inválido, dependências npm ausentes, PostgreSQL indisponível, perfil Keycloak ausente, Docker indisponível, timeout da identidade e portas ocupadas produzem erros curtos com remediação, sem migrations ou alterações de dados.
6. O worker só é incluído quando o estado local possui a configuração Funding & Tenders.
7. A saída de cada filho é identificada por serviço e nenhuma configuração privada é impressa.
8. A saída voluntária ou falha de um filho não deixa os restantes processos supervisionados ativos.
9. Existem aliases raiz para arranque individual, setup explícito, build e teste focado.
10. Testes focados, `node --check`, build do frontend e verificação de whitespace passam.

## Implementação e evidência

- `package.json` raiz expõe o arranque agregado, os três componentes individuais, setup explícito, build e teste focado sem dependências npm adicionais.
- `scripts/start-local.cjs` valida Node/dependências/estado privado, reconhece uma instalação já pronta, verifica PostgreSQL e portas e recupera apenas os contentores `keycloak`/`proxy` existentes com `docker compose start` quando necessário. A prontidão da identidade exige simultaneamente a porta HTTPS e metadata OIDC coerente com o issuer configurado; só depois inicia os componentes da aplicação.
- O comando Docker usa o projeto, compose e env privado conhecidos, captura a saída sem a expor e nunca usa `up`, criação ou recriação. `Ctrl+C` preserva os contentores de identidade e encerra apenas a árvore API/worker/frontend.
- O polling de readiness é cancelado quando um filho falha ou o utilizador interrompe o comando, evitando manter o processo raiz ativo até ao timeout.
- `node --check` do supervisor e teste: PASS.
- `npm run test:local-dev`: 13/13 PASS, incluindo identidade já ativa, PostgreSQL ausente, perfil privado ausente, comando `start` exato e recusa da porta HTTPS antes do discovery OIDC.
- `npm run build`: PASS, 2126 módulos transformados.
- Verificação de JSON e whitespace do recorte: PASS.
- Smoke real desde `keycloak`/`proxy` parados: o comando iniciou os contentores existentes, aguardou pelo discovery do realm, iniciou API/worker/frontend e atingiu `C4G pronta em http://localhost:3000`. Após `Ctrl+C`, 3000/5000/5285 ficaram livres, os dois contentores permaneceram ativos e o issuer esperado respondeu em 8080/8443. Nenhum contentor, realm, volume, utilizador ou credencial foi criado ou recriado.

## Fora do âmbito

- Instalar dependências automaticamente.
- Criar, migrar, popular, apagar ou reiniciar bases de dados.
- Criar, recriar, atualizar, remover ou repor contentores/serviços Keycloak; apenas iniciar os contentores habituais existentes é permitido.
- Alterar portas, configuração OIDC ou o perfil histórico Docker.
- Executar recolhas externas ou publicar/deployar a aplicação.

## Fecho formal (26/10/2026)

O supervisor local fica concluído no âmbito contratado. A reconferência de fecho executou `npm run test:local-dev`: 13/13 testes passaram. O build frontend global atual é interrompido por um erro de sintaxe em `EntityAdmission.jsx`, pertencente a trabalho ativo e não ao supervisor; o build exigido e o smoke real completo tinham passado antes dessa alteração externa. O comando continua sem migrations, seeds, recriação de identidade ou alteração de dados.

## Correção posterior (29/10/2026)

O [arranque autónomo do backend](local-backend-development-startup.md) estende a preparação aos terminais individuais, substitui a prontidão indireta HTTP por discovery HTTPS com CA local e reconhece o fornecedor de identidade efetivamente encaminhado pelo proxy. Quando esse perfil está montado, retoma também os contentores existentes da identidade ativa e da sua base persistente. O supervisor usa `--exitcrash` para observar falhas da API. Esta correção mantém o histórico de validação acima; os resultados atuais estão no novo contrato.

