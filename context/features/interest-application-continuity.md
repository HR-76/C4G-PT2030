# Interesse → candidatura — continuidade da análise
State: Complete

Percurso existente confirmado: registar interesse separado da candidatura; análise com notas/unidades e histórico; consulta da revisão atual da oportunidade; criação com título/unidades e vínculo ao interesse, capacidades do servidor e recuperação idempotente.

Incremento: impedir abertura de candidatura com notas/unidades ainda por guardar, indicando ação necessária; apresentar a análise guardada na preparação da candidatura com ligação ao interesse; permitir copiar explicitamente notas apenas para um campo de notas vazio, sem alterar análise original, prazos, responsáveis ou orçamentos. Manter links oficiais, revisões e retorno à origem.

Aceitação: alterações locais bloqueiam a passagem; guardar/reverter desbloqueia; cópia preserva texto integral e só ocorre por ação explícita; não substitui rascunho nem pedido pendente; criação mantém vínculo, unidades e identidade do pedido. Sem migrações, novas permissões, submissão externa ou deploy.

## Entrega e revisão

- Análise alterada (notas ou conjunto de unidades) bloqueia Abrir candidatura e apresenta «Guarde a análise antes de abrir a candidatura». Guarda também no handler, não apenas no botão. Reverter para o conteúdo guardado desbloqueia; ordem das unidades não cria falso aviso.
- Nova candidatura mostra a análise guardada e o vínculo ao interesse. A ação Usar análise nas notas da candidatura copia integralmente apenas para notas vazias e fica indisponível durante envio/pedido pendente ou quando existe texto. Não há cópia implícita nem alteração do interesse original.
- Título, unidades, revisão atual da oportunidade, vínculo ao interesse e retorno existentes mantidos. Responsável, prazo interno e orçamentos continuam escolhas do utilizador; links oficiais preservados.
- Contratos HTTP, backend, autorizações, histórico e chaves de idempotência não alterados. O texto copiado utiliza o campo notes já existente no comando e na recuperação.

## Verificação

- Regressões novas falharam antes da implementação e passaram depois: notas/unidades por guardar, reversão, cópia explícita, proteção de texto existente e pedido incerto com notas/vínculo preservados.
- Backend completo: 2583 aprovados, 7 ignorados, zero falhas. Frontend completo: 651 aprovados. Build aprovado.
- Chrome local com APIs simuladas: editar análise, guardar, abrir candidatura, copiar notas, verificar fonte oficial, desktop 1440 e móvel 390 sem overflow. Captura móvel inspecionada. Evidência em output/interest-continuity-*.log e output/playwright/interest-continuity/verification.json.
- Revisão focada concluída sem impedimentos. Sem integração em base real, migração ou deploy neste incremento.

Próximo passo: melhorar a organização da equipa e das responsabilidades na preparação da candidatura.
