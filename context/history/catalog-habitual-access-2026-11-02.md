# Catálogo habitual — Super Admin C4G e administrador da entidade
Estado: Complete — 02/11/2026
Veredicto da autorrevisão: pronto a fechar.

## Resultado
O menu Catálogo C4G (/catalogo) apresenta agora os estados coloridos, tipificação/áreas e os campos Topic, candidatos elegíveis, duração e localização. A descrição integral arquivada é disponibilizada apenas quando o digest da revisão e as referências de evidência correspondem. A apresentação monetária segue a decisão anterior: formato português, EUR como regra de apresentação quando ausente, assunção identificada e moedas explícitas/conflitos preservados.

A listagem inicial mostra todos os prazos. Prazos atuais, históricos, programa e estado permanecem filtros explícitos. Paginação conservada: 178 oportunidades em oito páginas, até 25 por página.

O Super Admin C4G usa as rotas administrativas habituais; o administrador da entidade usa as rotas com membership. A apresentação não usa a disponibilidade experimental nem a janela de cinco minutos. As rotas experimentais e os respetivos controlos não foram alargados. Nenhuma membership ou permissão foi alterada. Interesses e candidaturas continuam privados da entidade e sujeitos às autorizações existentes.

## Implementação e revisão
- Reutilização da apresentação canónica/arquivada em fundingTenders/repository, depois da validação do snapshot. Enriquecimento aditivo, sem modificar revisões/projeções.
- Componentes habituais de tabela/ficha reutilizam cores e formatação do catálogo. Estados das candidaturas separados do estado do aviso; ausência descrita como ausência de candidaturas visíveis.
- Filtro inicial sem data implícita; filtros persistidos, paginação, cancelamento e descarte de respostas de contexto anterior preservados.
- Super Admin sem consultas privadas; membership não é inferida do papel global.
- Limites de resposta e autorização atuais mantidos. Sem novas consultas remotas, migrações ou recolhas.
- Cópias iniciais dos ficheiros de implementação em .tmp/catalog-habitual-fix-backup. Trabalho prévio preservado; nenhuma operação Git realizada.

## Validação
- Regressões reproduzidas antes da implementação: filtro inicial e ausência de adaptador de apresentação habitual.
- Backend completo: 2 555 PASS, 7 omissões existentes, zero falhas (2 562 testes). Inclui recusa de impersonação, revogação e obrigatoriedade de membership para rotas privadas.
- Frontend completo final: 630 PASS, 79 ficheiros, zero falhas. Inclui tabela/ficha nos dois perfis, ausência de chamadas ao ensaio e ausência de pedidos privados no Super Admin.
- Build final PASS; node --check nos dois módulos backend alterados PASS.
- Browser real, contas locais de teste admin e hugo: 178 resultados em oito páginas para ambos; campos, descrição arquivada, moeda e layout móvel confirmados; zero erros JavaScript. Super Admin com zero pedidos privados. Consultas de candidaturas da entidade aguardadas até conclusão sem alerta.
- Capturas em output/playwright/catalog-habitual, desktop e 390 px para os dois perfis, inspecionadas visualmente. Scroll horizontal da tabela fica no contentor; móvel usa cartões, sem overflow da página.
- Base real em leitura: 178 oportunidades, 178 revisões, zero funding_run; fonte EU QUIESCED. Não foram escritos dados de negócio. Logins/leitura usam os registos normais de sessão e auditoria.
- API local reiniciada pelo entrypoint source-free-controlled; frontend habitual em localhost:3000. Fontes mantidas desligadas.

## Limites
O total de 178 é o corpus preservado, não uma nova recolha. Registos planeados e históricos continuam identificados como tal. Campos não publicados não são inventados. Não foi validada federação externa nem executada publicação de produção. A conta nominativa não foi autenticada nesta prova; a autorização C4G_ADMIN comum foi validada pelo admin de teste.

Next step: utilização do Catálogo habitual em http://localhost:3000/catalogo pelos dois perfis.

## Ajuste de texto solicitado
Por pedido posterior do utilizador, retirada da tabela e ficha a mensagem «EUR por regra geral · moeda não indicada na fonte». Formatação monetária, moeda canónica e tratamento de conflitos preservados.
