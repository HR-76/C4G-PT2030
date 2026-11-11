# Candidaturas — documentos e revisão interna (fatia proposta)

## DOC-MVP-01 — download mediado aprovado em 2026-10-24

Para a rota de candidaturas, este contrato substitui o redirect 303/presigned anterior: a API autentica e autoriza candidatura, organização e versão, lê pelo adapter com `If-Match`, e prepara um ficheiro temporário privado. O tamanho e SHA-256 efetivos têm de corresponder aos valores confirmados da versão `AVAILABLE/CLEAN`. Só depois da verificação integral, auditoria crítica e nova autorização/leitura do estado pode começar a resposta `200 attachment`. ETag não é checksum. O browser navega para a rota same-origin; não recebe URL assinada nem carrega o documento num XHR/blob da aplicação. Os consumidores F11 de capabilities fora deste percurso não foram alterados.

Não há suporte Range neste percurso: pedidos Range são recusados com 416 e `Accept-Ranges: none`. Respostas usam `private, no-store`, `no-referrer`, `nosniff` e filename sanitizado com codificação UTF-8. Revogação durante a preparação impede a entrega; não se promete revogação instantânea dos bytes já enviados depois da última autorização.

Staging transitório, sem relação com anexos legacy: diretório exclusivo `c4g-verified-download-v1` no temporário do servidor, POSIX 0700/0600 ou DACL Windows limitada ao utilizador executor. Ficheiros aleatórios criados com `wx`, nunca servidos estaticamente. Limites: 100 MiB por ficheiro, quatro operações simultâneas, 400 MiB reservados, margem livre mínima de 16 MiB e prazo total de 120 segundos (preparação e entrega). Leituras condicionais usam blocos até 8 MiB, sem buffer integral em memória. Os limites de upload por classe não mudam.

Um único processo possui o diretório: outro processo vivo é recusado, não recebe um orçamento independente. Na próxima inicialização, owner comprovadamente morto permite remover apenas ficheiros regulares do namespace próprio; ficheiros desconhecidos/symlinks não são apagados. Lock inválido, PID ainda vivo/reutilizado ou interrupção da própria recuperação falham fechados e exigem inspeção operacional. Para múltiplas réplicas é necessário dimensionamento e isolamento explícitos, não reutilizar silenciosamente o diretório. Falha de limpeza não devolve capacidade como se o ficheiro tivesse desaparecido.

Sucesso, erro, timeout e desconexão libertam streams e removem o staging; morte abrupta depende da recuperação seguinte. Antes de headers, erros são públicos e uniformes; depois de headers, a ligação é interrompida sem segunda resposta JSON. Auditoria usa o evento existente `DOCUMENT_ALLOWED`, não anuncia emissão de capability inexistente.

Validação desta alteração é local, com transporte e autoridade controlados e Chrome real. Não constitui prova R2, OIDC A/B ou produção. Relatórios/journals históricos permanecem evidência das versões anteriores. A próxima prova remota necessita autorização e orçamento novos para HEAD + leituras condicionais da API; não reutilizar os tetos históricos como autorização.

**Estado:** READY_FOR_HUMAN_REVIEW — contrato e três escolhas de produto aprovados pelo utilizador em 2026-10-17; incremento implementado e validado localmente, sem fecho humano. Revisão interna não é submissão ao financiador nem altera a avaliação F14. [Evidência e pendências](../reviews/application-documents-internal-review/README.md).

## Âmbito e percurso

No detalhe de uma candidatura acessível: **associar documento → consultar versão autorizada → solicitar revisão → registar decisão → consultar histórico**. Um gestor autorizado pode iniciar upload de documento da candidatura pelo fluxo F11 ou associar uma versão F11 já existente na mesma organização. A associação guarda `organizationId`, `applicationId`, `documentId`, `versionId` exato, autor, instante e revisão; substituir ou retirar uma associação cria nova revisão histórica, sem apagar o vínculo anterior nem o objeto. Um documento pode ter novas versões, mas nenhuma substitui automaticamente a versão associada.

