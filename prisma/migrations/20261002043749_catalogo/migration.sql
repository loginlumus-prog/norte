-- CreateEnum
CREATE TYPE "OrigemEncomenda" AS ENUM ('BALCAO', 'CATALOGO');

-- DropIndex

-- AlterTable
ALTER TABLE "encomendas" ADD COLUMN     "acompanhamento" TEXT,
ADD COLUMN     "forma_combinada" "FormaPagamento",
ADD COLUMN     "ip_resumo" TEXT,
ADD COLUMN     "origem" "OrigemEncomenda" NOT NULL DEFAULT 'BALCAO',
ADD COLUMN     "taxa_entrega" DECIMAL(12,2),
ADD COLUMN     "vista_em" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "produtos" ADD COLUMN     "foto_id" TEXT;

-- AlterTable
ALTER TABLE "propostas_agente" ADD COLUMN     "usuario_id" TEXT;

-- CreateTable
CREATE TABLE "encomenda_itens" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "encomenda_id" TEXT NOT NULL,
    "variacao_id" TEXT,
    "descricao" TEXT NOT NULL,
    "quantidade" DECIMAL(12,3) NOT NULL,
    "preco_unit" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "observacao" TEXT,

CONSTRAINT "encomenda_itens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "catalogos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "endereco" TEXT NOT NULL,
    "whatsapp" TEXT,
    "recado" TEXT,
    "retirada" BOOLEAN NOT NULL DEFAULT true,
    "entrega" BOOLEAN NOT NULL DEFAULT false,
    "taxa_entrega" DECIMAL(12,2),
    "pedido_minimo" DECIMAL(12,2),
    "chave_pix" TEXT,
    "mostrar_esgotado" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "catalogos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "encomenda_itens_org_id_encomenda_id_idx" ON "encomenda_itens"("org_id", "encomenda_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalogos_unidade_id_key" ON "catalogos"("unidade_id");

-- CreateIndex
CREATE UNIQUE INDEX "catalogos_org_id_endereco_key" ON "catalogos"("org_id", "endereco");

-- CreateIndex
CREATE UNIQUE INDEX "encomendas_acompanhamento_key" ON "encomendas"("acompanhamento");

-- CreateIndex
CREATE INDEX "encomendas_org_id_origem_criada_em_idx" ON "encomendas"("org_id", "origem", "criada_em");

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_foto_id_fkey" FOREIGN KEY ("foto_id") REFERENCES "midias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encomenda_itens" ADD CONSTRAINT "encomenda_itens_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encomenda_itens" ADD CONSTRAINT "encomenda_itens_encomenda_id_fkey" FOREIGN KEY ("encomenda_id") REFERENCES "encomendas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encomenda_itens" ADD CONSTRAINT "encomenda_itens_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogos" ADD CONSTRAINT "catalogos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "catalogos" ADD CONSTRAINT "catalogos_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;
