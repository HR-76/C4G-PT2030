# Login Corporate C4G

Estado: proposta retirada — 11/11/2026.

Correção do utilizador: manter o círculo original. Repostos o painel, animação e disposição anteriores; a proposta abaixo é apenas registo histórico e não descreve a versão atual. Não alterar o círculo em melhorias futuras sem pedido explícito.

Pedido: aplicar a composição Corporate Metronic 8.3.3 ao tema Keycloak C4G.

## Critérios de aceitação
- Desktop: apresentação C4G à esquerda, formulário nativo à direita; identidade petróleo, branco e verde C4G.
- Mobile: formulário primeiro, sem sobreposição ou deslocamento horizontal a 390 e 320 px; controlos e foco acessíveis.
- Preservar templates nativos de campos, submissão, mostrar palavra-passe, recuperação e mensagens; não alterar OIDC, contas ou políticas.
- Conteúdo institucional conciso, sem animação decorativa ou métricas inventadas.
- Validar no navegador login e recuperação, erro e larguras desktop/mobile. Registar limites da prova.

## Design
Paleta: petróleo #075B59, petróleo profundo #064B4A, verde #48752A, branco #FFFFFF, texto #20262B, secundário #4B5560. Segoe UI/sistema; título institucional 40 px e formulário 28 px. Duas áreas com conteúdo alinhado à esquerda e formulário de 400 px. A composição Corporate é adaptada ao percurso de financiamento: oportunidades, correspondências e candidaturas. Sem importar scripts Metronic ou novos provedores de acesso.

## Validação — 11/11/2026
- Chrome com HTML e recursos reais do Keycloak local; CSS e painel substituídos no navegador a partir dos ficheiros alterados. 1440/1024/900/390/320 px: sem overflow horizontal; painel separado em desktop e abaixo do formulário em mobile.
- Mostrar/ocultar palavra-passe e ajuda de recuperação por teclado aprovados. Mensagem de erro simulada a 320 px sem overflow. Capturas desktop e mobile inspecionadas visualmente.
- Sem submissão de credenciais: fluxo OIDC completo e renderização FreeMarker do novo footer no servidor não foram repetidos. O bloco condicional existente e macro foram preservados; apenas HTML estático do painel mudou.
- A instância ativa monta uma cópia externa em `native-email/private/themes-before`; não foi alterada. A validação prova a apresentação no navegador, não uma instalação no servidor.
- Capturas: `login-corporate-1440.png`, `login-corporate-390.png`, recuperação e erro a 320 px na pasta de visualizações da sessão.
- `npm run build` frontend e `git diff --check` dos ficheiros abrangidos: aprovados.
