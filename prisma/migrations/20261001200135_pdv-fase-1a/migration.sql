-- DropIndex
-- (o Prisma lê mal o índice parcial campanha_execucoes_uma_viva e pede para apagá-lo: removido de propósito)

-- AlterTable
ALTER TABLE "orgs" ADD COLUMN     "crediario_arredondar" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "crediario_carencia_dias" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "crediario_multa_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "credito_juros_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
ADD COLUMN     "credito_max_parcelas" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "vale_por_loja" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vende_sem_estoque" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "pagamentos" ADD COLUMN     "juros" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "maquininha" TEXT;

-- AlterTable
ALTER TABLE "parcelas" ADD COLUMN     "desconto" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "multa" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "multa_cobrada" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "recebimentos" ADD COLUMN     "desconto" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "externo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maquininha" TEXT,
ADD COLUMN     "multa" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "recibo_id" TEXT,
ADD COLUMN     "taxa_pct" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "unidades" ADD COLUMN     "inscricao_estadual" TEXT,
ADD COLUMN     "maquininhas" JSONB,
ADD COLUMN     "razao_social" TEXT;

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "pin_definido_em" TIMESTAMP(3),
ADD COLUMN     "pin_hash" TEXT;

-- AlterTable
ALTER TABLE "vales" ADD COLUMN     "unidade_id" TEXT;

-- AlterTable
ALTER TABLE "venda_itens" ADD COLUMN     "conferido_em" TIMESTAMP(3),
ADD COLUMN     "conferido_por" TEXT,
ADD COLUMN     "saldo_na_venda" DECIMAL(14,3);

-- AlterTable
ALTER TABLE "vendas" ADD COLUMN     "acrescimo" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "autorizado_por" TEXT,
ADD COLUMN     "autorizado_por_id" TEXT;

-- CreateTable
CREATE TABLE "recibos_crediario" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "cliente_id" TEXT NOT NULL,
    "caixa_id" TEXT,
    "valor" DECIMAL(12,2) NOT NULL,
    "juros" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "multa" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "desconto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "perdoado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "troco" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "saldo_antes" DECIMAL(12,2) NOT NULL,
    "saldo_depois" DECIMAL(12,2) NOT NULL,
    "externo" BOOLEAN NOT NULL DEFAULT false,
    "referencia" TEXT,
    "pago_em" DATE,
    "quem_id" TEXT,
    "quem" TEXT NOT NULL,
    "autorizado_por_id" TEXT,
    "autorizado_por" TEXT,
    "motivo" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "recibos_crediario_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recibos_crediario_org_id_cliente_id_criado_em_idx" ON "recibos_crediario"("org_id", "cliente_id", "criado_em");

-- CreateIndex
CREATE INDEX "recibos_crediario_org_id_caixa_id_idx" ON "recibos_crediario"("org_id", "caixa_id");

-- CreateIndex
CREATE INDEX "recibos_crediario_org_id_unidade_id_criado_em_idx" ON "recibos_crediario"("org_id", "unidade_id", "criado_em");

-- CreateIndex
CREATE INDEX "recebimentos_org_id_recibo_id_idx" ON "recebimentos"("org_id", "recibo_id");

-- AddForeignKey
ALTER TABLE "vales" ADD CONSTRAINT "vales_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recebimentos" ADD CONSTRAINT "recebimentos_recibo_id_fkey" FOREIGN KEY ("recibo_id") REFERENCES "recibos_crediario"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recibos_crediario" ADD CONSTRAINT "recibos_crediario_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recibos_crediario" ADD CONSTRAINT "recibos_crediario_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recibos_crediario" ADD CONSTRAINT "recibos_crediario_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recibos_crediario" ADD CONSTRAINT "recibos_crediario_caixa_id_fkey" FOREIGN KEY ("caixa_id") REFERENCES "caixas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
