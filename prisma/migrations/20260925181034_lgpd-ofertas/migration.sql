-- LGPD: o consentimento para ofertas no WhatsApp na ficha do cliente
-- (clientes.ofertas_*), a marca de ficha anonimizada (clientes.anonimizado_em)
-- e a lista de descadastro PERMANENTE por empresa (optout_whatsapp) — ver
-- src/servidor/ofertas.ts e src/servidor/cliente.ts.
--
-- Tabela nova nasce sem RLS: depois de aplicar, rodar o preparar (ou o
-- prisma/sql/rls.sql), que a pega na varredura de org_id e cria a função
-- anonimizar_auditoria.
--
-- O diff contra produção trouxe também um `DROP INDEX "campanha_execucoes_uma_viva"`,
-- e ele foi TIRADO daqui à mão: é o Prisma lendo o índice PARCIAL das
-- campanhas (o texto do predicado como o Postgres o guarda,
-- "status = ANY (ARRAY[...])", não bate com o do schema) e achando que sobra.
-- Não sobra: é ele que garante "uma campanha viva por telefone". Apagá-lo
-- deixaria duas mensagens simultâneas abrirem duas campanhas para a mesma
-- pessoa. Mesma coisa já anotada na migração whatsapp-oficial.

-- CreateEnum
CREATE TYPE "ConsentimentoOfertas" AS ENUM ('SIM', 'NAO', 'NAO_PERGUNTADO');

-- AlterTable
ALTER TABLE "clientes" ADD COLUMN     "anonimizado_em" TIMESTAMP(3),
ADD COLUMN     "ofertas_em" TIMESTAMP(3),
ADD COLUMN     "ofertas_origem" TEXT,
ADD COLUMN     "ofertas_por" TEXT,
ADD COLUMN     "ofertas_whatsapp" "ConsentimentoOfertas" NOT NULL DEFAULT 'NAO_PERGUNTADO';

-- CreateTable
CREATE TABLE "optout_whatsapp" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "optout_whatsapp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "optout_whatsapp_org_id_em_idx" ON "optout_whatsapp"("org_id", "em");

-- CreateIndex
CREATE UNIQUE INDEX "optout_whatsapp_org_id_telefone_key" ON "optout_whatsapp"("org_id", "telefone");

-- AddForeignKey
ALTER TABLE "optout_whatsapp" ADD CONSTRAINT "optout_whatsapp_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
