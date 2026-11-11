# Normalização comum de oportunidades e fontes

Incremento ativo — **Review: auditoria factual das pendências EU concluída; correções identificadas**. [Relatório](../reviews/opportunity-data-standardization/eu-pending-audit.md): os 137 arquivos `REVIEW` foram rederivados e têm a mesma causa de migração v1 sem baseline; cinco `CONFLICT` carecem de nova evidência oficial; 393 alvos permanecem por tratar. A 11145 mantém `120000` numérico e sete prazos, mas o financiador legado atribuído à Comissão Europeia contradiz a descrição oficial, que identifica Gnomon como concedente direto. A moeda da dotação total não é declarada no registo API arquivado. EU continua `QUIESCED`, fence 7, sem retoma ou aceitação nesta auditoria. A [reconciliação 044](../reviews/opportunity-data-standardization/expired-run-reconciliation-044.md) encerrou o run expirado e revalidou o código atual.

Incremento histórico — **043 instalada e primeiro ciclo suspenso após recuperação**. [Contrato](../references/opportunity-v2/writer-execution-043-contract.md), [relatório](../reviews/opportunity-data-standardization/writer-execution-043.md) e [descritor](../references/opportunity-v2/writer-execution-043.json): backup/restauro próprio236 tabelas55775 linhas, plano e autoridadeOIDC renovados;043/034, um cicloEU,138 arquivos verificados/137REVIEW/11145UNCHANGED. ControladorFAIL por HTTP incerto, recuperação autenticadaPASS com mesmosIDs e nenhum novoenqueue. FinalQUIESCED/fence7/zero leases, saúdeOK; um run expirado, cincoCONFLICT e393 alvos por tratar. DadosPASS com538heads/1502revisões/129tabelas tenant preservados; paridade globalINCOMPLETE_CODE_DRIFT por alterações paralelas posteriores à aprovação. Estas pendências de reconciliação e código foram fechadas no incremento044; as provas043 mantêm o seu resultado histórico. Política v2 existente sem perdas/conflitos e novosIDs/v1 em revisão mantém-se.

Incremento histórico — **Janela043 preparada e aprovação autenticada registada**. [Contrato](../references/opportunity-v2/writer-window-043-contract.md), [relatório](../reviews/opportunity-data-standardization/writer-window-043.md) e [runbook](../references/opportunity-v2/writer-window-043-runbook.md): preparação042/034 e aprovação anteriores. A execução pedida foi realizada no incremento acima, com nova preparação, backup e aprovação próprios; os valores de fence/validade da preparação antiga são históricos.

Incremento anterior — **Review: escritor automático EU v2 integrado e ensaiado**. [Contrato](../references/opportunity-v2/eu-writer-contract.md) e [relatório](../reviews/opportunity-data-standardization/eu-writer.md): atualização automática de v2 sem perdas/conflitos; novos IDs/v1 em revisão. Gate histórico23 checks PASS/842 hashes/cleanup; backend2216 PASS/7 SKIP,frontend494/build PASS. SQL043 registado em pacote separado. A preparação da janela pendente nesse relatório está satisfeita pelo incremento acima. O estado abaixo regista a janela11145 anterior.

Estado: **Review —11145 aceite no ambiente habitual; restantes fontes pendentes**. Pedido do utilizador: uniformizar a recolha com uma estrutura fixa, adaptando APIs/fontes e o Excel Portugal2030. S0 está fechado; S1–S6 entregaram domínio, adaptadores, arquivos, consumidores compatíveis e persistência ensaiada. A [janela habitual](../reviews/opportunity-data-standardization/habitual-11145.md) instalou042/034, renovou preview/backup/restauro, recolheu11145 e aprovou/aceitou a revisão5 por OIDC real. SQL120000, moedaNOT_FOUND, sete prazos e preservação de537 outras oportunidades/1501 revisões/129 tabelas tenant PASS. EU está quiescente, fence3; a recolha automática exige writer compatível com v2 antes da retoma. Defaults do código desativados, seleção habitual explícita. [Descritor](../references/opportunity-v2/habitual-11145.json), [executor](../references/opportunity-v2/executor-11145-runbook.md) e [recuperação](../references/opportunity-v2/window-11145-runbook.md). POCTEP10 e cadeia documental central PT2030 continuam bloqueadas.

Pacote normativo: [contrato v2.0](../references/opportunity-v2/contract.md), [JSON Schema](../references/opportunity-v2/opportunity-v2.schema.json), [mapeamentos](../references/opportunity-v2/mappings.md), [exemplos e critérios](../references/opportunity-v2/examples.md), [manifesto](../references/opportunity-v2/manifest.json) e [validação offline](../references/opportunity-v2/validation.json). As decisões finais deste pacote substituem a formulação proposta inicial.

Este plano concretiza P3/P4 do [plano de calibração](opportunity-sources-calibration.md), preserva P0/P1/P2 existentes e não substitui a arquitetura multi-instituição aprovada. [Análise do Excel e mapping completo](../references/pt2030-annual-plan-2026-10-30.md).

## Objetivo e âmbito

Todas as fontes produzem o mesmo contrato tipado e versionado de oportunidade. API, Excel e página HTML diferem no adaptador; catálogo, lista, detalhe, filtros, exportação, dashboard e matching consomem os mesmos conceitos e valores.

Estrutura fixa significa campos, tipos, cardinalidades, semântica e estados de ausência definidos. Não significa inventar valores para preencher tudo. Cada facto deve ser rastreável à origem e à regra de transformação.

Fontes abrangidas: EU Funding & Tenders, incluindo cascatas; seleções Horizon/Euratom e Erasmus do índice europeu; Interreg Europe e POCTEP no âmbito já aprovado; Portugal 2030 publicado e planos previstos, separados. Criação manual C4G deve produzir o mesmo contrato. Projetos CORDIS autónomos, outros programas Interreg e novas fontes Erasmus nacionais não são introduzidos implicitamente.

Catálogo comum administrado pela C4G; interesses, avaliações e candidaturas continuam privados de cada organização. Preservar UUIDs, revisões, observações, candidaturas, interesses, correções manuais e resoluções anteriores. Matching permanece determinístico, sem transformar factos da fonte em critérios de elegibilidade confirmados.

## Base factual

