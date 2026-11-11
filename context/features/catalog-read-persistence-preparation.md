# GCNI-CAT-01 — modelo, projeções e persistência isolada

Estado: **Complete no âmbito deste incremento de preparação e ensaio**. A melhoria global continua In Progress e não está ativada na APP.
Data: 01/11/2026.

## Resultado

Criado módulo puro `backend/src/opportunities/catalogRead`, sem importação por entrypoints, rotas ou workers. O contrato G1/G2 foi incorporado sem alterar o leitor existente. A extensão versionada e a projeção ligam-se à oportunidade/revisão v2 e ao digest da fonte; o original e o histórico permanecem imutáveis. Não foi implementado serviço HTTP de leitura.

Criada migração candidata `catalog_read_projection_v1.up.sql`, fora do manifesto ativo, e gate PostgreSQL próprio. Nenhuma migração foi aplicada à base habitual e nenhuma fonte foi retomada. Os testes usam fixtures estáticas normativas com alterações sintéticas, sem recolha de dados reais durante a execução.

## Modelo e projeções

| Elemento | Comportamento |
| --- | --- |
| Extensão de revisão | Condições, documentos/versões, conflitos, relações, eventos e evidências com identidade e referências verificadas. |
| Projeção | Determinística para snapshot v2 + extensão + asOf; digest inclui toda a extensão. Nenhum relógio interno, ligação de rede ou escrita. |
| Datas | Preserva datas civis e horas locais sem fuso; não transforma condição em prazo garantido. Cancelamento oficial não é reaberto pela condição. |
| Financiamento | Valor decimal textual, moeda desconhecida preservada, dotação da call distinta do apoio individual; múltiplos totais não são somados. |
| Identidade | Financiamento em cascata mantém o seu ID, separado do tópico/programa de origem; ambiguidade de mapping é assinalada como não suportada, não como ausência de recolha. |
| Documentos | Versões imutáveis, substituição parcial, digest e referências; ciclos e referências inexistentes são rejeitados. |
| Gerações | BUILDING não é visível ao leitor; publicação e apontador ativo transacionais; geração anterior permanece consultável e imutável. |
| Permissões | Roles distintas de proprietário/escritor/leitor; leitor só consulta vistas publicadas. Não há memberships novas para a APP. |

Persistência candidata: cinco tabelas (`revision_extension`, `revision_projection`, `generation`, `generation_item`, `active_generation`) e duas vistas de leitura. FKs, triggers e constraints verificam ligação à revisão, imutabilidade e publicação completa. Ajv/semântica são validados no módulo; SQL não substitui o schema de domínio nem a autoridade de negócio.

## Validação executada

- Suite completa do backend: **2 416 PASS / 0 FAIL / 7 SKIP** (2 423 testes), com quatro processos concorrentes e ambiente sem configuração de bases/fontes. Os sete ignorados permanecem explicitamente ignorados, não contam como sucesso.
- Treze testes novos de projeção, incluindo a regressão de cancelamento e paridade com as 18 raízes e os 105 casos G2. Compilação/sintaxe dos ficheiros JavaScript/CJS alterados passou.
- Gate real em **PostgreSQL 18.3**, cluster novo em loopback e porta aleatória: **14 verificações PASS**. Cadeia base até `035_funding_source_resolution`, com os fingerprints normais, seguida do candidato v2 existente e do novo candidato.
- Provas: preservação do snapshot original; persistência; replay idêntico/alterado; invisibilidade em construção; publicação atómica; rollback de publicação incompleta; leitor sem escrita/tabelas-base; imutabilidade; digest incorreto; FK de revisão errada; geração anterior preservada; leitor concorrente não vê publicação não confirmada.
- Todos os clusters criados por este trabalho foram encerrados e os ficheiros de password efémera removidos. Restam apenas diretórios locais privados de diagnóstico; não integram os entregáveis.

Nenhum teste frontend/build foi necessário: não houve alterações de UI. A suite inicialmente executada sob restrições e concorrência padrão não concluiu e apresentou falhas HTTP; foi preservada, a árvore de processos criada para esse ensaio foi encerrada e a suite completa repetida com condições adequadas. A execução final passou sem modificar expectativas dos testes existentes.

## Autorrevisão e correções

Revisão pelo próprio autor, sem alegação de revisão independente.

1. O digest inicial da projeção não distinguia alterações da extensão que produziam a mesma apresentação. Corrigido incluindo o digest integral da extensão; regressão passou.
2. Uma condição podia sobrepor-se ao estado oficial CANCELLED. Teste de regressão reproduziu a falha; corrigida a precedência e revalidada a suite.
3. Identificadores simultâneos da call/tópico não devem virar NOT_COLLECTED. Aplicada seleção pelo tipo de oportunidade e estado UNSUPPORTED quando a correspondência primária continua ambígua.
4. O digest SQL usava uma expressão não admitida como coluna gerada imutável pelo PostgreSQL. Passou a ser calculado pelo trigger de inserção, antes das constraints, e continua protegido contra alterações posteriores.
5. O primeiro launcher Windows deixou pipes herdados pelo processo PostgreSQL. Corrigido para ficheiros de controlo e encerramento pelo diretório/marcador próprio; o cluster inicial foi encerrado explicitamente e os seguintes automaticamente.
6. A aparente divergência na migração 027 resultava do nome do instalador no cluster de teste. A identidade foi alinhada com o gate existente (`c4g_f12_admin`), sem mudar migrações ou fingerprints. A cadeia completa até 035 passou; não ficou demonstrada qualquer divergência da base habitual. O modo diagnóstico parcial foi retirado do código final.

Veredicto: preparação do modelo/projeções e gate pronta para fechar neste âmbito. Não autoriza instalação habitual nem declara completo o serviço de leitura.

## Limites que permanecem antes da ativação

- Apoios por unidade, taxas não pontuais e outros campos v2 sem correspondência inequívoca com G1 permanecem no snapshot original e são assinalados em `issues`, com qualidade parcial. É necessário completar/rever esses mappings antes de anunciar cobertura integral da nova ficha; não houve descarte do original.
- `acceptanceDigest` é um vínculo documental, não uma autorização. Antes de dar acesso ao escritor, integrar aprovação, auditoria e admissão/fingerprint com os mecanismos atuais. Nenhum conflito material é publicado automaticamente por este incremento; não há escritor operacional ativado.
- O gate verifica Central035 + candidato v2, não uma atualização da base operacional com todos os pacotes posteriores até 045, nem tenants/OIDC reais. Essa validação tem âmbito próprio.
- A migração candidata ainda não tem registo no manifesto/ledger, procedimento operacional de instalação ou recuperação validado na base habitual. Não é para execução manual repetida.
- Projeção asOf e emissão de snapshot HTTP são conceitos distintos. Expiração de tokens, retenção/leases, filtros/ordenação/paginação HTTP, desempenho e revogação permanecem por implementar/testar no serviço. A retenção atual é conservadora: nenhuma geração é apagada.
- V1 continua no leitor existente. As fontes, contas, permissões e navegação atuais da aplicação não foram alteradas.

## Referências

- [Modelo](../../backend/src/opportunities/catalogRead/model.js)
- [Migração candidata](../../backend/database/central/candidates/catalog_read_projection_v1.up.sql)
- [Gate e instruções](../../test/integration/catalog-read/README.md)
- [Testes](../../backend/test/catalogReadProjection.test.js)
- [Contrato e objetivo](catalog-unified-experience.md)

Próximo passo: fechar os mappings ainda assinalados e preparar a admissão/autoridade da migração candidata, para depois integrar o serviço de leitura com snapshots e paginação, mantendo as fontes suspensas.
