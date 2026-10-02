-- CreateEnum
CREATE TYPE "SituacaoOrdem" AS ENUM ('ABERTA', 'ENCERRADA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "SituacaoPedidoFabrica" AS ENUM ('ABERTO', 'ENVIADO', 'RECEBIDO', 'CANCELADO');

-- AlterTable
ALTER TABLE "unidades" ADD COLUMN     "eh_fabrica" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "receitas" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "variacao_id" TEXT NOT NULL,
    "rendimento" DECIMAL(14,3) NOT NULL,
    "validade_dias" INTEGER,
    "observacao" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "receitas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receita_itens" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "receita_id" TEXT NOT NULL,
    "insumo_id" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,

CONSTRAINT "receita_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordens_producao" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "variacao_id" TEXT NOT NULL,
    "bateladas" DECIMAL(10,3) NOT NULL,
    "quantidade_prevista" DECIMAL(14,3) NOT NULL,
    "quantidade_produzida" DECIMAL(14,3),
    "lote" TEXT NOT NULL,
    "fabricada_em" TIMESTAMP(3),
    "validade" DATE,
    "situacao" "SituacaoOrdem" NOT NULL DEFAULT 'ABERTA',
    "custo_total" DECIMAL(14,2),
    "custo_unitario" DECIMAL(14,4),
    "observacao" TEXT,
    "quem" TEXT NOT NULL,
    "usuario_id" TEXT,
    "encerrada_por" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "encerrada_em" TIMESTAMP(3),

CONSTRAINT "ordens_producao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ordem_consumos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "ordem_id" TEXT NOT NULL,
    "insumo_id" TEXT NOT NULL,
    "previsto" DECIMAL(14,3) NOT NULL,
    "usado" DECIMAL(14,3),
    "custo_unitario" DECIMAL(14,4),

CONSTRAINT "ordem_consumos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos_fabrica" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "loja_id" TEXT NOT NULL,
    "fabrica_id" TEXT NOT NULL,
    "situacao" "SituacaoPedidoFabrica" NOT NULL DEFAULT 'ABERTO',
    "observacao" TEXT,
    "pedido_por" TEXT NOT NULL,
    "enviado_por" TEXT,
    "enviado_em" TIMESTAMP(3),
    "recebido_por" TEXT,
    "recebido_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "pedidos_fabrica_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedido_fabrica_itens" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "pedido_id" TEXT NOT NULL,
    "variacao_id" TEXT NOT NULL,
    "pedida" DECIMAL(14,3) NOT NULL,
    "enviada" DECIMAL(14,3),
    "recebida" DECIMAL(14,3),
    "lote" TEXT,

CONSTRAINT "pedido_fabrica_itens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "receitas_variacao_id_key" ON "receitas"("variacao_id");

-- CreateIndex
CREATE INDEX "receitas_org_id_idx" ON "receitas"("org_id");

-- CreateIndex
CREATE INDEX "receita_itens_org_id_idx" ON "receita_itens"("org_id");

-- CreateIndex
CREATE INDEX "receita_itens_receita_id_idx" ON "receita_itens"("receita_id");

-- CreateIndex
CREATE INDEX "ordens_producao_org_id_situacao_idx" ON "ordens_producao"("org_id", "situacao");

-- CreateIndex
CREATE UNIQUE INDEX "ordens_producao_org_id_numero_key" ON "ordens_producao"("org_id", "numero");

-- CreateIndex
CREATE INDEX "ordem_consumos_org_id_idx" ON "ordem_consumos"("org_id");

-- CreateIndex
CREATE INDEX "ordem_consumos_ordem_id_idx" ON "ordem_consumos"("ordem_id");

-- CreateIndex
CREATE INDEX "pedidos_fabrica_org_id_situacao_idx" ON "pedidos_fabrica"("org_id", "situacao");

-- CreateIndex
CREATE UNIQUE INDEX "pedidos_fabrica_org_id_numero_key" ON "pedidos_fabrica"("org_id", "numero");

-- CreateIndex
CREATE INDEX "pedido_fabrica_itens_org_id_idx" ON "pedido_fabrica_itens"("org_id");

-- CreateIndex
CREATE INDEX "pedido_fabrica_itens_pedido_id_idx" ON "pedido_fabrica_itens"("pedido_id");

-- AddForeignKey
ALTER TABLE "receitas" ADD CONSTRAINT "receitas_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receitas" ADD CONSTRAINT "receitas_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receita_itens" ADD CONSTRAINT "receita_itens_receita_id_fkey" FOREIGN KEY ("receita_id") REFERENCES "receitas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receita_itens" ADD CONSTRAINT "receita_itens_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "variacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordens_producao" ADD CONSTRAINT "ordens_producao_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordens_producao" ADD CONSTRAINT "ordens_producao_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordens_producao" ADD CONSTRAINT "ordens_producao_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacoes"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordem_consumos" ADD CONSTRAINT "ordem_consumos_ordem_id_fkey" FOREIGN KEY ("ordem_id") REFERENCES "ordens_producao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordem_consumos" ADD CONSTRAINT "ordem_consumos_insumo_id_fkey" FOREIGN KEY ("insumo_id") REFERENCES "variacoes"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_fabrica" ADD CONSTRAINT "pedidos_fabrica_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_fabrica" ADD CONSTRAINT "pedidos_fabrica_loja_id_fkey" FOREIGN KEY ("loja_id") REFERENCES "unidades"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_fabrica" ADD CONSTRAINT "pedidos_fabrica_fabrica_id_fkey" FOREIGN KEY ("fabrica_id") REFERENCES "unidades"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_fabrica_itens" ADD CONSTRAINT "pedido_fabrica_itens_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos_fabrica"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedido_fabrica_itens" ADD CONSTRAINT "pedido_fabrica_itens_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacoes"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
