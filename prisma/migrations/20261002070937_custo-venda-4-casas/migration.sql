-- O custo do item vendido com 4 casas, como o custo médio da variação e do
-- produto: arredondar R$ 0,1550 para R$ 0,16 errava a margem de quem vende
-- miúdo em quantidade. Alargar a escala não perde nada do que já está gravado.
ALTER TABLE "venda_itens" ALTER COLUMN "custo_unit" SET DATA TYPE DECIMAL(12,4);
