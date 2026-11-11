# Limites locais de observabilidade

Estado: Review

Objetivo: impedir crescimento indefinido dos exportadores OpenTelemetry e do histórico local de métricas, preservando os sinais mais recentes e contabilizando perdas. São buffers em memória, não retenção operacional persistente. O limite de 2048 segue o contrato F10; a auditoria F7 permanece independente.

Aceitação: buffers de spans, ciclos de métricas e observações limitados a 2048; descarte do mais antigo contabilizado sem recursão; ciclo de vida e rejeição de exportação de rede preservados; testes de excesso, ordem, perdas e integração. O monitor do catálogo deve manter rotação antes de atingir o limite. Logs permanecem em stdout; retenção externa, amostragem e prazos produtivos exigem evidência do ambiente e decisão própria.

Resultado: buffers locais limitados a 2048, com contadores de descarte; monitor roda antes do limite. 30 testes focados PASS, frontend 837 PASS e build PASS. Suite backend completa falhou em testes HTTP com ligações loopback recusadas (EACCES); não comprova todas as restantes falhas. Sem alteração de retenção externa, sampling ou auditoria.
