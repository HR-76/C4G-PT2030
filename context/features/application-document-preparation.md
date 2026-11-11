# Documentos da candidatura — preparação e revisão
State: Complete

Reutilizar upload/verificação, associação de versões, revisão interna e histórico existentes. Sem ativação de R2/ClamAV reais, alteração de permissões ou migração.

Entrega: resumo de versões associadas/disponíveis/indisponíveis, orientação do próximo passo e motivo para pedido de revisão desativado; passos de carregamento/associação/revisão identificados; cartões documentais com estados legíveis; versões dos pedidos com nomes apenas quando a mesma versão consta dos dados autorizados; decisões e comentários separados por pedido. Não inferir completude do dossier nem submissão oficial a partir da revisão interna.

Aceitação: documento indisponível impede pedido como anteriormente; versões exatas/revisões/chaves conservadas; pedido antigo nunca recebe nome de outra versão; comentários/decisões não transitam entre formulários; pedidos próprios/desatualizados mantêm restrições; testes, build e UI desktop/móvel com API simulada.

## Entrega e revisão

- Resumo do conjunto associado: quantidade de versões, disponíveis e indisponíveis; orientação para associar versões ou resolver indisponibilidade. Não declara completude do dossier nem aprovação geral.
- Percurso visual identificado: carregar/verificar, associar versão e pedir/decidir revisão interna. Estados técnicos traduzidos em mensagens legíveis, conservando usable como única condição de disponibilidade existente.
- Cartões de documentos e pedidos com layout responsivo, botões consistentes, identificação técnica do pedido em detalhe expansível. Versões referenciadas usam nomes apenas quando documentId e versionId coincidem com dados já autorizados; versões antigas conservam os identificadores se o nome não estiver disponível.
- Comentário e decisão mantidos separadamente por requestId. Confirmar uma decisão limpa apenas o seu rascunho; pedido incerto conserva a intenção com o texto e a chave existentes. Mudança de contexto limpa rascunhos locais.
- Regras de revisão desatualizada, separação requerente/decisor, acesso documental, scan, polling limitado, associação explícita, histórico e contratos HTTP preservados. Nenhuma alteração backend ou infraestrutura.

## Validação

- Regressões RED→GREEN para indisponibilidade e isolamento dos rascunhos; teste de versão histórica evita associar o nome de uma versão atual a outra.
- Backend completo: 2583 aprovados, 7 ignorados. Frontend completo: 656 aprovados. Foco final: 17 aprovados; build aprovado.
- Chrome local, API simulada, 1440/390 px: preparação, nome da versão exata, comentário de revisão e ausência de overflow verificados. Captura móvel inspecionada; verificação repetida após simplificar a identificação dos pedidos.
- Evidência em output/document-preparation-*.log e output/playwright/document-preparation/verification.json. Revisão focada concluída sem impedimentos. Sem uploads reais, R2/ClamAV reais, migrações ou deploy.

Próximo passo: reunir equipa, tarefas e documentos num resumo de preparação da candidatura, com as pendências e ações seguintes.

## Robustez de ficheiros — 10/11/2026

A deteção PDF compara os bytes exatos da assinatura; nomes normalizados e truncados permanecem Unicode bem formado para os cabeçalhos de download. Não é inspeção estrutural completa de PDF/imagem nem validação do fornecedor real. Os controlos de quarentena e inspeção existentes mantêm-se. Critérios: recusar assinatura alterada, manter nomes codificáveis, preservar limites, scanner fail-closed e isolamento. Testes focados de documentos, PDF, OOXML e armazenamento: 66 PASS.
