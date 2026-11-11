# Ambiente local persistente — catálogo real C4G

2026-10-17. [Contrato](../../features/c4g-catalog-demo-environment.md). Ambiente local disponibilizado, sem publicar a aplicação nem reconfigurar a instância habitual. Este marco não fecha o MVP completo.

**Atualização posterior:** [seleção atual corrigida e validada](current-selection.md). A interface mostra por defeito quatro oportunidades com próximo prazo atual/futuro; cinco antigas continuam acessíveis ao limpar filtros. A limitação histórica de usar apenas a primeira data, descrita abaixo, foi corrigida; cobertura integral da fonte continua por provar.

## Abrir e operar

Aplicação: **http://localhost:5189/catalogo**. Estado: **http://localhost:5189/demo-health**. Apenas acessível nesta máquina.

Na raiz do repositório, PowerShell:

```powershell
# Iniciar/reabrir os serviços, preservando os dados existentes
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/catalog-demo/start.ps1

# Abrir Chrome com duas sessões isoladas e login real/MFA
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/catalog-demo/open.ps1

# Parar só API/worker desta demonstração; manter bases e volume
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/catalog-demo/stop.ps1
```

Fechar o Chrome não para os serviços nem elimina dados. Após reinício do computador, executar start e open; Docker e Keycloak local têm de estar disponíveis. Não executar os comandos de reset/down do ambiente F2 para esta demonstração. A demo depende do Keycloak e do proxy TLS locais já existentes (`8080`/`8443`); esses serviços não foram alterados ou reiniciados.

`open.ps1` autentica as contas locais de demonstração pelo fluxo OIDC normal, incluindo password e TOTP. Não injeta cookies nem fabrica evidência MFA. Credenciais ficam no diretório local privado `.tmp/catalog-demo`, ignorado pelo Git e com ACL do utilizador Windows e SYSTEM. Não são apresentadas neste documento. A conta ADMIN usa a identidade local existente; o gestor usa a nova conta exclusiva `c4g-demo-manager`. Sessões mantêm expiração normal: para voltar a entrar, usar open. O comando não recolhe oportunidades.

O ADMIN abre **Fontes de oportunidades** e pode usar **Atualizar agora**: uma página, no máximo cinco resultados de EU Funding & Tenders por atualização manual. O worker em processo separado permanece disponível, mas não agenda recolhas. O gestor consulta o catálogo, escolhe **Entidade de demonstração A/B** e cria candidaturas privadas. Não são entidades de clientes reais.

## Persistência e composição

| Componente | Destino / comportamento |
| --- | --- |
| API + frontend compilado | localhost:5189; composição OIDC/F12 existente, sem endpoints legados operacionais |
| Worker | Processo próprio; adaptador existente, modo `live-demo`, destino rigidamente limitado à demo e cinco resultados |
| PostgreSQL | `127.0.0.1:5561`, contentor `c4g-catalog-demo`, volume `c4g-catalog-demo-data`; dados não removidos no fecho |
| Bases | Central e A/B separadas; nomes internos provenientes do bootstrap existente, não representam dados de UBI |
| Identidade | Keycloak local, cliente novo `c4g-catalog-demo`; cliente habitual inalterado; membership/grants e MFA verificados no servidor |
| Configuração | Local privada em `.tmp/catalog-demo`; snapshots fixos de diretório no servidor, credenciais específicas por tenant e verificação física/schema F4 mantida |

O primeiro provisionamento reutilizou os runners e a preparação do harness existente, apenas no contentor novo. Reiniciar usa a configuração guardada e não repete migrations, seeds, provas de downgrade ou recolhas. Não é um provisionador produtivo: o diretório local fixo e a identidade administrativa da ligação Central exigem substituição/validação de privilégios mínimos antes de alojamento produtivo. Os tenants usam os logins limitados existentes. Falha de preparação mantém os dados para inspeção, sem reset automático.

## Verificações efetivamente realizadas

- Chrome com login **real** OIDC/PKCE e TOTP no Keycloak local; autoridade C4G_ADMIN consultada na Central.
- Atualização iniciada no botão ADMIN, consumida por worker separado: `SUCCESS`, cinco criadas, zero falhadas.
- Cinco registos públicos reais listados e detalhe aberto no browser. [Catálogo](real-catalog.png), [detalhe](real-detail.png).
- Gestor criou `Demonstração C4G — candidatura privada` na entidade A; B não lê a candidatura, mas lê a mesma oportunidade pública. O gestor recebe 403 na administração de fontes.
- API/worker parados e reiniciados pelos scripts, sem apagar bases. Novo login confirmou os mesmos cinco identificadores e a candidatura persistida.
- Segunda atualização limitada, após correção do programa: zero criadas, quatro atualizadas, zero falhadas. Nenhuma duplicação. Snapshot histórico da candidatura preservado.
- Build frontend PASS; 100/100 testes frontend; 18/18 testes backend focados (fonte, filtros, autorização, limite de destino demo e correção CEF); sintaxe dos scripts/módulos alterados e diff do recorte PASS.

Durante a preparação, o Keycloak atribuiu um subject diferente do id proposto para a conta nova. O vínculo foi corrigido para o subject efetivo; a criação passa a consultá-lo antes de ligar a identidade central. Não se desativou verificação OIDC, MFA ou membership. O teste de browser passou a selecionar oportunidades por identidade, pois os registos reais têm títulos repetidos.

## Limitações descobertas nos dados reais

**A amostra contém prazos antigos.** A recolha real e a persistência funcionam, mas estes cinco registos não demonstram cobertura de avisos atualmente abertos. Não alterar datas para a apresentação, não inferir elegibilidade e não apresentar esta amostra como catálogo integral. A consulta herdada à fonte e a atualidade dos seus filtros precisam de validação antes de uma demonstração comercial de descoberta atual.

O mapeamento legado tratava `43251567` como DIGITAL. A correção ficou confinada ao adaptador central, identificando-o como CEF, com teste de regressão. A [ficha oficial CINEA](https://ec.europa.eu/assets/cinea/PCI/files/PCIFiche_13.11_1st_PCI_PMI_list.pdf) associa esse identificador a CEF2027. A repetição manual aplicou revisões pelo fluxo normal; histórico e correções manuais permanecem protegidos. Um dos cinco registos conserva um código de programa sem tradução, sem inventar equivalência. O restante mapa legado não foi certificado.

Persistência comprovada após reinício de API/worker; reinício completo do Windows/Docker não foi executado. Não validado: produção, IdP de cliente, dados privados de uma entidade real, todas as fontes, completude/atualidade do catálogo, documentos produtivos e matching recuperado. Nenhuma dessas áreas foi desenvolvida nesta tarefa.

Sem commit, push, deploy público ou alteração das bases habituais. Duas recolhas manuais limitadas da mesma fonte, para criação e correção verificável da amostra; nenhum agendamento nem chamadas pagas.

Próximo passo: rever nesta demonstração o percurso ADMIN → catálogo → candidatura e corrigir a seleção de avisos atuais da fonte antes de avançar para outra funcionalidade.