1. A auditoria desta sessão confirmou na API CE, para `CASCADE:11145`, orçamento `120000`, acrónimo SUSA e acordo `101190010`; não comprovou a persistência atual. O parser individual suporta o orçamento, mas o enriquecimento é opcional e o contrato não contém os dois campos do projeto.
2. A listagem `fundingTenders/repository.js:219` omite `sourceEnrichment`; o detalhe devolve o snapshot. Corrigir esta divergência faz parte da normalização.
3. O Excel tem 177 registos/IDs únicos, 13 colunas, dois avisos multiprograma, uma dotação zero e datas explicitamente previstas. Seis colunas são ignoradas pelo parser existente.
4. O motor XLSX anterior escreve no tenant. A composição central Portugal 2030 permanece indisponível, conforme contrato de ownership; não deve ser reutilizada silenciosamente como central.
5. A qualidade atual avalia financiamento pelos campos legados; um score de completude não certifica exatidão com a fonte.
6. O gate de descoberta de novas identidades P3 tem incompatibilidade documentada em [funding-enrichment-test-reconciliation](funding-enrichment-test-reconciliation.md). Corrigir antes de ativar enriquecimento integral.

## Contrato comum fechado em S0

Versão: `schemaVersion: 2`, `contractVersion: opportunity-v2.0`. O quadro resume conceitos; nomes, envelopes `Fact<T>`, campos obrigatórios e limites exatos estão no schema normativo. Valores usam `.value`; o estado de ausência e a evidência pertencem ao mesmo facto. Identidade interna/administração ficam no envelope do servidor; cálculos do relógio ficam no DTO, fora do snapshot factual. Os contratos v1 em uso não são alterados nesta fase.

| Bloco | Conteúdo e cardinalidade | Regra comum |
| --- | --- | --- |
| `identity` | Tipo CALL/CASCADE_CALL, referências oficiais tipadas; UUID C4G no envelope do servidor | Tópico, chamada, projeto, acordo e ID do plano são entidades distintas |
| `sourceRecords[]` | namespace, externalId textual, papel da origem, URL/documento, observação | Fonte funcional distinta do transporte API/XLSX/HTML; várias observações podem descrever uma oportunidade |
| `description` | título, resumo, língua | Texto original rastreável; HTML tornado inerte; sem tradução inventada |
| `programmes`, `funds` | Fact de IDs/códigos/rótulos, esquema e versão | Programa, fundo e instrumento separados; aceitar múltiplos; período financeiro na dotação |
| `parties[]` | nome/ID e papel: financiador do programa, autoridade de gestão, concedente, publicador | Não preencher financiador com programa ou com o nome do portal |
| `classification` | natureza do aviso, instrumentos, objetivos específicos, temas | Texto publicado + códigos mapeados quando inequívocos |
| `publication` | PLANNED/PUBLISHED/UNKNOWN e evidência | Um plano publicado contém previsões; publicação do documento não confirma publicação da chamada |
| `schedule` | abertura/fecho previstos, calendário confirmado, rondas/cut-offs, período planeado | Precisão e natureza previstas/confirmadas explícitas; próximo e último prazo são derivados |
| `status` | Estado/código publicado; estado efetivo/frescura no DTO e lifecycle/validação no envelope | Não confundir aberta, arquivada, por rever e fonte indisponível |
| `financing` | dotações e repartições, apoio por candidatura, taxas e custos elegíveis, quando publicados | Natureza, âmbito, moeda, unidade, escala, período e ligações a fundo/programa explícitos |
| `eligibility` | beneficiários, territórios, condições, texto original e conceitos normalizados | Condições publicadas não confirmam elegibilidade da organização; âmbito territorial explícito |
| `applicationModes[]` | modalidades de candidatura e condições associadas | Preservar combinações; não equiparar parceria, copromoção e consórcio automaticamente |
| `relatedProject` | acrónimo, nome, número de acordo textual, URL | Opcional; ausência pode ser não aplicável quando demonstrado |
| `links` | fonte oficial, submissão, documentos | Tipos separados; ligação não prova disponibilidade nem abertura |
| `quality`, `provenance` | estado por campo, referências de evidência, versão de transformação, observações | Exatidão, completude, frescura e cobertura são indicadores distintos |

### Regras transversais

- Distinguir disponibilidade PRESENT/NOT_FOUND/NOT_COLLECTED/NOT_APPLICABLE/CONFLICT/UNSUPPORTED de natureza PLANNED/CONFIRMED e de verificação. PRESENT significa observado, não certificado. Null/lista vazia exige estado explicativo; não usar texto «Por confirmar» como valor de data ou dinheiro.
- Para XLSX, evidência aponta para hash, folha, linha física/célula e valor original. Para API, para observação, identidade, caminho JSON e valor. Para HTML, URL, secção e excerto. Reutilizar referências de observação sem duplicar payload completo em cada campo; não guardar segredos nem anexar dados privados.
- Preservar factos estruturados essenciais completos. O v2 fixa snapshot até 256 KiB e limites por coleção; limites legados permanecem restritos a v1. Paginação/projeção de leitura não pode eliminar factos na persistência. Rejeitar explicitamente excesso não representável, sem truncatura silenciosa de dinheiro/calendário.
- Objetos v2.0 são fechados, sem extensões por fonte; conceitos adicionais exigem evolução versionada. Não criar um saco JSON arbitrário consumido diretamente pela UI.
- Não encontrado numa consulta completa difere de erro de consulta ou de campo não pedido. Falhas mantêm o último valor conhecido com frescura/erro visível; ausência isolada não cancela nem elimina oportunidades.

### Dinheiro

Decisão S0: valores financeiros novos com até 24 dígitos inteiros e 8 decimais, projeção PostgreSQL `NUMERIC(32,8)` e string decimal canónica na fronteira JSON. Uma string exata `"120000"` não é uma string de apresentação `"120 000,00 €"`. Validar antes do cast, sem arredondar; o snapshot imutável é a autoridade e as projeções são derivadas da mesma revisão. Decimais v1 fora do limite mantêm leitura histórica sem coerção. DDL e execução ficam nas fases seguintes.

