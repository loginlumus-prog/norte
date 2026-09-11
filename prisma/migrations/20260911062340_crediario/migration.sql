-- AlterTable
ALTER TABLE "orgs" ADD COLUMN     "crediario_dias_entre" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "crediario_juros_mes" DECIMAL(5,2) NOT NULL DEFAULT 3,
ADD COLUMN     "crediario_max_parcelas" INTEGER NOT NULL DEFAULT 6;

-- CreateTable
CREATE TABLE "parcelas" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "venda_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "de" INTEGER NOT NULL,
    "vencimento" DATE NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "pago" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "juros" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "quitada_em" TIMESTAMP(3),
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "parcelas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recebimentos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "parcela_id" TEXT NOT NULL,
    "caixa_id" TEXT,
    "forma" "FormaPagamento" NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "juros" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "quem" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "recebimentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "parcelas_org_id_cliente_id_vencimento_idx" ON "parcelas"("org_id", "cliente_id", "vencimento");

-- CreateIndex
CREATE INDEX "parcelas_org_id_vencimento_quitada_em_idx" ON "parcelas"("org_id", "vencimento", "quitada_em");

-- CreateIndex
CREATE INDEX "parcelas_org_id_venda_id_idx" ON "parcelas"("org_id", "venda_id");

-- CreateIndex
CREATE INDEX "recebimentos_org_id_parcela_id_idx" ON "recebimentos"("org_id", "parcela_id");

-- CreateIndex
CREATE INDEX "recebimentos_org_id_criado_em_idx" ON "recebimentos"("org_id", "criado_em");

-- AddForeignKey
ALTER TABLE "parcelas" ADD CONSTRAINT "parcelas_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelas" ADD CONSTRAINT "parcelas_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "vendas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelas" ADD CONSTRAINT "parcelas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parcelas" ADD CONSTRAINT "parcelas_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recebimentos" ADD CONSTRAINT "recebimentos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recebimentos" ADD CONSTRAINT "recebimentos_parcela_id_fkey" FOREIGN KEY ("parcela_id") REFERENCES "parcelas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recebimentos" ADD CONSTRAINT "recebimentos_caixa_id_fkey" FOREIGN KEY ("caixa_id") REFERENCES "caixas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
