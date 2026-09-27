-- Contas: redefinir a senha, confirmar o e-mail e o cadastro pelo site.
--   tokens_conta        o link de uso único (só o SHA-256 dele fica aqui)
--   pedidos_conta       o freio do "esqueci a senha" (e-mail digitado + IP)
--   cadastros_publicos  o freio do cadastro pelo site (sem org_id: só a
--                       função criar_empresa_cadastro, de rls.sql, lê e grava)
--   usuarios.email_pendente  conta do cadastro que ainda não confirmou o e-mail
-- Ver src/servidor/conta.ts e src/servidor/autocadastro.ts.
--
-- Tabela nova nasce sem RLS e sem a função do cadastro: depois de aplicar,
-- rodar o preparar (ou o prisma/sql/rls.sql), que pega tokens_conta e
-- pedidos_conta na varredura de org_id, tranca cadastros_publicos e cria
-- criar_empresa_cadastro.
--
-- O diff contra produção trouxe também um `DROP INDEX "campanha_execucoes_uma_viva"`,
-- e ele foi TIRADO daqui à mão: é o Prisma lendo o índice PARCIAL das
-- campanhas (o predicado como o Postgres o guarda não bate com o do schema)
-- e achando que sobra. Não sobra: é ele que garante "uma campanha viva por
-- telefone". Mesma nota das migrações whatsapp-oficial e lgpd-ofertas.

-- CreateEnum
CREATE TYPE "TipoTokenConta" AS ENUM ('SENHA', 'EMAIL');

-- AlterTable
ALTER TABLE "usuarios" ADD COLUMN     "email_pendente" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "tokens_conta" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "tipo" "TipoTokenConta" NOT NULL,
    "hash" TEXT NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "usado_em" TIMESTAMP(3),
    "ip" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "tokens_conta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pedidos_conta" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "tipo" "TipoTokenConta" NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "pedidos_conta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cadastros_publicos" (
    "id" TEXT NOT NULL,
    "ip_resumo" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "cadastros_publicos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tokens_conta_hash_key" ON "tokens_conta"("hash");

-- CreateIndex
CREATE INDEX "tokens_conta_org_id_usuario_id_tipo_idx" ON "tokens_conta"("org_id", "usuario_id", "tipo");

-- CreateIndex
CREATE INDEX "pedidos_conta_org_id_email_criado_em_idx" ON "pedidos_conta"("org_id", "email", "criado_em");

-- CreateIndex
CREATE INDEX "pedidos_conta_org_id_ip_criado_em_idx" ON "pedidos_conta"("org_id", "ip", "criado_em");

-- CreateIndex
CREATE INDEX "cadastros_publicos_ip_resumo_criado_em_idx" ON "cadastros_publicos"("ip_resumo", "criado_em");

-- AddForeignKey
ALTER TABLE "tokens_conta" ADD CONSTRAINT "tokens_conta_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tokens_conta" ADD CONSTRAINT "tokens_conta_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pedidos_conta" ADD CONSTRAINT "pedidos_conta_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
