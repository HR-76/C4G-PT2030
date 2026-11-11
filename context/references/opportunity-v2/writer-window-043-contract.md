# Preparação da janela habitual 043 e retoma controlada

31/10/2026 — pedido: preparar a janela habitual043 e a retoma controlada, renovando preview, backup/restauro e aprovação autenticada.

## Âmbito e critérios de aceitação

1. Consultar o ambiente habitual com preflights físicos Central042/tenant034, identidade e revisão atuais da11145, estado/fence EU, trabalho pendente e saúde. Preservar dados e trabalho paralelo.
2. Renovar a observação pública11145, comparar o candidato v2 com o head aceite e fixar os hashes do conteúdo, parsing, pacote043 e ficheiros operacionais. Confirmar120000, moeda explicitamente não publicada e sete prazos quando a fonte atual conservar esses factos; recusar divergências silenciosas.
3. Obter backup próprio e restauro lógico isolado da baseline atual, com pausa coordenada estritamente necessária, prova de quiescência, ACL restrita, inventários de dados/esquemas/sequências/configuração e recuperação da saúde habitual. Não reutilizar o backup anterior035/033 como prova042/034.
4. Preparar um plano concreto042→043, seleção explícita do writer, configuração e retoma por sessão administrativa, primeiro ciclo limitado e condições de suspensão/recuperação. Vincular a evidência atual e a aprovação autenticada ao digest deste plano; não reutilizar a aprovação da migração11145.
5. A preparação mantém a fonte EU QUIESCED e a configuração habitual do writer desativada. Não instala043, não configura/retomaEU, não aceita revisões e não lança recolha. A aprovação da preparação não é uma lease nem substitui autenticação/autorização e revalidação na execução.
6. Verificar automatizadamente os novos validadores/fluxos; rever independentemente os controlos e documentar limitações, expiração e qualquer condição que impeça a aprovação. Não fabricar sessões, grants, aprovações ou provas físicas.

## Plano de trabalho

Inventário e desenho do vínculo autenticado; adaptação explícita dos helpers à baseline042/034; testes e revisão; preview público e janela de backup/restauro; plano fechado e aprovação por OIDC/CSRF/autoridade persistida; evidência e runbook de execução/recuperação.

Estado e resultados são mantidos no relatório e em `context/current-work.md`. Fontes e SQL043 existentes permanecem fixados sempre que possível; qualquer alteração necessária à preparação tem prova própria, sem reescrever evidência histórica.
