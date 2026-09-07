-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Plano" AS ENUM ('BALCAO', 'BALCAO_AGENTE', 'REDE', 'CORPORATIVO');

-- CreateEnum
CREATE TYPE "Situacao" AS ENUM ('TESTE', 'ATIVA', 'INADIMPLENTE', 'SUSPENSA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('DONO', 'GERENTE', 'BALCAO', 'FINANCEIRO', 'CONTADOR', 'SUPORTE');

-- CreateEnum
CREATE TYPE "Autor" AS ENUM ('PESSOA', 'AGENTE', 'SISTEMA');

-- CreateTable
CREATE TABLE "orgs" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "documento" TEXT,
    "plano" "Plano" NOT NULL DEFAULT 'BALCAO',
    "situacao" "Situacao" NOT NULL DEFAULT 'TESTE',
    "teste_ate" TIMESTAMP(3),
    "suspensa_em" TIMESTAMP(3),
    "logo_url" TEXT,
    "cor_marca" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orgs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unidades" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "documento" TEXT,
    "apelido" TEXT,
    "endereco" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "cep" TEXT,
    "telefone" TEXT,
    "eh_deposito" BOOLEAN NOT NULL DEFAULT false,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "unidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT,
    "telefone" TEXT,
    "foto_url" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "ultimo_login" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acessos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "usuario_id" TEXT NOT NULL,
    "unidade_id" TEXT,
    "papel" "Papel" NOT NULL,
    "expira_em" TIMESTAMP(3),
    "motivo" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acessos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "convites" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "papel" "Papel" NOT NULL,
    "unidade_id" TEXT,
    "token" TEXT NOT NULL,
    "expira_em" TIMESTAMP(3) NOT NULL,
    "aceito_em" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "convites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auditoria" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unidade_id" TEXT,
    "usuario_id" TEXT,
    "quem" TEXT NOT NULL,
    "autor" "Autor" NOT NULL DEFAULT 'PESSOA',
    "acao" TEXT NOT NULL,
    "alvo_tipo" TEXT,
    "alvo_id" TEXT,
    "alvo_nome" TEXT,
    "antes" JSONB,
    "depois" JSONB,
    "valor" DECIMAL(14,2),
    "motivo" TEXT,
    "ip" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cobranca" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "provedor" TEXT,
    "assinatura_id" TEXT,
    "valor_mensal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "unidades_extras" INTEGER NOT NULL DEFAULT 0,
    "proxima_cobranca" TIMESTAMP(3),
    "pago_ate" TIMESTAMP(3),
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cobranca_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orgs_slug_key" ON "orgs"("slug");

-- CreateIndex
CREATE INDEX "unidades_org_id_idx" ON "unidades"("org_id");

-- CreateIndex
CREATE INDEX "usuarios_org_id_idx" ON "usuarios"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_org_id_email_key" ON "usuarios"("org_id", "email");

-- CreateIndex
CREATE INDEX "acessos_org_id_idx" ON "acessos"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "acessos_usuario_id_unidade_id_papel_key" ON "acessos"("usuario_id", "unidade_id", "papel");

-- CreateIndex
CREATE UNIQUE INDEX "convites_token_key" ON "convites"("token");

-- CreateIndex
CREATE INDEX "convites_org_id_idx" ON "convites"("org_id");

-- CreateIndex
CREATE INDEX "auditoria_org_id_criado_em_idx" ON "auditoria"("org_id", "criado_em");

-- CreateIndex
CREATE INDEX "auditoria_org_id_alvo_tipo_alvo_id_idx" ON "auditoria"("org_id", "alvo_tipo", "alvo_id");

-- CreateIndex
CREATE UNIQUE INDEX "cobranca_org_id_key" ON "cobranca"("org_id");

-- AddForeignKey
ALTER TABLE "unidades" ADD CONSTRAINT "unidades_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessos" ADD CONSTRAINT "acessos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessos" ADD CONSTRAINT "acessos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acessos" ADD CONSTRAINT "acessos_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "convites" ADD CONSTRAINT "convites_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cobranca" ADD CONSTRAINT "cobranca_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

