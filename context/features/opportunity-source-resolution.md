# Resolução documentada dos seis conflitos P2

Estado: Complete (29/10/2026). Implementação, validação isolada e ativação local expressamente autorizadas e concluídas. Pedido confirmado pelo utilizador após a [revisão documental](../research/opportunity-source-conflicts-2026-10-28.md). P3 não iniciado.

## Contrato

Guardar resoluções específicas por identificador e pela evidência observada, com nova revisão imutável do catálogo, autor, data, motivo, documentos oficiais e as duas representações públicas originais. Preservar as revisões anteriores e snapshots das candidaturas. A resolução não estabelece precedência global entre SEDIA e CENTRICITY.

Quatro CEF: CLOSED e última ronda 07/11/2023 às 17:00 Bruxelas. ECHE: calendário sem o corte retirado de 2027, último corte 24/03/2026 às 17:00 Bruxelas; estado publicado OPEN e estado temporal CLOSED. ESC: sessão CLOSED após 22/09/2026 às 17:00 Bruxelas, com nota sobre a continuidade da certificação. Datas sem hora comprovada permanecem datas civis; horas comprovadas preservam o offset específico da data.

Resolução restrita aos campos temporais: não substituir títulos, resumos, montantes ou correções manuais não relacionadas. Uma repetição semanticamente igual da fonte conserva a resolução e não cria revisões redundantes. Mudança de estado, calendário, identidade, condições ou conteúdo observado reabre revisão e preserva os últimos dados confirmados. Ausência, erro, truncagem ou evidência incompleta nunca validam uma resolução.

Repetir o pedido original é apenas replay, não confirma avisos entretanto reabertos. Uma nova revisão explícita, com novo pedido e evidência novamente coincidente, guarda novas decisões/revisões antes de limpar esses avisos. Mantém-se o arquivo da revisão anterior.

## Implementação prevista

- Evidência limitada e fingerprint determinístico independente da ordem dos resultados e das datas internas de ingestão; consultas exatas preservam os payloads originais. A data civil estruturada em `actions.deadlineDates` não é convertida em meia-noite exata. Outros instantes legítimos conservam-se.
- Migração aditiva 035: arquivo imutável de resoluções/evidência, ligado à identidade e às revisões, sem acesso do leitor de catálogo. Metadados públicos reduzidos da resolução ficam na nova revisão. Autoridade de administrador verificada dentro da transação, bloqueios/idempotência e recusa de revisão/evidência desatualizada.
- Integração no refresh: manter decisão existente apenas quando a evidência coincide; qualquer mudança volta a exigir revisão. Sem alteração ao histórico de execuções anteriores.
- Interface de detalhe apresenta motivo, fontes, data da resolução e distinção entre estado publicado e temporal. Não expõe payloads de auditoria.
- Pacote local revisto com os seis casos e comando de preparação/aplicação limitado a estes identificadores, com prévia verificação de identidade, revisão, hash e administrador; aplicação Dev separada da implementação.

## Critérios de aceitação

1. Seis casos reproduzidos em regressões antes do código; cada prazo final tem o offset correto e ECHE conserva OPEN publicado.
2. As duas representações e documentos ficam associados a uma decisão e revisão novas; dados anteriores e candidaturas permanecem intactos.
3. Repetição, reordenação dos resultados e alteração de ingestão não reaplicam a decisão. Alterações relevantes, novos resultados, ausência, erro ou truncagem reabrem revisão sem substituir dados confirmados.
4. Administrador revogado, digest desatualizado, concorrência e falha a meio não deixam alterações parciais; replay é idempotente.
5. Leitor restrito recebe apenas metadados públicos da revisão e não consegue ler/modificar evidência interna. As migrações/preflights continuam estritos.
6. Frontend mostra a resolução e fontes com segurança, sem ocultar a divergência ECHE ou a ressalva ESC; datas sem hora não apresentam uma hora inventada.
7. Testes focados, suites completas, build e sintaxe PASS. Gate PostgreSQL descartável próprio valida persistência/retoma, autoridade, ACL e histórico, mediante autorização específica quando preparado. A ativação local requer autorização do âmbito concreto; P3 só após conclusão da validação autorizada.

## Âmbito e validação

Sem produção, publicação Git, exclusões, alteração de dados tenant ou novas funcionalidades P3–P5. Não executar migrações nem gate externo por inferência da autorização de implementação. Registar aqui os resultados e limitações reais.

## Implementação e evidências