Guardar montante, moeda ISO quando comprovada, unidade/escala original, natureza e âmbito. Distinguir dotação total, parcela por fundo/programa/ano e limite individual. Não somar valores repetidos por programa, dividir por número de projetos ou converter moeda sem regra aprovada. Ausência de moeda é null com motivo; regra de moeda herdada da documentação exige evidência e âmbito.

Preservar zero literal do Excel e sinalizar semântica não esclarecida; não transformá-lo automaticamente em ausência ou «sem financiamento». Zeros predefinidos de APIs só são tratados como desconhecidos segundo regra específica documentada. Separadores de milhar, NBSP, vírgula decimal e unidades como M€ são interpretados pelo adaptador conforme formato comprovado, não por heurística global.

### Datas e estados

Data civil: `YYYY-MM-DD`, sem inventar hora. Instante: UTC ISO 8601 com `Z`, conservando valor/fuso originais; hora local sem offset exige fuso documentado e tratamento de ambiguidades DST. Períodos incompletos conservam limites/precisão próprios.

Datas previstas e confirmadas coexistem. Chegar à abertura prevista não transforma PLANNED em OPEN. `nextDeadline` deriva do calendário confirmado e do instante de referência; `finalDeadline` é o último prazo confirmado, independentemente desse instante. Previstas têm projeções próprias. Datas de ingestão/atualização da fonte não são prazos. Preservar todos os cut-offs e distinguir estado oficial de cálculo temporal e frescura.

Quadrimestre é um período de quatro meses no contexto do plano; conservar rótulo e período-base. A página PT2030 consultada usa setembro–dezembro 2026, janeiro–abril 2027 e maio–agosto 2027. Não interpretar Q1 como janeiro–março nem corrigir datas que pareçam divergir do período sem evidência. NUTS exige versão de classificação conhecida; não mapear AML/RAA/RAM para códigos por inferência.

### Identidade, precedência e revisões

- UUID C4G estável; identidade externa por namespace lógico/ID. Hash/folha/linha identificam a observação, não a oportunidade através de versões.
- Mesmo ID e mesmos factos: observação operacional atualizada, sem revisão artificial. Mudança material: nova revisão com diff e proveniência. ID igual não significa conteúdo inalterado.
- API e Excel não criam duplicados quando uma identidade equivalente está comprovada. Plano e aviso publicado só são ligados por referência estável verificável ou decisão editorial; título/programa semelhantes geram candidato, não fusão automática.
- Precedência por campo e papel da fonte: aviso publicado pode confirmar o calendário, mantendo a previsão histórica; atualização oficial posterior pode alterar o facto correspondente; um plano posterior não substitui um prazo confirmado. Conflitos entre fontes equivalentes ficam visíveis. Não adotar «última recolha ganha».
- Correções editoriais mantêm âmbito, autoria e conflito com novos dados da fonte. Vínculos privados e snapshots das candidaturas não são reescritos. Alterações relevantes alimentam os avisos internos ao gestor já previstos em P5.

## Plano de execução

### Incremento S6 autorizado — ensaio anterior à ativação

Implementar reconciliação determinística com preview por identidade, digest da intenção/candidato/mapping/revisão corrente e decisão explícita. Preservar UUIDs, revisões v1, correções/resoluções e referências privadas. Não inferir equivalência por título, não ligar plano a aviso por similaridade, não substituir perda/conflito sem revisão. Candidatos novos e alterações aprovadas no ensaio usam exclusivamente fixtures; o preview não escreve nem promove dados habituais.

Preparar SQL aditivo candidato e writer de revisões v2 não ligado à composição habitual, incluindo projeções financeiras/calendário, identidade, observações, CAS, idempotência e auditoria transacional. Ampliar de forma condicional o armazenamento de snapshots v2 de candidaturas em SQL candidato tenant, preservando os limites e contratos v1. Não alterar migrações históricas, checksums ou manifestos ativos. Qualquer nova capacidade depende de detetar o schema efetivamente instalado; sem schema, mantém-se recusa explícita.

Executar PostgreSQL local descartável, criado especificamente para este ensaio, sem credenciais/configuração da APP e sem acesso a bases habituais. Bootstrap a partir das migrações do repositório, com identidades/dados sintéticos e os exemplos públicos normativos; aplicar SQL candidato apenas aí. Registar versões/hashes, resultados, fingerprint candidato, limitações e limpeza dos recursos identificados pelo gate. Não copiar dados reais nem executar recolhas externas.

Aceitação: (1) seis snapshots S0 e corpus177/Interreg/manual conciliados com contagens e propostas sem escrita; (2) snapshots v1/UUIDs/correções/vínculos antes/depois iguais; (3) persistência v2 exata de120000/moeda ausente, zero, valores extremos e sete cut-offs, sem arredondamento; (4) paridade PostgreSQL→JS de estados/próximo/último prazo e filtros, incluindo DATE/PERIOD, fases/ambiguidades, meia-noite e ano ISO0000; (5) CAS/stale/replay divergente/rollback/autoridade/roles e isolamento testados; (6) aplicação/interesse v2 grande suportado apenas no schema candidato, v1 intacto; (7) HTTP/leitura comum sobre revisão persistida e plano/custo SQL medidos em corpus sintético. Corrigir achados com regressões, executar suites completas/build/sintaxe e revisão independente. Aprovação deste ensaio não ativa fontes, não reinicia serviços habituais e não aplica migrations no ambiente ativo.

### Incremento S5 autorizado

Ligar leitores e consumidores a uma projeção aditiva `readModel`, versão `opportunity-read-v2.0`, derivada exclusivamente da revisão aceite/histórica autorizada. Lista e detalhe partilham versão de origem, referência da revisão, factos tipados (projeção S1), identidade, fontes, calendário calculado, qualidade e frescura. O snapshot original e os campos v1 mantêm compatibilidade; não promover candidatos nem fabricar snapshots v2 de dados v1. A autoridade, lifecycle e validação permanecem no envelope do servidor. Um relógio único por resposta alimenta projeção e filtros.

Implementar filtros antes da paginação sobre os conceitos comuns: programas plurais, referências, estado PLANNED distinto de UPCOMING/OPEN e calendário confirmado separado do previsto. SQL e projeção JavaScript têm de seguir a semântica S0, incluindo precisão DATE/PERIOD, múltiplos cut-offs e revisão da fonte. Listas limitadas a 1 MiB, detalhes a 512 KiB; reduzir tamanho da página com cursor correto ou recusar excesso, sem truncar montantes/calendário. Excertos de resumo devem ser identificados. Qualidade contabiliza disponibilidade, cobertura e motivos de revisão; não mede exatidão nem confirma elegibilidade.

