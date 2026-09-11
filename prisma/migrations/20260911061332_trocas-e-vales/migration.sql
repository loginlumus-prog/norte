-- CreateEnum
CREATE TYPE "DestinoDevolucao" AS ENUM ('VALE', 'DINHEIRO', 'ESTORNO');

-- AlterTable
ALTER TABLE "pagamentos" ADD COLUMN     "vale_id" TEXT;

-- CreateTable
CREATE TABLE "devolucoes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "venda_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "destino" "DestinoDevolucao" NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "motivo" TEXT NOT NULL,
    "quem" TEXT NOT NULL,
    "usuario_id" TEXT,
    "vale_id" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devolucoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devolucao_itens" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "devolucao_id" TEXT NOT NULL,
    "venda_item_id" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "devolucao_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vales" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "cliente_id" TEXT,
    "valor" DECIMAL(12,2) NOT NULL,
    "saldo" DECIMAL(12,2) NOT NULL,
    "validade" DATE,
    "quem" TEXT NOT NULL,
    "usado_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "devolucoes_vale_id_key" ON "devolucoes"("vale_id");

-- CreateIndex
CREATE INDEX "devolucoes_org_id_venda_id_idx" ON "devolucoes"("org_id", "venda_id");

-- CreateIndex
CREATE INDEX "devolucoes_org_id_unidade_id_criada_em_idx" ON "devolucoes"("org_id", "unidade_id", "criada_em");

-- CreateIndex
CREATE INDEX "devolucao_itens_org_id_devolucao_id_idx" ON "devolucao_itens"("org_id", "devolucao_id");

-- CreateIndex
CREATE INDEX "devolucao_itens_org_id_venda_item_id_idx" ON "devolucao_itens"("org_id", "venda_item_id");

-- CreateIndex
CREATE INDEX "vales_org_id_cliente_id_idx" ON "vales"("org_id", "cliente_id");

-- CreateIndex
CREATE UNIQUE INDEX "vales_org_id_codigo_key" ON "vales"("org_id", "codigo");

-- AddForeignKey
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_vale_id_fkey" FOREIGN KEY ("vale_id") REFERENCES "vales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucoes" ADD CONSTRAINT "devolucoes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucoes" ADD CONSTRAINT "devolucoes_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "vendas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucoes" ADD CONSTRAINT "devolucoes_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucoes" ADD CONSTRAINT "devolucoes_vale_id_fkey" FOREIGN KEY ("vale_id") REFERENCES "vales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucao_itens" ADD CONSTRAINT "devolucao_itens_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucao_itens" ADD CONSTRAINT "devolucao_itens_devolucao_id_fkey" FOREIGN KEY ("devolucao_id") REFERENCES "devolucoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolucao_itens" ADD CONSTRAINT "devolucao_itens_venda_item_id_fkey" FOREIGN KEY ("venda_item_id") REFERENCES "venda_itens"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vales" ADD CONSTRAINT "vales_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vales" ADD CONSTRAINT "vales_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
