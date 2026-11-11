# Validação final — 09/11/2026

- Gate SQL isolado: COMPLETE, 144 medições, igualdade de payload/digest, 28 casos temporais, cursores assinados e RLS aprovados. Fontes estáveis; contentor removido.
- Regressão de cálculo temporal não usado: 4 PASS/1 FAIL antes da alteração; após a alteração, 19 testes focados de browse/consumidores v2 PASS.
- Suite backend completa, execução com loopback permitido: **2740 testes, 2733 PASS, 7 SKIP, 0 FAIL**, código 0. [Log](backend-tests-local-network.log).
- A primeira execução backend na sandbox teve 146 falhas por bloqueio de ligações HTTP locais EACCES, 2587 PASS e 7 SKIP. A evidência permanece em [backend-tests.log](backend-tests.log); não foi ocultada nem corrigida enfraquecendo testes. A repetição com acesso autorizado ao loopback aprovou a suite inteira.
- Suite frontend completa: **92 ficheiros, 814 testes PASS**, código 0. [Log](frontend-tests.log). Inclui mensagens de cenários de erro tratados pelos testes; não há teste falhado.
- Build Vite: PASS, código 0. [Log](frontend-build.log).
- `node --check` nos três ficheiros produtivos alterados e no teste de fronteira JIT: PASS. `git diff --check` nos ficheiros versionados do incremento: PASS; aviso de normalização LF/CRLF preservado, sem erro de whitespace.

As suites foram executadas depois das medições. Os sete SKIP não equivalem a provas aprovadas. A execução SQL usa autoridade de entrada sintética e não substitui uma medição HTTP/navegador, nem repete a prova de revogação central concorrente ou de auditoria de commit. Não houve alteração desses protocolos, deploy, reinício solicitado dos serviços habituais ou acesso às bases habituais.
