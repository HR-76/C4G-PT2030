# Circuit breaker aberto
Sintoma: dependência agregada indisponível. Ação: observar cooldown e health; não mudar tenant nem fazer fallback. Recovery: probe autorizado fecha o circuito.
