# GCNI — ligação funcional preparada
Data: 2026-11-02. Complete nesta preparação; revisão pronta a fechar.

## Alteração
Montagem oficial de /api/catalog-read/v1 após a sessão na composição normal, configuração disabled por omissão, fornecedor obrigatório para controlled, readiness e encerramento. Entrada /catalogo/consulta e ficha correspondente no router normal; o servidor determina se a entrada é visível. Regresso à gestão existente e namespace próprio evitam confundir IDs novos com oportunidades do catálogo anterior. Interesses, candidaturas, criação e exportação existentes mantidos.

## Validação
Fontes e dados executados numa cópia isolada.2512 testes backend PASS/7 skips herdados;585 frontend PASS;build normal PASS;20 checks OIDC/browser PASS. Nenhuma carga de desempenho. A primeira suite encontrou restrições HTTP do executor e ficheiros de referência omitidos na cópia; repetida com permissões de teste local e referências repostas, sem mudar expectativas ou segurança.
Ensaio normal: modo ausente recusa rota e não constrói fornecedor; modo controlled monta o leitor; filtros, ficha, entrada e retorno na shell normal; isolamento, drift de permissões, revogação, expiração, reversão e recomposição durável. Exposição final OFF;2contentores próprios removidos. Dados/identidades sintéticos;sem federação institucional externa.

## Autorrevisão
Confirmada ausência de novos endpoints de operação, imports de fontes ou execução de migrações. Nenhum segredo introduzido. Escopo da sessão ligado ao utilizador e organização; bloqueio/expiração limpa dados; cada leitura continua com autoridade e admissão existentes. Factory e configuração inválidas falham fechadas. Fecho do fornecedor registado no ownership da composição. Capturas verificadas dentro da shell GCNI. Sem alterações aos quatro ficheiros da referência restaurada de CPU.

## Limites e trabalho restante
Esta é a ligação funcional, não a autorização operacional para promover. O fornecedor do destino (ligações restritas, política durável, chave estável), a admissão normal do pacote, os dados aprovados e o ensaio operacional devem ser fechados antes da ativação. O ensaio continua a usar o fornecedor e admissão isolados; não transferir exceções ou pg_read_all_data para o habitual. O critério500ms não foi reaberto nem declarado cumprido. Não houve promoção, configuração habitual, fonte ou migração aplicada fora da cópia.

Próximo passo: preparar o fornecedor e o pacote de configuração/admissão do destino para uma futura ativação admin, mantendo tudo desligado até à aprovação concreta.