Adaptar a apresentação comum de lista/detalhe e a exportação da página visível para usar os mesmos valores, sem parsers por fonte no React. Preservar decimais como strings, moeda desconhecida e zero; dotações plurais não são somadas. Mostrar projeto/acordo, prazos, previsões, estados de ausência e conflitos relevantes. Dashboard, matching determinístico e resumos de candidaturas/interesses consomem a mesma revisão/semântica; campos importados não criam critérios editoriais. Snapshots privados existentes permanecem intactos. Novos snapshots v2 que excedam o limite atual de uma tabela privada são recusados explicitamente até à migração aditiva S6, sem recorte silencioso.

Aceitação S5: 11145 mantém 120000/moeda desconhecida, SUSA/acordo e sete prazos em lista/detalhe/exportação; planos177 permanecem PLANNED, multiprograma não duplica dinheiro e zero mantém interpretação; v1 preserva enriquecimento parcial/CONFLICT/UNSUPPORTED e histórico. Testar ligação revisão→HTTP→UI, filtros/paginação, limites, qualidade, dashboard/matching e isolamento/autoridade existentes. Validar focos, suites completas, sintaxe, build e interface com fixtures isoladas. Nenhuma alteração do pacote S0, SQL aplicado, reprocessamento histórico, ligação ao arquivo candidato, ativação de escritores v2 ou serviço habitual nesta fase.

### Incremento S4 autorizado

Implementar adaptadores Interreg Europe/POCTEP e autoria manual que emitam snapshots completos no contrato S0 imutável. As identidades oficiais existentes mantêm namespace e referência; a autoria editorial C4G não cria identidades fictícias de conector. Cobertura limitada às chamadas gerais do ficheiro oficial Interreg Europe e às tabelas oficiais POCTEP; outros programas Interreg continuam não suportados.

Interreg/POCTEP: conservar os bytes oficiais e hashes, rederivar o snapshot antes de arquivar, extrair dotações estruturadas sem converter orçamento da chamada em apoio por projeto, distinguir dotações iniciais, datas civis e horas publicadas. Só converter para UTC quando a zona esteja comprovada; declarar conflitos entre calendário e detalhe. Estado, ausência e cobertura não podem ser preenchidos por inferência silenciosa. Composição opt-in, desligada por omissão, com arquivo candidato central obrigatório antes da aplicação do resultado legado.

Manual: DTO fechado de factos v2, título obrigatório, listas plurais e valores decimais exatos. O servidor atribui identidade editorial, autoria, instante, proveniência e referências de evidência; o cliente não certifica qualidade nem origem. Factos são declarações editoriais não verificadas; não preencher ausências como pesquisa oficial concluída. Preparar porta central transacional com autoridade C4G atual, idempotência por administrador/pedido, auditoria e arquivo aditivo imutável. Preservar rota, formulário e recuperação v1 existentes; publicação/consumo v2 pertencem a S5/S6.

Critérios de aceitação S4: corpus oficial reproduzível e snapshots válidos; valores monetários e prazos comprovados por regressões; cobertura e conflitos explícitos; evidência alterada/forjada e replay divergente recusados; autoridade recusada antes de escrita manual; integração oficial candidata sem possibilidade de perder a obrigação de arquivo numa retoma; compatibilidade v1 preservada. Executar testes focados, suites backend/frontend, build e sintaxe. SQL permanece fora do manifesto executável; nenhum gate PostgreSQL, migração, recolha APP, publicação ou reinício habitual nesta fatia.

### Incremento S3 autorizado

Implementar `portugal2030/planXlsxV2.js` sobre bytes XLSX com parsing XML lexical limitado, sem executar fórmulas/links. Resultado por linha física, todas as13 colunas conservadas com tipo/valor/digest e snapshot canónico validado pelo contrato v2; ID do plano distinto do código definitivo. Mapping S0 preservado: datas previstas, PLANNED, listas plurais sem duplicar dotação, decimal exato, zero explícito e moeda/taxonomias não inferidas. Cinco snapshots completos e projeção independente das177 linhas são oráculos de regressão. Copiar os bytes originais para fixture reproduzível, sem modificar o original nem os16 artefactos S0.

Composição central nova e injetável para preview e confirmação de candidatos, com autoridade C4G atual verificada antes da leitura e novamente na transação de escrita; documento/versionamento/hash/tamanho e estado AVAILABLE+CLEAN provenientes exclusivamente de porta documental central confiável. O workflow tenant e a composição F11 organizacional não são redirecionados para organizationId=null. O parser puro pode analisar o corpus offline; o workflow central recusa documentos sem prova central verificada. Preview liga ficheiro/folha/mapping/resultado por digest; confirmação relê e compara a intenção, sem aceitar snapshots ou estados de scan enviados pelo cliente.

Preparar arquivo central aditivo e SQL candidato fora do manifesto executável: previews, resultados por linha, observações e revisões candidatas imutáveis por identidade do plano. Repetição idêntica não cria revisão; alteração material produz nova revisão candidata, com concorrência/CAS e replay protegidos; correções/editorial, dados publicados e vínculos privados não são reescritos. Guardar todas as linhas, incluindo erros/conflitos, sem publicação parcial silenciosa. O arquivo é independente do writer v1 e não publica revisões do catálogo. Dimensão dos lotes e limites totais explícitos, sem truncatura.

F11 e F9 atuais são tenant e não oferecem armazenamento/fila centrais de XLSX concretos; nesta fase ficam portas exigidas e desenho de ativação, sem declarar upload/antivírus/worker central em funcionamento. Não adicionar rotas ou ativar importação real sem essas dependências. Spike da API publicada usa fontes oficiais e só implementa adaptador se contrato, identidade e semântica forem comprovados; não ligar IDs de plano a avisos por semelhança de título.

