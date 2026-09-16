-- CreateEnum
CREATE TYPE "SituacaoTarefa" AS ENUM ('A_FAZER', 'EM_ANDAMENTO', 'PARADO', 'FEITO');

-- AlterTable
ALTER TABLE "produtos" ADD COLUMN     "prazo_reposicao_dias" INTEGER;

-- CreateTable
CREATE TABLE "quadros" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unidade_id" TEXT,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "cor" TEXT,
    "grupos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "arquivado" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "quem" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "quadros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tarefas" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "quadro_id" TEXT NOT NULL,
    "grupo" TEXT NOT NULL DEFAULT '',
    "titulo" TEXT NOT NULL,
    "descricao" TEXT,
    "responsavel_id" TEXT,
    "situacao" "SituacaoTarefa" NOT NULL DEFAULT 'A_FAZER',
    "prioridade" INTEGER NOT NULL DEFAULT 0,
    "progresso" INTEGER NOT NULL DEFAULT 0,
    "inicio" DATE,
    "prazo" DATE,
    "concluida_em" TIMESTAMP(3),
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "quem" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "tarefas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quadros_org_id_unidade_id_arquivado_idx" ON "quadros"("org_id", "unidade_id", "arquivado");

-- CreateIndex
CREATE INDEX "tarefas_org_id_quadro_id_situacao_idx" ON "tarefas"("org_id", "quadro_id", "situacao");

-- CreateIndex
CREATE INDEX "tarefas_org_id_responsavel_id_situacao_idx" ON "tarefas"("org_id", "responsavel_id", "situacao");

-- CreateIndex
CREATE INDEX "tarefas_org_id_prazo_idx" ON "tarefas"("org_id", "prazo");

-- AddForeignKey
ALTER TABLE "quadros" ADD CONSTRAINT "quadros_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quadros" ADD CONSTRAINT "quadros_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarefas" ADD CONSTRAINT "tarefas_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarefas" ADD CONSTRAINT "tarefas_quadro_id_fkey" FOREIGN KEY ("quadro_id") REFERENCES "quadros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarefas" ADD CONSTRAINT "tarefas_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
