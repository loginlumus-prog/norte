-- CreateEnum
CREATE TYPE "TipoPonto" AS ENUM ('ENTRADA', 'SAIDA');

-- CreateEnum
CREATE TYPE "OrigemPonto" AS ENUM ('PROPRIO', 'GESTOR', 'AJUSTE');

-- CreateEnum
CREATE TYPE "SituacaoAgendamento" AS ENUM ('MARCADO', 'CONFIRMADO', 'ATENDIDO', 'FALTOU', 'CANCELADO');

-- CreateEnum
CREATE TYPE "SituacaoCompra" AS ENUM ('RASCUNHO', 'ENVIADO', 'PARCIAL', 'RECEBIDO', 'CANCELADO');

-- AlterEnum
ALTER TYPE "TipoMovimento" ADD VALUE 'CONSUMO';

-- AlterTable
ALTER TABLE "orgs" ADD COLUMN     "lembrete_ativo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lembrete_horas" INTEGER NOT NULL DEFAULT 24;

-- AlterTable
ALTER TABLE "produtos" ADD COLUMN     "duracao_min" INTEGER,
ADD COLUMN     "servico" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "colaboradores" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unidade_id" TEXT,
    "usuario_id" TEXT,
    "nome" TEXT NOT NULL,
    "cargo" TEXT,
    "telefone" TEXT,
    "atende" BOOLEAN NOT NULL DEFAULT false,
    "jornada_min" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "colaboradores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registros_ponto" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "colaborador_id" TEXT NOT NULL,
    "unidade_id" TEXT,
    "tipo" "TipoPonto" NOT NULL,
    "em" TIMESTAMP(3) NOT NULL,
    "origem" "OrigemPonto" NOT NULL,
    "motivo" TEXT,
    "quem_id" TEXT,
    "quem" TEXT NOT NULL,
    "anulado_em" TIMESTAMP(3),
    "anulado_por" TEXT,
    "motivo_anulacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "registros_ponto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agendamentos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "colaborador_id" TEXT NOT NULL,
    "cliente_id" TEXT,
    "cliente_nome" TEXT NOT NULL,
    "telefone" TEXT,
    "produto_id" TEXT,
    "servico" TEXT NOT NULL,
    "inicio" TIMESTAMP(3) NOT NULL,
    "fim" TIMESTAMP(3) NOT NULL,
    "situacao" "SituacaoAgendamento" NOT NULL DEFAULT 'MARCADO',
    "observacao" TEXT,
    "motivo" TEXT,
    "venda_id" TEXT,
    "lembrete_em" TIMESTAMP(3),
    "lembrete" TEXT,
    "quem_id" TEXT,
    "quem" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "agendamentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fornecedores" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "telefone" TEXT,
    "documento" TEXT,
    "observacao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "fornecedores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos_compra" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "fornecedor_id" TEXT,
    "situacao" "SituacaoCompra" NOT NULL DEFAULT 'RASCUNHO',
    "observacao" TEXT,
    "previsto" DATE,
    "quem_id" TEXT,
    "quem" TEXT NOT NULL,
    "enviado_em" TIMESTAMP(3),
    "recebido_em" TIMESTAMP(3),
    "cancelado_em" TIMESTAMP(3),
    "motivo_cancelamento" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "pedidos_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "itens_compra" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "pedido_id" TEXT NOT NULL,
    "variacao_id" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "recebido" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "custo_unit" DECIMAL(12,2),

CONSTRAINT "itens_compra_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recebimentos_compra" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "pedido_id" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "itens" JSONB NOT NULL,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "conta_lancada" BOOLEAN NOT NULL DEFAULT false,
    "quem_id" TEXT,
    "quem" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "recebimentos_compra_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "colaboradores_usuario_id_key" ON "colaboradores"("usuario_id");

-- CreateIndex
CREATE INDEX "colaboradores_org_id_ativo_idx" ON "colaboradores"("org_id", "ativo");

-- CreateIndex
CREATE INDEX "registros_ponto_org_id_colaborador_id_em_idx" ON "registros_ponto"("org_id", "colaborador_id", "em");

-- CreateIndex
CREATE INDEX "registros_ponto_org_id_em_idx" ON "registros_ponto"("org_id", "em");

-- CreateIndex
CREATE UNIQUE INDEX "agendamentos_venda_id_key" ON "agendamentos"("venda_id");

-- CreateIndex
CREATE INDEX "agendamentos_org_id_unidade_id_inicio_idx" ON "agendamentos"("org_id", "unidade_id", "inicio");

-- CreateIndex
CREATE INDEX "agendamentos_org_id_colaborador_id_inicio_idx" ON "agendamentos"("org_id", "colaborador_id", "inicio");

-- CreateIndex
CREATE INDEX "agendamentos_org_id_cliente_id_inicio_idx" ON "agendamentos"("org_id", "cliente_id", "inicio");

-- CreateIndex
CREATE INDEX "agendamentos_org_id_situacao_inicio_idx" ON "agendamentos"("org_id", "situacao", "inicio");

-- CreateIndex
CREATE INDEX "fornecedores_org_id_nome_idx" ON "fornecedores"("org_id", "nome");

-- CreateIndex
CREATE INDEX "pedidos_compra_org_id_situacao_idx" ON "pedidos_compra"("org_id", "situacao");

-- CreateIndex
CREATE INDEX "pedidos_compra_org_id_unidade_id_criado_em_idx" ON "pedidos_compra"("org_id", "unidade_id", "criado_em");

-- CreateIndex
CREATE INDEX "itens_compra_org_id_pedido_id_idx" ON "itens_compra"("org_id", "pedido_id");

-- CreateIndex
CREATE INDEX "recebimentos_compra_org_id_criado_em_idx" ON "recebimentos_compra"("org_id", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "recebimentos_compra_pedido_id_chave_key" ON "recebimentos_compra"("pedido_id", "chave");

-- AddForeignKey
ALTER TABLE "colaboradores" ADD CONSTRAINT "colaboradores_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores" ADD CONSTRAINT "colaboradores_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "colaboradores" ADD CONSTRAINT "colaboradores_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_ponto" ADD CONSTRAINT "registros_ponto_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_ponto" ADD CONSTRAINT "registros_ponto_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "colaboradores"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registros_ponto" ADD CONSTRAINT "registros_ponto_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_colaborador_id_fkey" FOREIGN KEY ("colaborador_id") REFERENCES "colaboradores"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agendamentos" ADD CONSTRAINT "agendamentos_venda_id_fkey" FOREIGN KEY ("venda_id") REFERENCES "vendas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fornecedores" ADD CONSTRAINT "fornecedores_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_compra" ADD CONSTRAINT "pedidos_compra_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_compra" ADD CONSTRAINT "pedidos_compra_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_compra" ADD CONSTRAINT "pedidos_compra_fornecedor_id_fkey" FOREIGN KEY ("fornecedor_id") REFERENCES "fornecedores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_compra" ADD CONSTRAINT "itens_compra_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_compra" ADD CONSTRAINT "itens_compra_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "itens_compra" ADD CONSTRAINT "itens_compra_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacoes"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recebimentos_compra" ADD CONSTRAINT "recebimentos_compra_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recebimentos_compra" ADD CONSTRAINT "recebimentos_compra_pedido_id_fkey" FOREIGN KEY ("pedido_id") REFERENCES "pedidos_compra"("id") ON DELETE CASCADE ON UPDATE CASCADE;
