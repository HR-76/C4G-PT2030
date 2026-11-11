# Anexos reais — ligação ao transporte F11

Estado: In Progress, 2026-10-17. Execução autorizada da entrega 3, E3-07/08. Este incremento não fecha a entrega nem demonstra anexos operacionais.

## Evidência e dependências

O ambiente habitual não contém configuração R2/scanner nas variáveis do processo, em `backend/.env` ou na configuração privada de arranque local. A inspeção usa apenas nomes e presença, nunca valores. O adaptador R2 existente lança `R2_SDK_ADAPTER_NOT_IMPLEMENTED`; o bootstrap devolve portas nulas e zero handlers. O arranque nativo não injeta transporte documental. Os documentos disponíveis nos testes anteriores são doubles.

Esta era a baseline. O utilizador confirmou nesta execução: **«Ainda não estão configurados»**. O adaptador R2 foi entretanto implementado e testado com comandos SDK simulados; o bootstrap continua fechado por ausência da composição completa.

## Implementação do transporte

- Adaptador S3/R2 exclusivamente no servidor, endpoint de jurisdição UE e dois buckets privados distintos. Credenciais explícitas, sem fallback para a cadeia de credenciais AWS da máquina.
- Instância vinculada à organização resolvida pelo servidor; chaves opacas sob prefixo organizacional. Nenhum caminho/nome fornecido pelo utilizador entra na chave.
- Upload condicional, SHA-256 e tamanho verificados antes de confirmar, multipart limitado, operações abortáveis e leitura por intervalos limitados. Abort não elimina objetos confirmados. Erros externos nunca expõem endpoint, token, conteúdo ou nome.
- Adaptador opcional ClamAV por INSTREAM sobre ligação local (o protocolo não autentica nem cifra). A criação do adaptador não instala nem inicia serviços. Cada scan verifica tamanho e SHA-256 do objeto lido, exige resposta terminal válida e falha fechado em erro, timeout, limite, truncamento ou resultado desconhecido. OOXML mantém a exigência adicional de inspeção estrutural existente em F11.
- A inspeção OOXML aceita apenas DOCX/XLSX/PPTX cuja extensão, MIME, content types, parte principal e relações internas coincidam. Limita o arquivo a 4 096 entradas, 100 MiB por entrada, 16 MiB por parte XML, 32 segmentos de path, 30 segundos de processamento e expansão total ao menor valor entre 4× o tamanho comprimido e 200 MiB. Não extrai para o filesystem; rejeita arquivos cifrados/corrompidos, paths ambíguos, DTD, entidades personalizadas, macros, ActiveX, executáveis, OLE/pacotes incorporados e qualquer relação externa — incluindo hiperligações. Imagens internas normais continuam permitidas. `CLEAN` do ClamAV e aprovação estrutural vinculada ao mesmo tamanho/SHA-256 são ambos necessários para `AVAILABLE`.
- O bootstrap não pode declarar `ready` com portas nulas ou handlers vazios, mesmo recebendo flags de configuração válidas. Saúde de transporte não equivale a validação integral da Camada C.

## Gate de ativação e trabalho restante

Antes da ativação: configurar R2 UE privado e scanner real; provar operações condicionais concorrentes (incluindo complete multipart), hash, limites, indisponibilidade e quarentena; integrar intent/content/status/download na candidatura com autoridade atual e binding APPLICATION; garantir confirmação/F7/outbox/F9/fencing/reconciliação; validar em conjunto ClamAV e a inspeção OOXML estrutural contra objetos reais; recuperar seleção de ficheiro, estados, metadados e ações originais. Sem atalhos por filesystem UBI, doubles ou marcação manual CLEAN.

A validação final exige duas organizações, grants assimétricos/revogação, versão exata, revisão obsoleta, remoção apenas do vínculo, bytes reais iguais após download e comparação visual com o piloto. A instalação habitual mantém-se fechada até cumprir estas condições. Não basta disponibilizar credenciais para declarar o percurso concluído.

## Preparar a configuração privada

1. Na conta Cloudflare, disponibilizar dois buckets R2 distintos com **jurisdição UE**, acesso público desativado (incluindo r2.dev e domínios públicos) e credenciais S3 limitadas aos buckets necessários. A indicação de localização preferida não substitui a jurisdição UE.
2. Copiar `backend/.env.documents.example` para `.tmp/local-platform/documents.env`, já abrangido pelo ignore do repositório, e preencher os valores apenas nesse ficheiro privado. Não enviar credenciais na conversa nem guardá-las em documentação/output/Git.
3. Disponibilizar ClamAV atualizado com ClamD acessível apenas por loopback, com limites compatíveis com as classes documentais. O adaptador não instala nem arranca o serviço. Um serviço remoto exige transporte autenticado/cifrado antes de o expor ao adaptador.
4. A partir da raiz, executar `node --env-file=.tmp/local-platform/documents.env backend/scripts/documentInfrastructureStatus.js`. O comando só confirma presença/formato; não faz ligações de rede, uploads ou alterações de dados e não certifica privacidade ou saúde.
5. Completar composição/worker/HTTP/interface e executar os gates reais descritos acima. Não definir flags de validação por existir configuração, nem ligar o adaptador diretamente a uma rota que ignore a autoridade da candidatura.

Os SDKs `@aws-sdk/client-s3` e `@aws-sdk/s3-request-presigner` ficaram fixados em `3.1152.0` com lockfile. As versões F11 permanecem a fonte da identidade documental; não se depende de versionamento do bucket.

## Fontes técnicas

- [Cloudflare — S3 API e operações condicionais](https://developers.cloudflare.com/r2/api/s3/api/).
- [Cloudflare — SDK JavaScript v3](https://developers.cloudflare.com/r2/examples/aws/aws-sdk-js-v3/).
- [ClamAV — protocolo ClamD / INSTREAM](https://docs.clamav.net/manual/Usage/ClamdProtocol.html).

A documentação R2 explicita a atomicidade de PutObject condicional; não se assume equivalência para complete multipart sem prova no serviço real.