Aceitação S3:177/177 linhas e2301 células reconciliadas; cinco exemplos semanticamente iguais; nenhum dos13 campos silenciosamente descartado; preview estável para a mesma intenção, mapping/bytes alterados exigem novo preview; plano mantém previsão; idempotência/revisões candidatas, autoridade revogada e documento não limpo/tenant recusados; zero chamadas a escritores tenant. Testes RED→GREEN, suites completas, build e revisão; SQL/infraestrutura/antivírus reais e publicação/ativação permanecem gates posteriores explícitos.

### Incremento S2 autorizado

Adaptador puro EU tipo1/tipo8 sobre evidência completa verificada, com resultado validado pelo contrato v2. O lookup individual do conector expõe o snapshot canónico separado dos campos v1; descoberta reduzida nunca produz esse snapshot. Preservar todos os valores/estados/evidências sem `fitEnrichment`, com11145 como regressão normativa, incluindo dotação120000, moeda não publicada, apoio mensal separado, SUSA/acordo e sete cut-offs. Seleções CORDIS/ERASMUS mantêm namespaceEU_FUNDING_TENDERS; projetos autónomos não são introduzidos.

Corrigir descoberta P3 com `funding_cycle_seen`/`funding_batch` existentes: IDs inéditos ficam pendentes de lookup individual antes de qualquer criação, sem inserir IDs inexistentes em `funding_refresh_target` nem remover a sua FK. Novo checkpoint de detalhe distingue descoberta de manutenção KNOWN. Stage/apply exigem lookup completo, identidade correspondente e estado reconhecido; falhas/conflitos/ausências ficam contabilizados e não criam oportunidades. Preservar retoma, CAS/fences, idempotência, correções e resoluções anteriores; modo legado desativado mantém compatibilidade.

Persistência do v2 nesta fase é **arquivo de candidatos**, distinto da revisão publicada do catálogo: snapshot/evidência/digest/mapping vinculados ao run/ID externo e revalidados, sem FK obrigatória a identidade de catálogo. Preparar SQL candidato fora da sequência executável e porta transacional injetável. A composição habitual não o ativa; snapshot v2 recebido sem arquivo configurado falha explicitamente, nunca é descartado ou convertido para caber em v1. Escrita/publicação de revisões v2 e leitores de catálogo permanecem dependentes de S5/S6. Não aplicar SQL, ativar modos, reiniciar serviços ou executar recolhas reais neste incremento.

Aceitação S2: regressãoP3 RED→GREEN sem criação anterior ao detalhe; lookup11145→adaptador→validação→stage de candidato preserva factos; rejeitar evidência adulterada/incompleta, seleção errada, conflito, excesso e replay divergente; falhas e conclusão de ciclos não ocultam pendências. Testes focados, suites completas, build e revisão, com limites da prova SQL explicitados.

### Incremento S1 autorizado

Implementar módulo CommonJS puro em `backend/src/opportunities/v2/`, com schema idêntico ao S0 e fachada versionada. Validar JSON fechado e invariantes de referências, dinheiro, calendário, identidades e limites; normalizadores explícitos sem heurística de fonte; projeção temporal com relógio fornecido; digest/comparação semântica sem efeitos. O leitor v1/v2 mantém snapshot original e versão, com projeção de leitura conservadora e estados/truncatura históricos; uma projeção v1 não é apresentada como snapshot factual v2 completo.

O schema usa Draft2020-12 com formatos ativos e sem coerção, preenchimento de defaults ou remoção de propriedades. A dependência de validação fica fixada no lockfile. Testes exercitam os seis snapshots normativos, entradas inválidas/hostis, precisão decimal, Excel1900/1904, cut-offs, ausência/conflito, digests e leitura v1. A revisão verifica que não há imports do módulo novo em coletores/rotas/jobs ativos.

Persistência S1: especificação aditiva com tabelas/colunas/constraints, projeções por revisão, transação/CAS, permissões, manifesto candidato e matriz de gates. Não incluir SQL pendente na sequência executável, não alterar fingerprints ativos, não aplicar SQL nem reprocessar dados. A integração dos escritores/consumidores e os gates reais permanecem nas fases subsequentes. Saída S1: testes focados, suites locais e build registados; falhas preexistentes separadas; desenho e limitações documentados.

| Fase | Entrega | Critério de saída |
| --- | --- | --- |
| S0 — concluído | Contrato v2.0, schema fechado, seis snapshots e projeção das 177 linhas; evidências identificadas por hash | 91 verificações offline positivas e 21 casos estruturais inválidos rejeitados; 13 colunas/2301 células reconciliadas; pendências representadas explicitamente |
| S1 — implementado, Review | Módulo puro v2, identidade/proveniência, calendário, digest/comparação, leitor v1/v2 e projeção de persistência; desenho/manifesto candidato | 69 testes S1 PASS; legado preservado; desenho/gates preparados sem aplicação SQL. Suite backend mantém uma falha P3 preexistente, registada separadamente |
| S2 — implementado, Review | Adaptador EU sobre registo completo, lookup antes da criação P3, arquivo candidato v2 e compatibilidade v1/P2; Horizon/Erasmus como seleções | 218 testes focados PASS; backend1919 PASS/0 FAIL/7 SKIP; frontend461 PASS/build PASS. Equivalência normativa11145, 120000/moeda ausente, SUSA/acordo/sete prazos; retoma/fences/replay verificados. SQL preparado, sem ativação ou revisão v2 publicada |
| S3 — implementado, Review | Adaptador XLSX lexical e composição central C4G com preview/digest/porta documental obrigatória; arquivo/revisões candidatas e SQL fora do manifesto; spike API documentado | 177/177 registos,2301/2301 células e5 snapshots completos iguais aS0;34 testes S3 PASS, backend1953 PASS/0 FAIL/7 SKIP, frontend461 PASS/build PASS. Zero escrita tenant/publicação; F11/worker central e gatesSQL antes da ativação; API pendente de semântica comprovada |
| S4 — implementado, Review | Interreg Europe/POCTEP: 13 snapshots, dotações/prazos, cobertura e conflito documental explícitos; autoria manual v2 e arquivo candidato | 38 testes novos/207 focados PASS; backend1991 PASS/7 SKIP, frontend473 PASS/build PASS; sem migração/ativação, cobertura restrita ao corpus |
| S5 — implementado, Review | DTO aditivo comum, lista/detalhe/filtros/CSV da página/dashboard/matching e snapshots históricos de candidaturas/interesses | 37 testes backend e15 frontend novos; backend2028 PASS/0 FAIL/7 SKIP, frontend488 PASS/build PASS; browser1440/390 PASS. 177 planos e11145 preservados, limites sem truncagem; SQL real/ativação em S6 |
| S6 — ensaio isolado implementado, Review | Reconciliação determinística, writer/SQL candidatos central/tenant, persistência/paridade SQL e consumidores reais sobre fixtures; fingerprints não registados | 33 checks PostgreSQL18.6 PASS,78 casos temporais;191/192 candidatos aceites, POCTEP10 bloqueada; histórico/UUIDs/vínculos preservados; backend2048 PASS/7 SKIP,frontend488 PASS/build PASS. Ativação habitual continua pendente |

