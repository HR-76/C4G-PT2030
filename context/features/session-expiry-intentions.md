# Recuperação após expiração de sessão
State: Complete

Correção aprovada no percurso de candidaturas: resposta 401 conserva as intenções de candidatura, equipa, parceiros e documentos (incluindo upload) no sessionStorage. Continua a limpar CSRF e encaminhar para autenticação. Recuperação depende da mesma identidade, organização e candidatura aplicável, de nova consulta de permissões e de ação explícita. Logout explícito continua a limpar todas as intenções, mesmo se o pedido de logout falhar. Sem persistência adicional, reenvio automático, alteração de permissões ou do armazenamento dos outros módulos.

Aceitação: regressão com interceptor HTTP real; isolamento por identidade/contexto nos componentes e no navegador; expiração/reauth/consulta/recuperação e logout; suites completas e build. Infraestrutura real continua adiada.

## Entrega e revisão

O interceptor 401 já não chama clearApplicationIntentions. Mantém invalidação de CSRF e navegação de autenticação. AuthContext.logout continua a limpar intenções antes do pedido remoto, incluindo falha de logout. Nenhuma mudança de API, grants, backend ou esquema.

Revisão focada: armazenamento continua limitado ao sessionStorage existente, chaves e envelopes isolados por identidade/contexto; capacidades atuais controlam repetição; sem transmissão automática. Outros módulos mantêm a sua política de limpeza.

Regressão HTTP real reproduzida antes da correção (1 falha). Teste cobre preservação exata de candidatura/equipa/parceiros/documentos/upload. Teste de logout inclui chaves isoladas e upload. Frontend final: 697 testes aprovados / 82 ficheiros. Backend: 2594 aprovados, 7 ignorados, zero falhas. Build aprovado.

Chrome com API e sessões simuladas: 401 → login → outra identidade/organização/candidatura → contexto original, nos perfis administrador e membro; intenções preservadas, recuperação só oferecida no contexto e permissão corretos; zero escritas automáticas; logout explícito apaga intenções. Evidência: output/playwright/session-intentions/verification.json. Fixture de rotas corrigida antes da validação final.

Sem bloqueios identificados neste âmbito. Não substitui autenticação e infraestrutura reais; R2/ClamAV e deploy continuam adiados.

Próximo passo: rever estados e transições da candidatura face à UBI, identificando diferenças antes de novas alterações.
