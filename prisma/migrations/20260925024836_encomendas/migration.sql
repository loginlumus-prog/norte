-- CreateEnum
CREATE TYPE "SituacaoEncomenda" AS ENUM ('ABERTA', 'PRONTA', 'ENTREGUE', 'CANCELADA');

-- CreateTable
CREATE TABLE "encomendas" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "cliente_id" TEXT,
    "cliente_nome" TEXT NOT NULL,
    "telefone" TEXT,
    "descricao" TEXT NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sinal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "para" TIMESTAMP(3) NOT NULL,
    "entrega" BOOLEAN NOT NULL DEFAULT false,
    "endereco" TEXT,
    "situacao" "SituacaoEncomenda" NOT NULL DEFAULT 'ABERTA',
    "observacao" TEXT,
    "concluida_em" TIMESTAMP(3),
    "quem" TEXT NOT NULL,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "encomendas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "encomendas_org_id_unidade_id_para_idx" ON "encomendas"("org_id", "unidade_id", "para");

-- CreateIndex
CREATE INDEX "encomendas_org_id_situacao_idx" ON "encomendas"("org_id", "situacao");

-- AddForeignKey
ALTER TABLE "encomendas" ADD CONSTRAINT "encomendas_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encomendas" ADD CONSTRAINT "encomendas_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "encomendas" ADD CONSTRAINT "encomendas_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
