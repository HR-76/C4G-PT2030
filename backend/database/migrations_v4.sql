-- Recalcula estados das oportunidades a partir das datas.
-- Mantem oportunidades canceladas como Cancelado.
UPDATE opportunities
SET status = CASE
  WHEN status IN ('Cancelado', 'CANCELADO') THEN 'Cancelado'
  WHEN closing_date IS NOT NULL AND closing_date < CURRENT_DATE THEN 'Encerrado'
  WHEN opening_date IS NOT NULL AND opening_date > CURRENT_DATE THEN 'Previsto'
  ELSE 'Aberto'
END,
updated_at = CURRENT_TIMESTAMP;

