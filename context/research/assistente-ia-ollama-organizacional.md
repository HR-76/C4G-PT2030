# Avaliação: assistente de IA contextual com Ollama

Data: 11/11/2026. Investigação; não constitui decisão de arquitetura nem autorização de implementação.

## Decisão e contexto

Avaliar um assistente opcional para administradores e técnicos de entidades, fundamentado em informação autorizada da organização. O produto mantém bases operacionais separadas, contexto organizacional resolvido no servidor e autorização por recurso. Técnicos só consultam candidaturas das equipas em que participam. O catálogo central é comum. O MVP funciona sem IA e mantém matching determinístico e explicável; a IA está fora do âmbito ativo de recuperação. A feature de matching admite um futuro adaptador opcional, desligado por defeito e sujeito a melhoria mensurável.

## Avaliação e recomendação

Potencial elevado de utilidade e diferenciação contextual; novidade tecnológica moderada, pois assistentes sobre documentos são uma abordagem estabelecida. A inovação real dependerá de respostas verificáveis e adaptadas ao processo de financiamento, das permissões e da integração com dados atualizados. Não há evidência nesta análise de vantagem competitiva validada nem de ganhos medidos.

Recomenda-se explorar após as prioridades de recuperação através de uma prova limitada, opcional e de leitura: explicar uma oportunidade e relacionar os seus requisitos com dados autorizados e preferências confirmadas, apresentando fontes, data e lacunas; eventualmente gerar rascunho sujeito a revisão. Não determinar elegibilidade nem alterar o matching, submeter candidaturas ou executar ações. O catálogo central autorizado pode complementar dados privados: contexto apenas da organização não significa excluir informação comum da aplicação.

Ollama é um servidor de execução de modelos, não um modelo nem um mecanismo de isolamento. A execução local ou privada pode limitar dependência de serviços externos, mas localização do servidor, modelo, rede e fornecedores determinam o percurso real dos dados. [Ollama FAQ](https://docs.ollama.com/faq). Selecionar modelo e licença após testes de português europeu, qualidade e hardware, sem presumir que um modelo específico é adequado.

## Opções e arquitetura

| Opção | Benefício | Limitação |
|---|---|---|
| Ollama em infraestrutura privada partilhada | Menor custo potencial e operação comum | Isolamento de contexto, recursos, filas e retenção deve ser imposto pela aplicação; inferência partilhada não equivale a isolamento físico |
| Ollama dedicado por organização | Isolamento operacional mais forte e configuração específica | Maior custo e gestão; ainda exige autorização por utilizador |
| API externa europeia ou contratualmente adequada | Menos infraestrutura própria, alternativa para comparação | Dependência, custo por utilização e avaliação de transferência e contratos |

A API autenticada resolve organização e permissões no servidor, obtém apenas dados autorizados através de operações existentes ou novas operações controladas, e envia contexto mínimo ao serviço privado de inferência. Fontes podem combinar catálogo comum, perfil e prioridades confirmados, e candidaturas acessíveis; ausência de dados deve ser explícita. Não conceder SQL livre, acesso direto a bases ou ao armazenamento. Se necessário, recuperação de excertos (RAG) pode ser adicionada depois: índices, embeddings, caches e históricos precisam de separação por tenant e filtragem por utilizador, com atualização e remoção coordenadas. A API de embeddings existe, mas a necessidade e a qualidade devem ser testadas; truncagem automática exige controlo explícito. [Ollama embeddings](https://docs.ollama.com/api/embed).

As preferências são dados configurados ou explicitamente confirmados, com proveniência, âmbito e atualização; não inferir automaticamente factos pessoais nem treinar o modelo com dados dos clientes. Um modelo geral pode usar conhecimento prévio, pelo que respostas estritamente fundamentadas exigem instruções, verificação de fontes e avaliação, sem garantia absoluta. Tratar documentos e respostas como dados não confiáveis, proteger contra instruções maliciosas e validar citações. Revalidar acesso aquando de consulta e apresentação, incluindo após revogação; evitar que histórico e cache revelem dados entretanto retirados.

## Riscos e validação

- Alucinações, interpretação de avisos e documentação desatualizada: identificar fontes e versões, declarar incerteza, exigir validação humana e medir afirmações sem suporte.
- Isolamento: testar duas organizações e técnicos de equipas distintas, incluindo alteração e revogação de acesso, histórico, índices e caches; ausência de evidência não prova segurança.
- Privacidade: definir finalidade, base legal, contratos, residência, conservação e eliminação, incluindo backups e embeddings, e avaliar necessidade de DPIA com responsáveis. Aplicam-se os princípios do [RGPD, artigo 5](https://eur-lex.europa.eu/eli/reg/2016/679/oj); enquadramento jurídico depende do caso concreto.
- Capacidade: medir latência, concorrência, memória, consumo, disponibilidade e custo total numa infraestrutura representativa. Limites, filas e falhas por tenant, sem interromper a APP. Não há dimensionamento ou preço validado.
- Avaliação: preparar conjunto de perguntas reais e anonimizadas, com respostas de referência; medir correção, fundamentação, fugas, português europeu, tempo e satisfação, comparando com o processo sem IA e pelo menos uma alternativa. Definir metas com o produto antes do piloto; validar licenças e segurança das versões.

## Próximo passo

Quando as prioridades atuais o permitirem, decidir se deve ser especificada uma prova de conceito de leitura para explicar oportunidades com fontes e permissões existentes.
