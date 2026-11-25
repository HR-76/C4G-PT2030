# Loader orbital C4G

Pedido de 28/10/2026: melhorar o loader, inspirado nos círculos do login.

## Critérios de aceitação e direção visual

- Atualizar o LoadingIndicator partilhado e preservar consumidores e mensagens.
- Dois anéis com pontos em órbita e centro fixo, inspirados no login, num símbolo de 64px sobre a mensagem centrada.
- Tipografia existente; verde petróleo #075b59, verde claro #b7ee62, pista #d5e5e1 e texto #52636a.
- Anunciar apenas o texto de estado; desenho decorativo oculto a leitores de ecrã.
- Respeitar movimento reduzido e permitir quebra do texto em mobile.
- Validar suite frontend e build. Sem alterações funcionais ou de contratos HTTP.

Estado: Complete — fecho em 14/11/2026 por decisão do utilizador. Verificado nessa data: o código e os testes descritos existem; suíte do backend com 3193 testes a passar e do frontend com 1014; build e lint sem erros. Confirmado no componente: dois anéis, desenho oculto a leitores de ecrã e regra de movimento reduzido. Sem validação visual em navegador, como já constava. Estado anterior: Review — implementado no componente partilhado.

Validação: suite frontend 376 PASS em 57 ficheiros; build Vite PASS. Logs em `output/orbital-loader-tests.log` e `output/orbital-loader-build.log`. A primeira tentativa foi bloqueada pela sandbox (spawn EPERM); repetição autorizada fora da sandbox concluída. Sem validação visual em navegador nesta passagem, sem deploy.
