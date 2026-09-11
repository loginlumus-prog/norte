-- DropForeignKey
ALTER TABLE "venda_itens" DROP CONSTRAINT "venda_itens_variacao_id_fkey";

-- AlterTable
ALTER TABLE "venda_itens" ALTER COLUMN "variacao_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "venda_itens" ADD CONSTRAINT "venda_itens_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
