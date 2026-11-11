# Importação central — carregamento verificado e pré-visualização

Estado: In Progress. Pedido autorizado em 02/11/2026.

## Contrato

Super Admin C4G, sem entidade selecionada, carrega XLSX até 10 MiB. O original fica em armazenamento central protegido, sujeito a verificação de integridade, antivírus e inspeção estrutural existente. Só depois se apresenta escolha explícita de folha e pré-visualização pelo parser PT2030 V2. Preservar links oficiais. Não criar oportunidades, não fazer staging/publicação, não tocar em bases de clientes.

Reutilizar R2/ClamAV e parser existentes com âmbito central explícito; não simular uma organização cliente. Registo central vincula ficheiro, utilizador, pedido, digest e resultado de verificação. Repetição do mesmo pedido/ficheiro é segura; conteúdo diferente conflita. Consultas e pré-visualização exigem autoridade atual e titular do carregamento. Nunca confiar em estado CLEAN fornecido pelo navegador.

## Aceitação

1. Recusar clientes antes de receber/processar ficheiros; aplicar sessão e CSRF existentes.
2. Tipo, tamanho, checksum, conteúdo malicioso/estrutural e configuração indisponível têm erros sanitizados. Original não verificado não chega ao parser de dados.
3. Escolha de folha sem publicação implícita; resultados mostram totais, linhas válidas/rejeitadas, dados e erros por linha. Paginar apresentação para 5.000 linhas.
4. Releitura do original antes da pré-visualização valida hash/tamanho e recibo CLEAN; arquivo da pré-visualização usa composição central existente. Sem rotas de stage/confirm/publicação.
5. Interface mantém intenção em falha incerta, permite repetição do mesmo ficheiro e ignora respostas tardias de outra sessão. Não mostrar resultado anterior após nova seleção.
6. Runtime ligado pela composição de produção apenas com configuração e esquema disponíveis. Ausência de infraestrutura mantém estado indisponível; sem fallback privado/local. Esquema candidato não aplicado automaticamente.

## Verificação

Testes backend de autorização, upload/replay/conflito, ficheiro recusado, troca de bytes, preview e ausência de publicação; frontend de carregamento/folha/erros/retry; suites e build. Gates SQL/infraestrutura reais só em âmbito isolado autorizado. Registar separadamente código integrado e ativação operacional.

## Resultado do incremento

- Serviço de carregamento e recibo CLEAN, adaptadores centrais R2/ClamAV com prefixo próprio, inspeção estrutural e descoberta das folhas pelo leitor existente. Mantém bytes originais e valida digest na releitura.
- Composição de produção opt-in `CENTRAL_PT2030_IMPORT_RUNTIME=preview`, endpoints administrativos e disponibilidade dependente do esquema/serviços. Revalidação da sessão sob lock antes de persistir recibo e preview; conta cliente não entra no upload.
- Pré-visualização arquivada pela composição PT2030 existente, sem expor `stage()`. Interface mostra totais, erros, todos os 13 campos (parte em detalhe expansível), datas previstas normalizadas para linhas válidas e paginação de 50 linhas.
- Intenção preservada em memória no retry da mesma página. Retoma automática depois de fechar/recarregar navegador não foi implementada; GET de recibo verificado disponível para evolução posterior.
- No primeiro incremento foi preparado o SQL de upload, sem instalação. A inspeção posterior confirmou que o preview já estava registado na migração 038, apesar da localização do SQL em `candidates`.

## Evidência de validação — 02/11/2026

- Regressão inicial: novo teste de upload falhou por módulo inexistente antes da implementação.
- Suite backend: 2.569 aprovados, sete ignorados, zero falhas (2.576 testes). A última alteração de classificação de erros multipart foi novamente validada nos dois testes HTTP focados.
- Suite frontend final: 637 aprovados em 80 ficheiros; 17 testes da componente de importação incluídos. Build Vite e `node --check` dos dez módulos backend alterados aprovados.
- Testes específicos cobrem ficheiro infetado, scanner indisponível, alteração de bytes, acesso por outro titular, repetição/conflito, prefixo central separado, revogação da sessão antes da escrita, proibição de publicação, parser normativo e escolha de folha/retry na interface.
- O sandbox bloqueou inicialmente a ligação HTTP local com EACCES; os dois testes passaram na execução autorizada em loopback. Não houve acesso a serviços externos nesses testes.
- Logs: `output/central-import-upload-backend.log`, `output/central-import-upload-frontend.log`, `output/central-import-upload-build.log`. Não foi feito ensaio R2/ClamAV real, gate PostgreSQL nem browser autenticado; nenhuma ativação/migração no ambiente habitual.

## Pacote de esquema — âmbito isolado autorizado em 02/11/2026

O utilizador autorizou preparar e validar o pacote central num ambiente isolado antes da ativação. Critérios: instalação explícita e atómica desde 048, preservar o preview de 038, recusar alterações de permissões, manter a leitura do Catálogo e provar persistência sem publicar oportunidades.

Implementado `central-pt2030-upload-preview-v1` / `049_pt2030_document_upload`, com checksum e fingerprints medidos, instalação repetível e sem ativação automática. Os migradores anteriores mantêm os limites. A disponibilidade exige o esquema e permissões exatos; o Catálogo admite 048 e 049 com ledger e assinatura correspondentes.

O gate Docker prova instalação, rollback atómico, repetição, permissões, upload e preview de 177 linhas com SQL real, imutabilidade, recusa de sessão revogada e leitura por credencial limitada. Remove apenas o PostgreSQL que criou. Usa sessão sintética e doubles de storage/scanner; não certifica R2/ClamAV reais ou browser autenticado. Não houve alterações em bases habituais ou de clientes.

Validação final: backend 2.572 PASS / 7 SKIP / 0 FAIL; frontend 637 PASS; build e sintaxe aprovados. Evidência do gate: `output/c4g-central-import-840057d7-e89d-42c6-bf8a-8b5f6e132060/verification.json` (PASS, cleanup true, hashes dos inputs). Logs: `output/central-import-schema-backend-final.log`, `output/central-import-schema-frontend.log`, `output/central-import-schema-build.log` e `output/central-import-schema-regressions.log`. Revisão focada concluída; a feature global continua dependente da validação operacional indicada abaixo.

**Próximo passo:** validar R2/ClamAV e ativar o percurso completo num ambiente de teste da aplicação, segundo o [runbook](../runbooks/central-import-upload-preview.md). A feature permanece In Progress até à prova operacional.

## Validação ClamAV real — 02/11/2026

Âmbito autorizado: validar fornecedores reais e percurso completo em teste. Dependência comunicada pelo utilizador: não existe ainda conta Cloudflare. Critérios independentes ensaiados com o adaptador central existente: Excel de referência CLEAN; EICAR inofensivo em memória INFECTED; hash errado ERROR; indisponibilidade do daemon ERROR e health false. Todos PASS num contentor Docker exclusivo, removido no final. Sem alterações ao código de produção.

Ensaio reproduzível: `node test/integration/central-import/clamav-gate.cjs --isolated`. Sintaxe aprovada. Evidência: `output/c4g-import-clamav-02315987-8b0b-4046-8919-2fd219f3e9ae/verification.json`. Storage permanece um double apenas neste ensaio. Não foi certificado R2 real nem ativado o percurso completo. O runbook inclui a configuração Cloudflare necessária e fontes oficiais. Próximo passo: criar/configurar R2 de teste para desbloquear a validação e ativação completas.