O upload reutiliza intent e capability F11, limites por classe, verificação de tipo/tamanho/SHA-256, quarentena, scan assíncrono e estados `PENDING → UPLOADING → UPLOADED → SCANNING → AVAILABLE`, com falhas/cancelamento/expiração/quarentena conforme F11. A interface distingue processamento, disponível e indisponível; só `AVAILABLE` com scan `CLEAN` pode ser associado a um pedido de revisão ou descarregado. A associação pode mostrar uma versão em processamento sem a tratar como apta para revisão. Scanner indisponível, resultado inseguro, objeto ausente ou autorização revogada falham fechados. A versão exata é relida e autorizada no servidor em cada operação; filename, key, URL e estado enviados pelo cliente não são autoridade.

Em caso de falha de upload multipart, a API só regista `ABORTED` quando o armazenamento confirma o cancelamento. Se a limpeza falhar ou não tiver confirmação, o registo já persistido continua elegível para reconciliação após expiração. A falha original do upload é devolvida. A regressão cobre confirmação, ausência de confirmação e falha do fornecedor.

## Operações, autoridade e estados mínimos

- **Consultar candidatura/associações/histórico:** `application.read` e guardas cumulativas já aprovadas de oportunidade e, se aplicável, avaliação F14. Metadados documentais e lista de versões exigem ainda grants F11 `document.read` / `document.version.list` sobre o recurso exato; conteúdo exige `document.download.request` e validação F11 da versão. Sem grant documental, não há URL nem conteúdo. Participação na equipa não concede qualquer grant.
- **Carregar/gerir associações:** `application.edit` mais as operações F11 correspondentes (`document.upload.initiate`, `document.upload.confirm`, `document.version.create` quando aplicável, e leitura da versão a associar). Associação de documento preexistente exige pertença à mesma organização, versão exata acessível e autorização F11; a autorização de candidatura, por si só, não basta. Gestão de quarentena permanece fora desta fatia.
- **Solicitar revisão:** `application.edit`, candidatura acessível e conjunto não vazio de versões associadas, todas `AVAILABLE`/`CLEAN` e autorizadas no momento do pedido. O pedido fixa atomicamente a lista ordenada e sem duplicados de pares `(documentId, versionId)` com digest canónico, revisão das associações, requerente e instante. Estado `REQUESTED`; não há adições silenciosas ao conjunto fixado.
- **Decidir:** grant específico proposto `application.review.decide`, sujeito a membership central ativa, autorização da candidatura e leitura F11 de todas as versões fixadas. Recomendação: requerente e decisor são pessoas distintas (stable human subject) e a decisão exige sessão válida sem MFA obrigatório, por decisão explícita de 2026-10-25; participação, responsabilidade pela candidatura e `application.edit` não concedem este grant. Uma única decisão por pedido ainda atual: `APPROVED` ou `CHANGES_REQUESTED`, com comentário/motivo obrigatório. Se as associações mudaram ou alguma versão deixou de estar disponível/limpa desde o pedido, o servidor recusa a decisão e exige novo pedido. O resultado só qualifica o conjunto exato do pedido e não altera automaticamente o estado da candidatura.
- **Após alterações:** novo vínculo/versão, retirada de vínculo ou perda de disponibilidade produz indicação derivada **nova revisão necessária** para o conjunto atual; pedido pendente torna-se obsoleto para decisão, e pedido/decisão anteriores continuam imutáveis e legíveis conforme autorização vigente. Uma versão nova nunca herda aprovação. Novo pedido cria novo conjunto fixado; não reabre nem sobrescreve decisão anterior. Revogação impede nova leitura/decisão e download, preservando referências e auditoria. Não há submissão externa, assinatura digital, múltiplos níveis, regras por etapa ou notificações.

