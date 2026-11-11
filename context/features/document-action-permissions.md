# Permissões das ações documentais
State: Complete

Correção aprovada: projeção documental devolve capabilities canEdit, canDecide e canUpload calculadas pela autorização efetiva para a candidatura e organização atuais. canUpload exige edição e permissões de iniciar/confirmar carregamento e criar versão. A interface não deduz acesso do perfil nem da edição geral da candidatura; ausência de capabilities fecha ações.

Edição controla associação, remoção e pedido de revisão. Decisão é independente, mantendo restrições de autor, versões inacessíveis e pedido desatualizado. Upload exige canUpload. Consulta, histórico e links oficiais preservados. Envios pendentes mantêm intenção mas só oferecem repetição com permissão atual; 401/403 bloqueiam ações até nova consulta. Paginação atualiza capabilities. Servidor revalida cada escrita; sem alteração de grants, esquema ou infraestrutura.

Aceitação: regressão antes da correção; matriz administrador/consulta/editor/revisor, permissões ausentes, revogação e repetição pendente; backend confirma projeção e recusa; suites completas, build e navegador com API simulada. R2/ClamAV e deploy continuam adiados.

## Implementação e revisão

GET /applications/:id/documents acrescenta capabilities à projeção existente; o cliente HTTP preserva a resposta sem adaptação. Sem novos endpoints, grants ou migrações. Associação, remoção e pedido de revisão dependem de canEdit; decisão depende de canDecide e das restrições do pedido; carregamento depende também das três permissões de transporte.

Revisão focada: guardas no handler além dos controlos visuais; capabilities ausentes fecham ações; repetição depende do método original; intenção preservada após 403; atualização das permissões ao paginar; links oficiais e validação de cada escrita no servidor mantidos. Testes backend verificam recusas antes de qualquer consulta protegida.

Regressão frontend reproduzida antes da correção (5 falhas). A fixture SQL dos novos testes backend foi corrigida para simular o resultado agregado de MAX(revision); essa falha inicial era da fixture, não do produto.

Frontend: 680 testes aprovados / 82 ficheiros; build aprovado. Chrome com API simulada: administrador, membro de consulta, editor e revisor; 1440px/390px, sem overflow. Captura mobile do membro inspecionada. Evidência: output/playwright/document-permissions/verification.json. Backend final: 2592 testes aprovados, 7 ignorados, zero falhas. Verificação de sintaxe aprovada.


Revisão concluída sem bloqueios neste âmbito. Nenhuma infraestrutura externa ativada, nenhum deploy e nenhum dado real alterado. A evidência de navegador é simulada; não equivale à validação de R2/ClamAV reais.

Próximo passo: validar as permissões e ações da Ficha de Parceiros nos perfis de administrador e membro da equipa, reutilizando a componente existente.
