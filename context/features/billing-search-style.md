# Pesquisa nos filtros de faturação

Estado: Complete — fecho em 14/11/2026 por decisão do utilizador. Verificado nessa data: o código e os testes descritos existem; suíte do backend com 3193 testes a passar e do frontend com 1014; build e lint sem erros. Os estilos deste pedido foram depois absorvidos pelo componente SearchInput (ver homogeneous-search-bars.md), que a faturação usa. Não repetida: a verificação de estilos no Chrome. Estado anterior: Review. Pedido visual de 28/10/2026.

Causa: seletor base de controlos em index.css omite input[type=search], deixando o controlo nativo mais baixo e sem os estilos dos restantes filtros.

Âmbito: incluir search nos estilos comuns de inputs, garantir altura uniforme nos filtros de faturação e impedir que o ícone intercepte cliques. Sem mudanças funcionais ou HTTP.

Aceitação: pesquisa com tipografia, borda e raio comuns; mesma altura dos restantes filtros; ícone centrado sem sobrepor texto; foco visível; sem overflow em desktop/mobile. Validar primeiro regressão de estilos computados em Chrome com respostas sintéticas, depois testes locais e build.

Implementado: input[type=search] incluído nos estilos base; altura mínima de 36px nos filtros da faturação; pointer-events:none na lupa. Outros campos search passam também a receber os estilos comuns, preservando regras específicas de cada página.

Regressão Chrome antes da correção: altura 19px, raio 0px, borda nativa e Arial; falha esperada. Depois: todos os sete filtros com 36px, raio 6px e tipografia/borda iguais; lupa centrada, espaço antes do texto, foco visível e ausência de overflow a 1680px e 390px. Capturas revistas: `output/playwright/billing-search-desktop.png` e `billing-search-mobile.png`. Prova reproduzível: `output/playwright/billing-search-check.cjs` (API sintética).

Frontend 357 PASS; backend 1585 PASS/0 FAIL/7 SKIP preexistentes; build PASS. Logs em `output/billing-search-frontend.log`, `output/billing-search-build.log` e `output/billing-search-backend.log`. Sem alterações funcionais, de API, dados ou deploy.