Dependências: S0 → S1 → S2; S3 e S4 podem avançar após S1. O estudo público da API PT2030 pode decorrer durante S0. S5 começa com o contrato e termina antes de S6. Não reiniciar P0/P1/P2 concluídos; integrar com cobertura/refresh/resolução já existentes. A descoberta de fontes adicionais requer incremento explícito.

### Componentes afetados

- Domínio: `opportunities/contracts.js`, `normalization.js`, `sourceEnrichment.js`, `temporal.js`, `quality.js`, `deduplication.js` e `opportunityCriteria/`.
- Adaptadores: `fundingTenders/source.js`, `enrichment.js`, `sourceEvidence.js`, `officialSources.js`, `programmes.js`; `opportunityImports/portugal2030Xlsx.js`.
- Reconciliação/persistência: `fundingTenders/refresh.js`, `merge.js`, `repository.js`, `opportunities/repositorySupport.js`; composição central nova da importação, sem redirecionar o workflow tenant.
- Migrations centrais aditivas, manifestos e permissões de leitor/worker, quando o desenho S1 as exigir. Não atribuir um número de migração até verificar a sequência então atual.
- HTTP/UI: `fundingTenders/http.js`, `catalogReader.js`, `frontend/src/api/api.js`, catálogo, detalhe, importação, exportação e resumos/dashboard. Criar DTOs compartilhados, sem parsers específicos da fonte no React.
- Dados privados: somente consumo das revisões centrais autorizadas e preservação de referências. Não promover automaticamente importações privadas antigas.

## Validação e critérios de aceitação

1. **Exatidão:** cada campo mapeado corresponde ao valor oficial observado após transformação explícita e reversível na sua semântica. Quando a fonte não publica um campo, não o inventar. Exatidão 100% do corpus validado não equivale a cobertura universal nem a score de qualidade 100.
2. **EU 11145:** título da chamada, DIGITAL/referência, fonte, identidade CASCADE:11145, orçamento 120000 como CALL, moeda com evidência, acrónimo/acordo e sete cut-offs. Próximo e último prazo distintos, limite individual separado. Valores iguais em parser, revisão, detalhe, lista e exportação.
3. **Excel:** 177 linhas com resultado individual e reconciliação de contagens; 13 colunas mapeadas/preservadas; IDs 8614/8514 multiprograma sem duplicar orçamento; ID8664 preserva zero; ID8485 continua previsto sem prova de publicação. Moeda e código definitivo não inventados.
4. **Datas:** sistemas Excel 1900/1904, datas inválidas, data civil, timezone/DST, precisão parcial, vários cut-offs e instantes antes/depois do limite. POCTEP com hora oficial estruturada quando publicada.
5. **Atualizações:** reimportação idêntica não duplica; mesma identidade com data/dotação alterada cria revisão; contradição e desaparecimento não causam overwrite/delete; mudança de mapping exige novo preview e digest; não executar fórmulas/links do ficheiro.
6. **Segurança/isolamento:** importação/recolha central exclusiva C4G, autoridade revalidada no worker, F11/antivírus no upload, idempotência/fences; perfis de entidade recusados para escrita central; interesses e candidaturas de cada organização permanecem isolados.
7. **Compatibilidade:** leitores v1/v2, snapshots históricos, correções e resoluções preservados; qualidade nova versionada. Conservar estados v1 já observados, incluindo NOT_FOUND/CONFLICT/UNSUPPORTED; usar NOT_COLLECTED apenas para factos sem observação, sem completar por inferência.
8. **Operação:** contagens por origem e por estado de campo, último ciclo completo, idade da observação, erros de contrato, valores em conflito e incompletude mensuráveis. Divergência 177 Excel/172 página consultada exige comparação por identidade/edição antes de qualquer ação sobre registos.

Regressões antes das correções, testes focados, suites completas backend/frontend, `node --check` nos JS alterados e build frontend. Separar falhas preexistentes de resultados novos; a falha P3 registada em S1 foi corrigida em S2. Gates PostgreSQL/HTTP/worker/migrations em infraestrutura isolada com âmbito autorizado; ativação habitual e produção têm validação própria. S1/S2 têm provas locais documentadas; os gates de infraestrutura não foram executados nestes incrementos.

## Migração e apresentação propostas

Adicionar o contrato e projeções compatíveis, emitir v2 nas novas revisões após ativação e manter leitura v1. Reprocessamento é uma operação explícita, com diff, contagens e preservação de vínculos; não converter todo o histórico in place. Se uma ativação falhar, suspender a nova ingestão mantendo leitores compatíveis e os factos já persistidos; não apagar revisões para fazer rollback.

Detalhe com estrutura comum: identificação, programa/fundo/entidades, calendário, financiamento, condições/territórios/beneficiários, projeto associado e proveniência. Mostrar ausência com motivo adequado. Lista usa a mesma projeção reduzida; financiamentos plurais remetem para detalhe sem escolher o primeiro. Previstas têm filtro/identificação próprios e não integram contagem de abertas. Os nomes técnicos e hashes ficam na administração/diagnóstico, não no percurso normal do utilizador.

## Decisões fechadas em S0

- Nomes, tipos, cardinalidades, estados de ausência, limites e política decimal fechados no contrato/schema. Aprovação do contrato não executa DDL nem migrações.
- Precedência por campo/versão/autoridade; plano→aviso apenas com identidade comprovada ou decisão editorial. Correspondência incerta fica em revisão.
- Moeda ausente no total da API11145 e na coluna do XLSX permanece NOT_FOUND/null; não é herdada do apoio mensal. Zero literal permanece ZERO_UNEXPLAINED. Taxonomias PT/NUTS conservam rótulos com UNMAPPED/versão null; a falta de prova não é preenchida por inferência.
- Factos e observações preservados, relógio separado do digest e limites sem truncatura factual. Aplicar retenção/segurança vigentes, sem novas durações de retenção.

