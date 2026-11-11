# Interreg Europe e POCTEP — verificação das fontes

Data: 18/10/2026. Estado: investigação concluída; conectores centrais ainda não implementados nem validados. Âmbito: entrega 4, leitura pública e ensaio dos parsers preservados, sem executar sincronizações, notificações ou writes de negócio.

## Decisão e contexto

Determinar se as fontes preservadas podem alimentar o catálogo central e quais as correções necessárias. O produto exige proveniência, identidade estável, correções manuais e histórico preservados, autoridade C4G_ADMIN e isolamento das organizações. O legado é material de recuperação, não um caminho de persistência aprovado.

`backend/src/services/externalOpportunitySyncService.js` escreve em `opportunities`/`integration_runs` antigos e chama serviços de áreas/notificações. Não foi invocado. O ensaio carrega exclusivamente funções de leitura num contexto VM com dependências de negócio substituídas por funções que lançam erro. Não lê configuração, credenciais ou bases.

## Resultados reais

| Fonte | HTTP e conteúdo | Resultado |
| --- | --- | --- |
| Interreg Europe | Página e XLSX configurados: 200, tipos corretos | Fonte disponível, sem chamadas abertas confirmadas nas páginas consultadas; falta adaptação central e correção de datas/identidade |
| POCTEP | Próximas, abertas e calendário: 200; dois endpoints públicos WordPress: 200 JSON | Calendário com dez chamadas, oito encerradas e duas abertas; parser antigo inadequado |

### Interreg Europe