- Conector v4: evidência completa limitada, fingerprint semântico estável e confirmação do calendário civil em `actions` antes de converter meia-noite artificial. Pacote local contém os 12 resultados públicos e seis decisões documentadas; não depende de `output/` em execução.
- Migração 035: tabela imutável `funding_resolution`, apenas SELECT/INSERT para o runtime, sem acesso do leitor. `funding_run_item.source_resolution_id` liga a retoma à decisão efetivamente verificada. Os fingerprints foram medidos no contentor descartável e fixados no manifest; nenhuma migração aplicada anteriormente foi reescrita.
- Serviço de preparação/aplicação: administrador atual, bloqueio comum à recolha, digest/revisão esperada, aplicação das seis decisões na mesma transação, auditoria humana e proveniência manual; sem substituição dos campos não temporais. Refresh e apply protegem também modo legado, capability desativada e vínculo alterado após staging.
- Interface: estado publicado/temporal separados, motivo, data, notas e links oficiais; uma resolução antiga continua visível como histórico quando reaparece a revisão. Payloads e autor interno não são expostos.
- Regressões RED antes das correções; frontend **376 PASS**, build PASS. Chrome 1440/390: seis avisos e revisão reaberta, offsets/datas civis, fontes HTTPS, sem overflow ou erros; artefactos `output/playwright/funding-resolution-*`. Sintaxe dos 18 ficheiros de produção/scripts PASS.
- Gate autorizado em `test/integration/funding-tenders/resolution.ps1`, PostgreSQL 17 descartável na porta 5563. Duas calibrações preservadas; primeira prova completa interrompida porque a chave estrangeira impediu TRUNCATE antes do trigger. Prova ajustada para atingir o trigger sem enfraquecer a imutabilidade. Execução `gate-33218472597a4734ae4ef72388d755a4` PASS com manifest fixado; revisão independente encontrou posteriormente o caso de reconfirmação de aviso reaberto, corrigido com RED→GREEN e acrescentado à prova final.
- Verificação de leitura prévia à ativação: schema 034, 533 identidades, 1074 revisões e uma membership; seis conflitos preservados. As seis consultas públicas coincidiram com os hashes revistos. Ativação concreta preparada em `backend/scripts/localPlatform/activateFundingResolution.js --check`; o plano inclui hashes das revisões, referências esperadas e digest, sem credenciais.

Validação final: **backend 1632 PASS, 0 FAIL, 7 SKIP** preexistentes; frontend 376 PASS/build PASS. A primeira suite completa encontrou três expectativas/fixtures de allowlist que ainda terminavam em 034; foram atualizadas para 035 mantendo os controlos de drift. Gate final **PASS**, manifest fixado, em `output/funding-resolution-20261028/gate-cb064a0862e44b6eb18c480fa272bdbd/verification.json`, incluindo reconfirmação após reabertura e arquivo das primeiras decisões. Nenhum contentor com a etiqueta do gate permaneceu. Revisão independente de conector, persistência, autoridade e UI sem bloqueios após a correção do caso de reconfirmação. Capturas finais atualizadas com texto público simples; nomes internos da API ficam apenas na evidência arquivada.

## Ativação local autorizada e validada

Em 29/10, foram parados/reiniciados apenas o monitor/API e worker C4G identificados; migração 035 aplicada em `c4g_central_dev`. O comando voltou a confirmar a evidência pública, as revisões esperadas e a autoridade atual do administrador que iniciou a recolha P2. Guardadas **seis resoluções e seis novas revisões**, com proveniência C4G_MANUAL e auditoria humana; as duas representações de cada aviso ficaram arquivadas. Não foi iniciada outra recolha integral.

Preservação comprovada por hashes: **533 identidades estáveis, 1074 revisões anteriores intactas, 1080 revisões totais e uma membership inalterada**. Os seis `source_review` foram limpos apenas após a resolução atómica. Leitor real restrito validado com schema 035: lê decisões e revisões anteriores, não acede à tabela de evidências. As seis fichas estão temporalmente CLOSED; ECHE mantém OPEN publicado e ESC conserva a ressalva da certificação contínua. Horas finais: CEF/ECHE 17:00+01:00 e ESC 17:00+02:00, como documentado.

Às 00:09Z de 29/10: API/frontend HTTP 200, endpoint administrativo anónimo 401, worker PROCESSING com `resolutionSupported=true`, zero jobs ativos. Catálogo total 533: **275 abertas, 250 previstas, oito encerradas e zero por confirmar/canceladas**. Estes totais usam a data atual; a passagem de 28 para 29 altera também estados de outras oportunidades sem criar revisões. O histórico da recolha P2 anterior conserva legitimamente o resultado PARTIAL observado nessa execução.

Evidência: `output/funding-resolution-local-20261029/plan.json`, `verification.json`, `runtime-verification.json`, `command.json` e logs de arranque. Sem escrita em bases tenant, alteração de snapshots de candidaturas, produção, commit ou início de P3. [Fecho arquivado](../history/opportunity-source-resolution-2026-10-29.md).

Próximo passo: carregar P3 — enriquecimento das oportunidades, apoiado nas resoluções e calendários validados.
