-- Custo com quatro casas (o mililitro de calda custa R$ 0,0028; com duas
-- casas virava zero) e o custo próprio da variação (cada sabor sai da fábrica
-- com o seu custo).
ALTER TABLE "produtos" ALTER COLUMN "custo" TYPE DECIMAL(12,4);
ALTER TABLE "variacoes" ADD COLUMN IF NOT EXISTS "custo" DECIMAL(12,4);

-- Lote único na empresa. O lote antigo repetido (o "contar + 1" do dia
-- reusava o número de uma ordem cujo lote foi renomeado) ganha o número da
-- ordem no fim, para o índice nascer.
UPDATE "ordens_producao" o
   SET "lote" = o."lote" || '-OP' || o."numero"
 WHERE EXISTS (
   SELECT 1 FROM "ordens_producao" x
    WHERE x."org_id" = o."org_id" AND x."lote" = o."lote" AND x."numero" < o."numero"
 );
CREATE UNIQUE INDEX IF NOT EXISTS "ordens_producao_org_id_lote_key" ON "ordens_producao"("org_id", "lote");