## Resultado S0 — histórico

S0 concluído com seis exemplos completos validados, incluindo dotação total 120000, apoio mensal 1500/EUR separado, projeto/acordo e sete cut-offs europeus; PT2030 cobre previsão, dois casos multiprograma, decimal fracionário e zero. As 177 linhas/2301 células foram reconciliadas com o original e os digests cobrem todas as colunas. A validação offline do pacote não certifica o parser, a persistência ou o endpoint atuais da APP.

Excel original preservado por hash; sem código funcional, testes da APP, importações, migrações, alterações de serviços, commit ou deploy. A consulta pública PT2030 serve de evidência contextual, não de aprovação do endpoint futuro. Revisão independente do schema, exemplos e regras concluída sem bloqueadores; ramo temporal OPEN explicitado antes do fecho.

## Resultado S1

Implementados `backend/src/opportunities/v2/` e seis suites dedicadas: schema runtime idêntico ao S0, limites JSON/JSONB, invariantes semânticas, normalização explícita de decimais/datas/Excel/textos, leitura v1/v2 conservadora, projeção temporal, digest/comparação e projeção de persistência por revisão. Dependências Ajv/formatos fixadas. Revisão cruzada corrigiu multiplicidade de dotações, perda de moeda com key alterada, hosts locais com ponto final e restrições excessivas perante S0.

69 testes focados PASS; backend1863 PASS/1 FAIL preexistente em P3/7 SKIP; frontend461 PASS/build PASS; sintaxe/whitespace PASS. A [prova S1](../reviews/opportunity-data-standardization/s1.md) descreve comandos, APIs e limitações. A comparação não faz merge automático e o leitor não fabrica snapshots v2 para dados v1 incompletos.

[Desenho de persistência](../references/opportunity-v2/s1-persistence-design.md) e manifesto não executável preparados. Observações/candidatos podem anteceder a criação de identidade no catálogo; precisão NUMERIC32,8, vínculos de revisão, permissões, CAS e gates descritos. Sem SQL/serviços/bases/importações/HTTP ativo alterados nessa entrega. S2/S3 foram implementados posteriormente, conforme resultados abaixo.

## Resultado S2

Adaptador EU sobre evidência integral, equivalência normativa11145, descoberta P3 antes da criação e arquivo candidato separado. Preserva120000/moeda ausente, SUSA/acordo e sete prazos; retoma, replay, revisão P2 e necessidade de arquivo verificados. [Provas S2](../reviews/opportunity-data-standardization/s2.md), sem migração/ativação ou publicação v2.

## Resultado S3

Adaptador lexical XML/XLSX, três módulos puros e fixture byte a byte; composição central com autoridade C4G/documento verificado e archive concreto.177 linhas/13 colunas preservadas, cinco snapshots completos idênticos, preview/digests e revisões candidatas sem escrita tenant. A [prova S3](../reviews/opportunity-data-standardization/s3.md) documenta34 testes novos,112 focados, suites/build e revisão; o [desenho central](../references/opportunity-v2/s3-central-import-design.md) fixa portas, limites, SQL aditivo e gates.

O [spike API](../research/pt2030-api-contract-s3.md) não demonstrou ainda timezone, moeda/cobertura e equivalência de IDs. Não há adaptador API presumido nem ligação automática plano→aviso. O F11/worker atual é tenant; upload/antivírus/jobs centrais requerem implementação/gates próprios antes da ativação. No fecho S3, catálogo e HTTP/UI permaneciam v1; S5 acrescentou leitores locais compatíveis sem ativar publicação v2.

## Resultado S4

Adaptadores Interreg Europe/POCTEP sobre bytes oficiais preservados: três chamadas gerais e dez convocatórias, dotações decimais exatas, EUR comprovado, qualificador INITIAL e conversão Madrid/UTC apenas para horas publicadas. Autoria manual com DTO de factos fechado, identidade/proveniência editorial no servidor, autoridade C4G atual, idempotência e auditoria transacional. Pipeline oficial arquiva/rederiva candidatos antes da aplicação v1 e exige arquivo após retoma; seleção, contagens e elegíveis conhecidos também são revalidados nos resultados vazios.

[Relatório e provas S4](../reviews/opportunity-data-standardization/s4.md): 38 testes novos, 207 focados PASS; backend1991 PASS/0 FAIL/7 SKIP; frontend473 PASS/build PASS; sintaxe12 PASS. Revisão cruzada e regressões de integridade concluídas; pacote S0 e Excel original intactos. SQL candidato fora do manifesto, sem migração/recolha APP/publicação/ativação. HTTP/formulário v1 preservados; gates PostgreSQL reais continuam pendentes.

A [pesquisa oficial](../research/interreg-contract-s4.md) comprovou divergência horária entre bases PT/ES da 10.ª POCTEP. O recorte HTML conserva a afirmação observada e marca revisão documental; não certifica concordância integral nem recolha de PDFs. Interreg conserva DATE onde o XLSX não publica horas. Financiador, elegibilidade, taxas e outros campos fora do recorte mantêm ausência explícita.

## Resultado S5

Implementado o [contrato aditivo de leitura](../references/opportunity-v2/s5-read-model.md): `opportunity-read-v2.0` sobre revisões aceites/históricas, sem leitura alternativa de candidatos. Lista/detalhe, filtros plurais, estados, calendário, qualidade, frescura e CSV da página usam factos comuns. Dashboard separa PLANNED; matching mantém projeção compacta, resumo/condições e autoridade; candidaturas/interesses preservam snapshots originais e referências. Limites de payload são explícitos e o limite atual de32KiB para snapshots de candidaturas recusa excesso antes de SQL.

