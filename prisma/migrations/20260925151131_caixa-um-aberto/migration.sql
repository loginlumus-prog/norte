-- Uma loja, no máximo um caixa aberto (ver model Caixa no schema).
--
-- Escrito à mão: se já existir loja com dois caixas abertos, o CREATE UNIQUE
-- INDEX falharia com "could not create unique index" e nenhuma pista de qual
-- loja. Aqui ele para ANTES, dizendo quais — e não conserta sozinho: fechar
-- um turno mexe em dinheiro contado, e isso é decisão de gente.
--
-- Para ver os casos:
--   select unidade_id, count(*), array_agg(id order by aberto_em)
--     from caixas where aberto group by unidade_id having count(*) > 1;
DO $$
DECLARE lojas text;
BEGIN
  SELECT string_agg(unidade_id, ', ') INTO lojas
    FROM (SELECT unidade_id FROM "caixas" WHERE aberto GROUP BY unidade_id HAVING count(*) > 1) d;
  IF lojas IS NOT NULL THEN
    RAISE EXCEPTION 'Loja(s) com mais de um caixa aberto: %. Feche os turnos a mais antes de migrar.', lojas;
  END IF;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "caixas_um_aberto_por_unidade" ON "caixas"("unidade_id") WHERE (aberto);
