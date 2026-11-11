# Cores dos ícones

State: Review

## Pedido

11/11/2026 — o utilizador pediu que os ícones da aplicação deixem de ser todos verdes e passem a ter cores diferentes, com exemplos do cabeçalho de secção e dos cartões de atalho do dashboard do Técnico.

## Contrato

- Os ícones decorativos de navegação, títulos de secção, atalhos e indicadores recebem uma cor por assunto, em vez da cor de ação petróleo.
- Tons disponíveis em `frontend/src/icon-tones.css`: azul, violeta, âmbar, rosa e azul-céu, cada um com variante suave para ícones em mosaico.
- Assuntos: dashboards azul; tarefas violeta; catálogo e oportunidades azul-céu; candidaturas rosa; alertas e faturação âmbar; documentos azul.
- Aplicação por atributo `data-icon-tone` no ícone ou no mosaico que o contém.
- Botões, ligações, estados, separadores e a cor de ação principal não mudam. Ícones de estado (sucesso, aviso, erro) mantêm a cor semântica.

## Critérios de aceitação

- Barra lateral, sino do cabeçalho, dashboard do Técnico, O meu trabalho, Dashboard C4G, Segurança da conta e ficheiros ligados da candidatura mostram ícones com os tons acima.
- Cada tom tem contraste mínimo de 4,5:1 sobre branco e 4:1 sobre a respetiva variante suave.
- Nenhum texto ou rótulo acessível é alterado.

## Validação

- 11/11/2026 — build PASS; 922 testes frontend PASS. Contraste calculado: azul 5,67, violeta 6,10, âmbar 4,58, rosa 5,21, azul-céu 4,88 sobre branco.
- Validação visual na aplicação autenticada pendente.

## Por decidir

- Ícones dentro de páginas não listadas (perfil da organização, diretório da plataforma, Fontes) continuam com a cor anterior.
