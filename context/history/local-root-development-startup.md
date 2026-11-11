# Arranque local a partir da raiz

Fecho formal: 26/10/2026.

`npm run dev` supervisiona API, worker configurado e frontend, recupera apenas os contentores Keycloak/proxy habituais já existentes e aguarda pelo OIDC real antes de anunciar prontidão. Não executa migrations, seeds ou recriação da identidade; `Ctrl+C` termina apenas os processos da aplicação.

Os 13 testes focados, sintaxe, build e smoke real tinham passado. A reconferência de fecho repetiu `npm run test:local-dev`, com 13/13 PASS. O build frontend global atual é interrompido apenas pelo `EntityAdmission.jsx` ainda em desenvolvimento.

[Contrato e evidência completos](../features/local-root-development-startup.md).
