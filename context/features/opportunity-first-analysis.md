# Oportunidades — informação para primeira análise

Estado: **Complete** (01/11/2026), após implementação, revisão independente e validação local. Pedido confirmado em 01/11/2026: simplificar a lista e a ficha das oportunidades de todas as fontes. A dotação pretendida é a **dotação da call/aviso**, conforme resposta explícita do utilizador.

## Contrato

- Mostrar nome/título e código da oportunidade, datas de abertura e fecho, dotação da call/aviso, descrição da call e programa financiador. Nome/código identificam a oportunidade; programa financiador identifica o programa publicado, sem o confundir com publicador, projeto associado ou concedente direto.
- Disponibilizar a ligação direta oficial para requisitos e informação complementar. Manter ações existentes de interesse/candidatura e navegação; não apresentar contadores técnicos como conteúdo da oportunidade.
- Retirar da apresentação de primeira análise classificação, condições, projeto associado, listas secundárias de ligações, qualidade/completude e repetição de campos ausentes. Não eliminar dados, evidências, exportação histórica ou controlos internos.
- Usar o mesmo formato para fontes EU, PT2030, Interreg e registos manuais/históricos. Valores ausentes dos cinco grupos essenciais têm indicação breve, sem listas de «Não recolhido».
- Não converter apoio por candidatura, percentagens, custos ou orçamento global do programa em dotação da call. Preservar moeda desconhecida, zero, precisão decimal, âmbito partilhado, dotações múltiplas e caráter previsto quando aplicável; não somar valores.
- Preservar a distinção entre prazos confirmados, previstos, várias rondas e prazos ambíguos. Mostrar o próximo prazo aplicável ou o último publicado sem inventar hora. Conflitos relevantes para valores mostrados e avisos de fonte desatualizada continuam visíveis de forma concisa.
- Texto externo é inerte; ligações externas continuam validadas. Proveniência útil pode acompanhar a ligação oficial, sem painel de diagnóstico.

## Plano

1. Comparar a integração EU com a documentação oficial e guardar conclusões com evidência em `context/research/eu-funding-api-compliance-2026-11-01.md`.
2. Adicionar regressões da apresentação solicitada e comprovar a falha no estado anterior.
3. Simplificar tabela e ficha partilhadas, com mapeamento de apresentação comum e compatibilidade v1/v2.
4. Executar testes focados, suites frontend/backend e build; rever alteração e registar limitações.

## Critérios de aceitação

1. Lista e ficha apresentam os cinco grupos úteis e ligação oficial; blocos redundantes do exemplo 11145 desaparecem.
2. EU 11145 mantém dotação `120000` sem inventar EUR nem trocar pelos `1500` por pessoa/mês. Projeto SUSA e métricas de qualidade não aparecem na primeira análise.
3. Planos PT2030 mantêm datas/dotações previstas e todos os programas publicados; zero, moedas desconhecidas e dotações múltiplas conservam o significado.
4. Registos sem dotação ou descrição não mostram valores derivados de suposições. Ligações inseguras e HTML executável continuam impedidos.
5. Interesse/candidatura, isolamento, recolha e dados persistidos mantêm o comportamento autorizado; não aplicar SQL nem reativar a fonte EU nesta alteração.
6. Pesquisa distingue conformidade técnica observada, condições de reutilização e limitações que não foi possível verificar. Não declarar conformidade integral sem evidência.

## Validação

- Regressões iniciais RED→GREEN: colunas essenciais, remoção dos blocos técnicos, orçamento separado do apoio por pessoa/projeto e valores ausentes.
- Revisão independente encontrou e corrigiu três incompatibilidades: dotações v1 com estrutura plana; substituição indevida do próximo prazo canónico por outra ronda no mesmo dia; desaparecimento do aviso de conflito com correções manuais. As duas primeiras usam o `createOpportunityReadModel` real do backend nos testes. Revalidação: sem achados pendentes.
- Testes de enriquecimento histórico continuam a verificar os dados/evidência/segurança do componente existente, separadamente da primeira análise. Testes de apresentação foram atualizados para o contrato solicitado; exportação e contratos de domínio não mudaram.
- Detalhe de interesse: regressão RED→GREEN de ligação oficial duplicada; dotação exata e sete prazos continuam cobertos.
- Frontend: **554 PASS / 0 FAIL**, 72 ficheiros (`npm test`). Backend: **2403 PASS / 0 FAIL / 7 SKIP** (`npm test`); 54 testes focados do conector também PASS. Build final PASS; sintaxe do helper e `git diff --check` dos ficheiros alterados PASS.
- Browser com componentes reais e fixtures públicas/sintéticas: oito capturas a 1440 e 390 px, lista com/sem ações, ficha EU e plano PT2030. Sem erros JS, overflow da página ou células cortadas. Corrigidos cortes de texto/botões e alinhamento de campos em telemóvel. Evidência local: `output/playwright/opportunity-first-analysis/`; não houve login nem acesso à API/BD habitual.
- A primeira execução isolada de testes Node falhou por restrição de subprocessos (`EPERM`); a execução local autorizada passou. A primeira suite frontend revelou uma expectativa antiga de `InterestFlow`, reconciliada mantendo todos os valores e acrescentando a verificação de ligação única. Não ficaram falhas de teste por resolver.

## Resultado e limite conhecido

`opportunityFirstAnalysis.js` centraliza a apresentação v1/v2; tabela, ficha e detalhe de interesse usam os mesmos conceitos. Os dados e evidências persistidos, fontes, permissões, candidaturas e interesses foram preservados. Incluída atribuição EU com indicação das adaptações C4G e ligação às condições oficiais de reutilização.

A descrição EU v2 pode continuar ausente ou repetir o título no dado persistido: o adaptador atual projeta `raw.summary`, embora a fonte possa publicar narrativa útil em `metadata.description`. A UI não inventa esse texto e encaminha para a fonte. Corrigir o mapeamento e tratar revisões aceites é um incremento separado, documentado na [auditoria](../research/eu-funding-api-compliance-2026-11-01.md); nenhuma recolha, SQL ou retoma EU foi realizada aqui.

Next step: corrigir a descrição canónica EU num incremento versionado e preparar a atualização controlada das revisões afetadas.