[Relatório S5](../reviews/opportunity-data-standardization/s5.md): 37 testes backend e15 frontend novos, foco final67 PASS e revisão independente70 PASS; backend2028 PASS/0 FAIL/7 SKIP, frontend488 PASS/build PASS, sintaxe30 PASS e browser12 combinações1440/390+CSV/contraste PASS. 11145 conserva120000/moeda desconhecida, SUSA/acordo/sete prazos;177 linhas do Excel conservam factos e PLANNED. Correções de matching/compatibilidade/limites foram revalidadas; nenhum bloqueante conhecido no código revisto. Pacote S0/Excel intactos. Sem PostgreSQL real, migrações, publicação/recolha APP ou reinício habitual; paridade SQL/DTO e ativação continuam pendentes.

## Resultado S6 — ensaio anterior à ativação

Implementado preview com bindings exatos de candidato/revisão/mapping/metadados protegidos e decisão explícita. Writer opt-in e SQL candidatos preservam revisões v1, criam projeções vinculadas à revisão, impõem CAS/replay/rollback e bloqueiam perda/conflito/correções. Frescura v2 usa somente observação aceite, incluindo UNCHANGED. Tenant mantém32KiB para v1 e permite256KiB v2 após capacidade instalada; snapshot de54877 bytes foi preservado integralmente no ensaio.

[Relatório S6](../reviews/opportunity-data-standardization/s6.md): gate PostgreSQL18.6 com33 checks PASS e cleanup confirmado,78 casos SQL/JS,191 candidatos persistidos de192,177 planos conciliados e11145 com120000/moeda ausente/sete cut-offs em SQL/HTTP. Corrigidos DST, constraintsNULL e frescura; revisão independente sem bloqueantes conhecidos. Backend2048 PASS/0 FAIL/7 SKIP,frontend488 PASS/build PASS,foco45 PASS,sintaxe16 PASS; S0/Excel intactos. [Descritor candidato](../references/opportunity-v2/s6-persistence-candidate.json) com fingerprints medidos, ordinalnull e executablefalse; nenhum manifesto ativo modificado.

A prova usa dados públicos/sintéticos e portas explícitas de autoridade/aprovação/auditoria central; não certifica OIDC/membership de produção nem reconcilia a base habitual. Resoluções históricas têm regressão de domínio/preview, sem linhas funding_resolution semeadas na prova SQL. A ativação requer composição operacional com arquivo verificado, migração/preflight/backups próprios e coordenação dos escritores por fonte. POCTEP10 e portas documentais centrais PT2030 mantêm as pendências descritas.

## Incremento após S6 — preparação da ativação por fonte

Pedido confirmado em31/10/2026. [Contrato e critérios](../references/opportunity-v2/activation-preparation-contract.md): composição operacional opt-in de autoridade/aprovação/auditoria, preview real READ ONLY e plano de migração/recuperação, com ensaio isolado. Esta autorização não ativa fontes nem permite aplicar SQL nas bases habituais.

Implementados planos por candidato com arquivo rederivado, TTL1h, revisão/mapping/digests e fence; aceitação humana pelo administrador que aprovou, sessão persistida e autenticação recente com MFA opcional. Auditoria platform transacional; replay vincula plano/fence/autor. SERVICE e PT2030 documental continuam recusados. Sem startup/rotas/writers ativos ou manifestos alterados.

Preview real:538 oportunidades v1;191 exemplos públicos resultam em188NEW,2 migrações sujeitas a aprovação (11145/POCTEP9) e1bloqueio (POCTEP10). Arquivos v2 ainda ausentes.11145 tem sete prazos, mas a revisão aceite real ainda não contém a dotação120000 nem SUSA/acordo. Excel177linhas permanece normativo; o exemplo manual sintético foi excluído da comparação real.

[Relatório, prontidão por fonte e recuperação](../reviews/opportunity-data-standardization/activation-preparation.md): gate14 PASS,25eventos íntegros,342hashes estáveis e cleanup confirmado. Backend2073 PASS/0 FAIL/7 SKIP,frontend488 PASS/build PASS,foco29 PASS,sintaxe14 PASS. funding_resolution real bloqueia substituição; allowlists SQL de auditoria corrigidas e preservadas. [Pacote candidato](../references/opportunity-v2/activation-preparation-candidate.json) com ordem/checksums/fingerprints, sem registo ou ativação. Estado Review; próximos gates são HTTP/OIDC/worker e janela com backup/restauro próprio. Próximo passo: integrar aprovação autenticada e suspensão dos escritores EU antes da janela da11145.

## Incremento — aprovação autenticada e suspensão EU

Pedido confirmado em 31/10/2026; [contrato](../references/opportunity-v2/authenticated-approval-eu-contract.md) documentado antes da implementação. Estado Review. Integrados endpoints administrativos de preparação/consulta/aprovação/revogação e controlo durável EU/CORDIS/Erasmus, com ator/sessão do servidor, CSRF/origem, autoridade atual e auditoria transacional. Cliente API comum; nenhum endpoint HTTP de aceitação. Runtime opt-in, indisponível sem SQL e admissão normais.

Barreira SQL e fence da fonte protegem escritores em curso/legados. Suspensão distingue pedido de quiescência; retoma conserva outbox/envelope/tentativa/prazo e exige condições atuais. Interreg/POCTEP continuam a executar durante a pausa, preservando o único escritor ativo. Aceitação EU exige sourceFence quiescente além da aprovação; qualquer EU v2 aceite impede retoma v1. Corridas de locks, projeção aninhada, handler obsoleto e expiração após retoma corrigidas e ensaiadas.

[Relatório e recuperação](../reviews/opportunity-data-standardization/authenticated-approval-eu.md): PostgreSQL/PgBoss com 16 checks PASS, 33 eventos íntegros, 386 hashes estáveis e cleanup; preview/aceitação isolada da 11145 com 120000 e sete cut-offs. Backend 2108 PASS/0 FAIL/7 SKIP, frontend 491 PASS/build PASS, sintaxe de 21 ficheiros PASS. Revisão independente sem bloqueantes conhecidos; S0/Excel e 121 ficheiros ativos preservados. [Pacote de sete SQL](../references/opportunity-v2/authenticated-approval-eu-candidate.json) medido, não registado/aprovado/ativado. Sessões persistidas de fixture não certificam login OIDC. Não houve acesso, suspensão, migração, recolha ou reinício habitual. Próximo passo: registar e rever o pacote final para preparar a janela autorizada da 11145, com preview atualizado e backup/restauro próprios.
