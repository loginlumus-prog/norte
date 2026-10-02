-- AlterTable
ALTER TABLE "vendas" ADD COLUMN     "chave" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "vendas_org_id_chave_key" ON "vendas"("org_id", "chave");