A [página oficial de chamadas](https://www.interregeurope.eu/call-for-projects) continua a apontar para o [XLSX configurado](https://www.interregeurope.eu/sites/default/files/2024-08/Calls_planning_web.xlsx), apesar do diretório datado de 2024. A página indica atualização da lista em 20/08/2026 e informa que os fundos estão comprometidos e não prevê mais chamadas abertas em 2021–2027. O ficheiro contém três chamadas gerais encerradas e notas, não sete oportunidades.

As datas civis do Excel conferem com a página: primeira 05/04–31/05/2022; segunda 15/03–09/06/2023; terceira 20/03–07/06/2024. A conversão atual `cellDates:true`, neste ambiente, gera por exemplo `2024-06-06T23:00:45.000Z` para a célula civil `2024-06-07`. A chave antiga incorpora a data derivada: corrigir datas sem reconciliar identidades pode criar duplicados.

Cobertura limitada: a página também descreve uma chamada restrita de 2024 ausente do Excel. A [página de ações-piloto](https://www.interregeurope.eu/call-for-pilot-actions) descreve chamadas restritas a projetos já aprovados; a de 2026 encerrou em 10/04. Não confundir estes complementos com acesso geral, nem Interreg Europe com todos os programas Interreg. Não foi confirmado um endpoint público documentado de chamadas em JSON para este programa.

### POCTEP

O [calendário geral](https://www.poctep.eu/convocatorias/) permite identificar dez convocatórias do período 2021–2027. A [página de abertas](https://www.poctep.eu/convocatorias-abiertas-poctep-2021-2027/) confirma:

| Convocatória | Abertura | Fecho | Dotação FEDER |
| --- | --- | --- | --- |
| 9.ª — entidades gestoras de fundos de pequenos projetos | 09/09/2026 | 21/10/2026, 14h de Espanha peninsular | 10 M€ |
| 10.ª | 29/09/2026 | 17/11/2026, 14h de Espanha peninsular | 21 M€ iniciais |

Ambas estão abertas à data desta verificação; a 9.ª tem elegibilidade específica, não é uma chamada geral diretamente acessível a qualquer pequeno projeto.

O site anuncia e serve os endpoints públicos [calendário, página 2831](https://www.poctep.eu/wp-json/wp/v2/pages/2831) e [abertas, página 9396](https://www.poctep.eu/wp-json/wp/v2/pages/9396). Respondem sem credenciais, com `id`, `link`, `modified` e `content.rendered`. O conteúdo das tabelas coincide com as páginas públicas; são documentos HTML dentro de JSON, não uma API tipada de convocatórias. Datas de modificação recebidas: 30/09/2026 e 09/10/2026, respetivamente.

## Problemas reproduzidos no código preservado

- POCTEP configurado em `proximas-convocatorias/`: quatro extrações, apenas três identidades; omite 9.ª/10.ª. A 6.ª aparece duas vezes; numa extração a abertura é 14/03/2025 e o fecho 20/11/2024. Notícias e referências são interpretadas como chamadas.
- Aplicar o mesmo parser à página de abertas produz seis extrações para duas chamadas, incluindo versões sem datas e uma data de documento de 2025. A atualização sequencial por identidade pode substituir campos corretos por estas extrações. Trocar apenas o URL não resolve.
- No calendário o parser consegue dez identidades com os pares de datas esperados, mas não valida a estrutura das células, inclui texto exterior à tabela no último registo e não conserva a hora oficial. Este resultado isolado não valida o algoritmo.
- O fallback cria uma oportunidade genérica a partir do título «Próximas convocatórias», mesmo sem chamada identificada. Deve ser removido; ausência válida de chamadas não pode ser confundida com estrutura desconhecida.
- Interreg: datas dependentes do fuso e identidade dependente de data/índice; não recupera toda a cobertura da página. Ler datas Excel como valores civis validados, sem inventar horas a partir do ficheiro.
- Transportes antigos não têm limites explícitos de tempo/tamanho. Persistência e notificações antigas não satisfazem o percurso central atual.

## Recomendação e implicações

Recuperar adaptadores próprios para o catálogo central. Para Interreg, conservar o XLSX oficial como fonte das três chamadas gerais, validando-o contra a página; apresentar zero abertas como resultado válido, com cobertura explícita. Para POCTEP, preferir as páginas públicas WordPress verificadas e extrair exclusivamente linhas/células das tabelas esperadas; HTML público é alternativa viável, mas inclui mais conteúdo alheio às chamadas. Não fazer fallback silencioso em erro de estrutura.

Identidades devem incluir fonte, programa/período e número/tipo da chamada; não dependem de título traduzido, posição, abertura ou prazo. Conflitos de duplicados exigem revisão, não «último vence». Preservar datas civis, texto original e, quando confirmadas, hora e zona oficiais. Montante da convocatória não equivale a financiamento por candidatura. Conservar documentos/bases e elegibilidade específica na descrição/proveniência.

A composição atual aceita apenas `C4G_MANUAL`/`EU_FUNDING_API` no catálogo central (`opportunities/repositorySupport.js`, migration central 015); Funding & Tenders tem namespace e worker próprios. Estas fontes não podem ser apresentadas como API Funding & Tenders. Antes de implementação, confirmar contrato de proveniência/jobs e eventual migração incremental, reaproveitando os controlos existentes, sem novo sistema genérico de configuração. Se houver registos legados a reconciliar, inventariar relações e manter UUIDs/histórico/correções; esta investigação não consultou essas bases.

Aceitação a incluir no incremento: fixtures reais (duas abertas POCTEP sem duplicados; Interreg sem falsas abertas), mudanças de esquema, ausência válida versus erro, datas/fusos, identidade estável e repetição idempotente; testes PostgreSQL de histórico/correções/revogação/isolamento; importação real e percurso UI no ambiente habitual. Nenhuma integração fica operacional apenas pelo HTTP 200.

## Provas e limites

- [Verificação HTTP e parsers](../../output/interreg-poctep/verification.json): URLs finais, tipos, tamanhos, hashes e resultados; HTML/XLSX públicos guardados na mesma pasta.
- [Verificação complementar](../../output/interreg-poctep/supplement.json): API WordPress, células Excel originais e seis asserções de auditoria PASS.
- Reprodução: `node output/interreg-poctep/audit.cjs` e `node output/interreg-poctep/supplement.cjs`. Cada execução volta a consultar fontes públicas; a informação pode mudar.
- Sem aplicação de correções, novas importações, alterações de dados, configuração ou serviços. Sem build de frontend ou suite de produção, pois não houve alteração da aplicação. A entrega 4 permanece em curso.

Próximo passo: carregar o incremento da entrega 4 para corrigir os adaptadores e ligá-los ao catálogo central, usando estas provas e preservando relações e histórico.
