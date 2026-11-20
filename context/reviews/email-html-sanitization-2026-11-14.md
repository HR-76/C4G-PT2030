# Verificação da limpeza de HTML dos emails (14/11/2026)

Pedido: item 12 da auditoria global, "confirmar que nenhum caminho apresenta HTML sem limpeza". Só leitura e ensaio local; nenhum código alterado.

## Resultado

- **A fronteira é o servidor.** [sanitizer.js](../../backend/src/emailTemplates/sanitizer.js) usa `sanitize-html` com lista fechada de 14 etiquetas, só `href` em `a`, só `https`, sem credenciais no endereço e com a variável `{LigacaoAtivacao}` como única exceção.
- **Ensaio:** 23 entradas de ataque, 0 fugas. Cobriu `script`, `onerror`, `javascript:` (direto, com entidades, com espaços e com tabulação), `data:`, `http:`, endereço relativo ao protocolo, credenciais, `onclick`/`style`/`target`, `style`, `iframe`, `svg`, MathML, `form`, `meta`, `base`, etiquetas aninhadas e comentários.
- **A composição volta a validar.** [render.js](../../backend/src/emailTemplates/render.js) limpa de novo o modelo guardado, escapa o nome da entidade e a validade, recusa quebras de linha no assunto e só insere ligações `https`.
- **A pré-visualização não executa código.** [EmailTemplates.jsx](../../frontend/src/pages/Platform/EmailTemplates.jsx) mostra o HTML num `iframe` com `sandbox="allow-same-origin"`, sem `allow-scripts`.
- **A limpeza do navegador não é fronteira nem vai para produção.** [emailTemplatesSimulation.js](../../frontend/src/pages/Platform/emailTemplatesSimulation.js) é uma simulação de desenvolvimento, usada só por `email-preview.html`, que o build não inclui (o `dist` só tem `index.html`).

## Achado fora do pedido

- O menu da Administração C4G mostra a entrada **Email**, com a rota `/administracao/email`. A página chama `/api/admin/email`, e o backend não monta nenhuma rota com esse caminho. O módulo `backend/src/emailTemplates/` existe, mas nada o importa.
- Os documentos da funcionalidade dizem "Nada implementado; nenhuma dependência instalada". Já não é verdade: existem o módulo do servidor, a dependência `sanitize-html`, a página, a entrada no menu e a migração 051, que foi aplicada no staging a 14/11/2026.
- Por decidir: esconder a entrada do menu até a API existir, ou concluir a ligação da API.