Todas as mutações usam revisão esperada (CAS), chave/digest de idempotência, recibo de resultado e auditoria F7 na mesma transação tenant-local que grava vínculo, pedido ou decisão. Recuperação de COMMIT incerto relê o recibo após reautorizar; não declara sucesso sem prova nem duplica efeitos. A/B, IDOR, membership revogada e versão de outro tenant falham uniformemente antes de divulgar metadados. O histórico é append-only, paginado e mostra ator, instante, ação, versões fixadas e decisão; conteúdo documental não entra em F7.

## Reutilização e extensões necessárias

Reutilizar F11 (metadata/versionamento, capabilities, scan, download e grants), F3/F5/F7, guardas cumulativas e padrão CAS/recibos das candidaturas. O detalhe existente recebe secções de documentos, estado de processamento, conjunto em revisão, decisão e histórico; reutilizar os controlos de erro, recarregamento e recuperação de envio incerto. São necessários binding tenant-local de versões exatas à candidatura, snapshot/decisão append-only, operações autorizadas e eventos F7 próprios, bem como adaptação do fluxo F11 ao recurso `APPLICATION`; a migration 003 não estabelece esse binding e as migrations 021/022 não contêm revisão documental.

**Limite real do suporte:** F11 está validado localmente com double, mas `productionDocuments` devolve `handlers: []` e permanece fail-closed sem R2, scanner e Camada C validados. As rotas de anexos do piloto UBI usam filesystem e permissões legacy; são referência de interface, não backend reutilizável para o produto multi-tenant. A implementação futura pode validar o domínio em PostgreSQL/browser local com adapter de teste, mas não deve declarar upload/download produtivos antes do gate F11 real.

## Critérios de aceitação

1. Upload F11 ou associação autorizada fixa versão da mesma organização; estados inseguros não entram em revisão nem permitem download. Nova versão não substitui vínculo nem aprovação anterior.
2. Pedido fixa exatamente as versões visíveis no momento e decisão autorizada regista resultado/comentário, autor e instante sem mudar a candidatura; detalhe e histórico permitem consultar o conjunto decidido e assinalam nova revisão necessária após alterações.
3. Participante sem grants não vê conteúdo; grants assimétricos de candidatura/F11, revogação, IDOR e A/B são exercitados em PostgreSQL real. Download revalida F11 e estado da versão, inclusive após decisão.
4. CAS, duplo envio, duas decisões concorrentes, falha F7 e COMMIT incerto preservam atomicidade, uma decisão por pedido e recuperação sem sucesso falso; paginação histórica sem omissões/duplicações.
5. Browser local percorre o fluxo com estados e erros claros; testes afetados e build passam. Provas com double/IdP simulado são identificadas como locais, sem alegar R2/scanner produtivos.

## Decisões de produto aprovadas

1. **Resultado mínimo:** `APPROVED` ou `CHANGES_REQUESTED`, com comentário obrigatório em ambos; sem rejeição terminal da candidatura.
2. **Autoridade da decisão:** grant distinto `application.review.decide`, decisor diferente do requerente e sessão válida (MFA adicional não obrigatório, decisão de 2026-10-25); `application.edit` basta para solicitar.
3. **Efeito de alterações e da decisão:** pedido pendente obsoleto não pode receber decisão e exige novo pedido; nenhuma decisão altera automaticamente o estado da candidatura.

Sem outras escolhas de produto pendentes para este recorte. O gate R2/scanner/Camada C de F11 é dependência técnica de operação produtiva, não uma decisão para contornar com o filesystem UBI.

## Política substituída em 2026-10-25

A exigência anterior de RECENT_MFA para decidir foi substituída explicitamente pelo utilizador. Ver [verificação adicional por email](optional-email-verification.md). Mantêm-se todas as outras guardas e as políticas de outros domínios. Provas históricas com TOTP não são reescritas nem constituem prova do novo fluxo de email.
