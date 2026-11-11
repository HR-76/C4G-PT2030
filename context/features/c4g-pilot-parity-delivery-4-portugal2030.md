# Entrega 4 — importação Portugal 2030

Estado: Review · 18/10/2026. Preparação implementada e validada; importação real pendente por decisão do utilizador de manter a configuração para o final. [Revisão e evidência](../reviews/c4g-pilot-parity-delivery-4-portugal2030.md). A entrega 4 global continua em curso.

## Contrato e âmbito

Reutilizar `Import.jsx` e a composição visual do piloto (zona de ficheiro, pré-visualização em tabela, ações e histórico), ligados ao contrato XLSX F12 existente. Importação cria oportunidades privadas da organização ativa, conforme `opportunity-catalog.md`; não publica automaticamente no catálogo comum. Não reativar rotas legadas ou inventar armazenamento alternativo. Não alterar deduplicação, permissões, estrutura de dados, limite de 10 MiB/5.000 linhas ou escolha explícita de folha. MFA segue a decisão global de escolha individual, sem mensagens universais de obrigatoriedade.

O armazenamento privado do Excel original/relatório e a inspeção antivírus são dependências existentes de F11. A instalação habitual tem importação desativada. O utilizador confirmou neste turno: «Manter configuração para o final; preparar o percurso agora». Interface, parser e testes serão recuperados agora. Importação real só pode ser declarada operacional após composição e validação dos serviços; fixtures serão identificadas como teste. Não substituir serviços externos por armazenamento local na instalação habitual.

## Aceitação

1. Manter identidade C4G e composição/densidade do piloto: ficheiro, folha, validação, pré-visualização, confirmação, resultado por linha e histórico. Datas civis apresentadas sem conversão de fuso; montantes não inferidos.
2. Mostrar correspondência de colunas e colunas ignoradas; colunas desconhecidas exigem decisão explícita. Erros por linha legíveis e códigos disponíveis; nenhuma oportunidade criada durante pré-visualização.
3. Resultados distinguem criadas, duplicadas, possíveis duplicados, rejeitadas e falhas; revisão humana e relatório CSV preservados. Permitir retomar uma importação carregada ou validada através do histórico.
4. Falha de histórico nunca equivale a histórico vazio; indisponibilidade de configuração bloqueia upload e explica a dependência. Operações pendentes impedem ações concorrentes na página; respostas tardias e downloads de outra sessão/organização são descartados. Repetição de upload incerto usa a mesma intenção.
5. Parser preserva números físicos das linhas, deteta fórmulas mesmo após linhas vazias e lê datas Excel como datas civis. Worker recusa bytes divergentes do original aprovado antes de criar oportunidades.
6. Testes direcionados backend/frontend, sintaxe, build e percurso no browser desktop/móvel com comparação ao piloto. Dados de teste não são confundidos com importações reais. Preservar dados/histórico existentes.

## Plano visual

Cores já aprovadas: branco #FFFFFF, fundo #F6F8F8, texto #20262B, navegação #075B59, destaque #5FAD2F. Tipografia de sistema, alinhamento à esquerda. Reutilizar classes do piloto: `toolbar`, `upload-zone`, `import-preview`, `dl-list`, `table-wrap`, `data-table`, `form-actions`, `detail-section`. Sequência: ficheiro → folha/validação → pré-visualização → resultado; histórico permanece abaixo. Sem nova biblioteca visual ou cartões decorativos.

## Validação e compatibilidade

33 testes backend, 11 frontend, build, sintaxe, PostgreSQL descartável com API/worker e duas organizações, e Chrome desktop/móvel PASS. Excel oficial conferido: 177 linhas válidas, sem erros/IDs repetidos, datas estáveis nos três fusos testados. Browser habitual confirma importação não configurada; pré-visualização/resultado foram demonstrados com HTTP simulado identificado como ensaio. Zero importações reais e fingerprints de negócio inalterados.

GET de uma importação carregada/pronta passa a incluir as folhas do original verificado para retoma. Mapping versão 2 incorpora a versão do parser: confirmação com digest antigo não autoriza interpretação nova. Antes de ativar em bases com importações preexistentes, inventariar/reconciliar confirmações e revisões pendentes; não alterar histórico automaticamente. Neste turno não se reiniciou nem ativou o worker de importações.

Próximo passo: recuperar e verificar os alertas existentes, mantendo a configuração documental para o final.
