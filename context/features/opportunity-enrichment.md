# P3 — enriquecimento das oportunidades

Estado: In Progress — 29/10/2026. Âmbito autorizado pelo plano P0–P5 e pelo pedido de iniciar P3. A extensão do motor de matching aguarda clarificação; a recolha factual pode avançar independentemente.

## Contrato

Enriquecer as oportunidades EU Funding & Tenders, incluindo cascatas, mediante consulta individual completa e limitada. A pesquisa geral continua a descobrir identidades; o detalhe verifica cada identidade antes de criar ou atualizar. Preservar UUIDs, revisões, candidaturas, correções manuais e as seis resoluções P2. Os restantes adaptadores mantêm o âmbito aprovado para P4.

Adicionar `sourceEnrichment` opcional ao snapshot existente, sem nova tabela ou migração: versão do contrato, versão do mapeamento, instante da observação e campos factuais. Campos: programme, instrument, budget, support, rate, territories, beneficiaries, consortium, conditions, documents, submission. Cada campo contém estado PUBLISHED, NOT_FOUND, CONFLICT ou UNSUPPORTED, itens e indicação de truncatura. Cada item tem valor tipado e evidência com URL pública HTTPS, localização, excerto e instante de observação. Ausência do objeto significa ainda não recolhido. Falha de consulta preserva a revisão anterior e a sinalização da fonte.

Valores publicados não constituem validação de elegibilidade. Países, beneficiários, consórcio e taxa conservam o texto e as remissões documentais; sem interpretação automática de condições ou preenchimento por omissão. Fonte HTML é convertida em texto inerte. Documentos e submissão têm ligações seguras, separadas; presença de ligação não confirma abertura. Não descarregar documentos, executar URLs da fonte ou guardar páginas completas nesta fase.

Orçamentos e contribuições são distintos dos campos legados fundingAmountMin/Max. Números decimais exatos, moeda explicitamente nula quando não publicada, período e âmbito conservados. Não somar ações/anos/grupos, não dividir orçamento por número de projetos, não inferir moeda. Zeros predefinidos da API permanecem desconhecidos. Associar uma linha financeira apenas pelo identificador explícito da ação; nunca pela chave interna do grupo. Um orçamento pode ser partilhado: mostrar essa incerteza. Tipos de ação são instrumentos, não programas.

Taxonomia validada contra facetas oficiais e versionada. IDs desconhecidos mantêm o ID de origem e aviso explícito; sem classificação por prefixo nem UPDATE sobre histórico. Corrigir CEF/DIGITAL na função comum com regressão.

Variantes de uma identidade: dados não vazios equivalentes podem ser conciliados; diferenças materiais ficam em conflito por campo, sem eleger uma origem globalmente. Contradições temporais continuam submetidas a P2. Para os seis resolvidos, só aceitar enriquecimento calculado da mesma evidência integral arquivada, preservando todos os campos anteriores e a resolução. O repositório comprova novamente esse vínculo antes de aplicar. Mudança da evidência reabre revisão.

Limitar o enriquecimento a 12 KiB e o snapshot ao limite existente de 32 KiB, contando também a representação JSONB. Truncatura explícita, seleção determinística e excertos curtos. Guardar apenas dados públicos necessários; snapshots históricos seguem a retenção imutável do catálogo, sem limpeza automática. Observações repetidas não criam revisões só por mudarem de hora; conservar a primeira observação do facto inalterado e atualizar a observação operacional existente.

Ativação por opção explícita, desligada por omissão. Código e ensaios offline não autorizam ativação Dev, recolha integral ou SQL. Gate PostgreSQL próprio e ativação local têm autorização separada, depois de preparados.

## Aceitação e validação

1. Amostra pública estratificada HORIZON/CEF/DIGITAL/Erasmus/ESC/cascata tipo 8; confrontar formas, identidade e faceta oficiais. Evidência em `output/funding-enrichment-20261029/` e pesquisa documentada.
2. Regressões para CEF/DIGITAL, mapeamento desconhecido, grupos repetidos, zero, casas decimais, moeda ausente, limites e HTML/URLs inseguros.
3. Persistência de novos factos, alteração material gera revisão, recolha idêntica não gera revisão; retoma e manual corrections preservadas. Falha ou conflito não apaga dados.
4. Os seis resolvidos mantêm datas, horas, resolução e histórico; evidência alterada exige revisão; guarda de persistência impede enriquecimento forjado.
5. Lista e detalhe distinguem orçamento e apoio, exibem incompletude/conflitos, condições/documentos e origem. Chrome desktop/móvel, teclado e ausência de overflow.
6. Nenhum facto confirma critérios privados nem transforma matching de afinidade em elegibilidade. Continuação da ponte para critérios depende da clarificação de âmbito solicitada.
7. Testes direcionados, suites backend/frontend, sintaxe e build. Gate separado com PostgreSQL descartável testa persistência real, retoma, permissões e histórico antes da ativação.
