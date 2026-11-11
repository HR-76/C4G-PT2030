# Páginas reabrem com os dados já confirmados

Estado: Review. Pedido do utilizador em 11/11/2026, depois do mesmo padrão nas páginas da organização.

Ao voltar a uma página já visitada, mostra-se de imediato a última resposta que o servidor deu a esse utilizador e organização, e a página volta a ler os mesmos dados. A nova resposta substitui o que está no ecrã; uma leitura recusada remove-o e mostra o erro.

## Contrato

- `frontend/src/api/confirmedReads.js` guarda respostas apenas em memória, por utilizador e organização, no máximo 60 entradas.
- É tudo esquecido depois de qualquer escrita bem-sucedida (exceto a atualização da lista de alertas, que é uma leitura enviada por POST), no logout, numa sessão expirada (401) e na troca de organização. Uma resposta que atravesse um destes momentos não é guardada.
- Só a primeira página de cada consulta é guardada; páginas seguintes (cursor) nunca.
- Páginas abrangidas: Dashboard, O meu trabalho, Candidaturas, Parceiros, Matching, Alertas e Interesses. No Dashboard, «Atualizar» continua a esconder os indicadores até o servidor responder.
- Fora do âmbito: Catálogo, Perfil pessoal, fichas de detalhe e páginas da Administração C4G.

## Verificação — 11/11/2026

Frontend: 943 aprovados e 1 falha num teste novo de outro trabalho em curso (`edits organization strategy…`, em `OrganizationProfile.test.jsx`); build aprovado. Regressões novas em `ConfirmedReads.test.jsx` e `OrganizationDashboard.test.jsx`.

Navegador no ambiente local, tempo até o conteúdo ficar visível (primeira visita → regresso): Matching 2,0–2,3 s → 0,13 s; Alertas 1,4–1,5 s → 0,09 s; Interesses 1,2 s → 0,08 s; Candidaturas 0,9–1,0 s → 0,11 s; Parceiros 0,9 s → 0,11 s; O meu trabalho 0,7 s → 0,11 s; Dashboard 0,1 s no regresso. Poucas amostras; a primeira visita de cada página não muda.
