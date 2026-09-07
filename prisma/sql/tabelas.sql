-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Regime" AS ENUM ('MEI', 'SIMPLES', 'PRESUMIDO', 'REAL');

-- CreateEnum
CREATE TYPE "Plano" AS ENUM ('BALCAO', 'BALCAO_AGENTE', 'REDE', 'CORPORATIVO');

-- CreateEnum
CREATE TYPE "Situacao" AS ENUM ('TESTE', 'ATIVA', 'INADIMPLENTE', 'SUSPENSA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "Papel" AS ENUM ('DONO', 'GERENTE', 'BALCAO', 'FINANCEIRO', 'CONTADOR', 'SUPORTE');

-- CreateEnum
CREATE TYPE "Autor" AS ENUM ('PESSOA', 'AGENTE', 'SISTEMA');

-- CreateEnum
CREATE TYPE "Medida" AS ENUM ('UN', 'KG', 'G', 'L', 'ML', 'M', 'PAR', 'CX');

-- CreateEnum
CREATE TYPE "TipoMovimento" AS ENUM ('ENTRADA', 'VENDA', 'DEVOLUCAO', 'AJUSTE', 'PERDA', 'TRANSFERENCIA', 'BALANCO');

-- CreateTable
CREATE TABLE "orgs" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "documento" TEXT,
    "ramo" TEXT,
    "razao_social" TEXT,
    "inscricao_estadual" TEXT,
    "regime" "Regime",
    "email" TEXT,
    "telefone" TEXT,
    "whatsapp" TEXT,
    "agente_nome" TEXT,
    "configurada_em" TIMESTAMP(3),
    "plano" "Plano" NOT NULL DEFAULT 'BALCAO',
    "situacao" "Situacao" NOT NULL DEFAULT 'TESTE',
    "modulos" TEXT[] DEFAULT ARRAY[]::TEXT[],
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
    "numero" TEXT,
    "complemento" TEXT,
    "bairro" TEXT,
    "cidade" TEXT,
    "estado" TEXT,
    "cep" TEXT,
    "telefone" TEXT,
    "horario" TEXT,
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

-- CreateTable
CREATE TABLE "categorias" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "pai_id" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eixos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "eh_cor" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "eixos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opcoes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "eixo_id" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "hex" TEXT,

    CONSTRAINT "opcoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produtos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "marca" TEXT,
    "categoria_id" TEXT,
    "medida" "Medida" NOT NULL DEFAULT 'UN',
    "preco_vista" DECIMAL(12,2),
    "preco_cartao" DECIMAL(12,2),
    "preco_crediario" DECIMAL(12,2),
    "custo" DECIMAL(12,2),
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "produtos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "produto_eixos" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "eixo_id" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "produto_eixos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variacoes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "produto_id" TEXT NOT NULL,
    "codigo" TEXT,
    "codigo_barras" TEXT,
    "ajuste_preco" DECIMAL(12,2),
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "variacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "variacao_opcoes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "variacao_id" TEXT NOT NULL,
    "opcao_id" TEXT NOT NULL,

    CONSTRAINT "variacao_opcoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estoque" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "variacao_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "minimo" DECIMAL(14,3),
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estoque_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "movimentos_estoque" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "variacao_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "tipo" "TipoMovimento" NOT NULL,
    "quantidade" DECIMAL(14,3) NOT NULL,
    "saldo_depois" DECIMAL(14,3) NOT NULL,
    "motivo" TEXT,
    "referencia" TEXT,
    "usuario_id" TEXT,
    "quem" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "movimentos_estoque_pkey" PRIMARY KEY ("id")
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

-- CreateIndex
CREATE INDEX "categorias_org_id_idx" ON "categorias"("org_id");

-- CreateIndex
CREATE INDEX "eixos_org_id_idx" ON "eixos"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "eixos_org_id_nome_key" ON "eixos"("org_id", "nome");

-- CreateIndex
CREATE INDEX "opcoes_org_id_idx" ON "opcoes"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "opcoes_eixo_id_valor_key" ON "opcoes"("eixo_id", "valor");

-- CreateIndex
CREATE INDEX "produtos_org_id_ativo_idx" ON "produtos"("org_id", "ativo");

-- CreateIndex
CREATE INDEX "produtos_org_id_categoria_id_idx" ON "produtos"("org_id", "categoria_id");

-- CreateIndex
CREATE INDEX "produto_eixos_org_id_idx" ON "produto_eixos"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "produto_eixos_produto_id_eixo_id_key" ON "produto_eixos"("produto_id", "eixo_id");

-- CreateIndex
CREATE INDEX "variacoes_org_id_produto_id_idx" ON "variacoes"("org_id", "produto_id");

-- CreateIndex
CREATE UNIQUE INDEX "variacoes_org_id_codigo_key" ON "variacoes"("org_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "variacoes_org_id_codigo_barras_key" ON "variacoes"("org_id", "codigo_barras");

-- CreateIndex
CREATE INDEX "variacao_opcoes_org_id_idx" ON "variacao_opcoes"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "variacao_opcoes_variacao_id_opcao_id_key" ON "variacao_opcoes"("variacao_id", "opcao_id");

-- CreateIndex
CREATE INDEX "estoque_org_id_unidade_id_idx" ON "estoque"("org_id", "unidade_id");

-- CreateIndex
CREATE UNIQUE INDEX "estoque_variacao_id_unidade_id_key" ON "estoque"("variacao_id", "unidade_id");

-- CreateIndex
CREATE INDEX "movimentos_estoque_org_id_variacao_id_criado_em_idx" ON "movimentos_estoque"("org_id", "variacao_id", "criado_em");

-- CreateIndex
CREATE INDEX "movimentos_estoque_org_id_unidade_id_criado_em_idx" ON "movimentos_estoque"("org_id", "unidade_id", "criado_em");

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

-- AddForeignKey
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_pai_id_fkey" FOREIGN KEY ("pai_id") REFERENCES "categorias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eixos" ADD CONSTRAINT "eixos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opcoes" ADD CONSTRAINT "opcoes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opcoes" ADD CONSTRAINT "opcoes_eixo_id_fkey" FOREIGN KEY ("eixo_id") REFERENCES "eixos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "categorias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_eixos" ADD CONSTRAINT "produto_eixos_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_eixos" ADD CONSTRAINT "produto_eixos_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produto_eixos" ADD CONSTRAINT "produto_eixos_eixo_id_fkey" FOREIGN KEY ("eixo_id") REFERENCES "eixos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variacoes" ADD CONSTRAINT "variacoes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variacoes" ADD CONSTRAINT "variacoes_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variacao_opcoes" ADD CONSTRAINT "variacao_opcoes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variacao_opcoes" ADD CONSTRAINT "variacao_opcoes_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "variacao_opcoes" ADD CONSTRAINT "variacao_opcoes_opcao_id_fkey" FOREIGN KEY ("opcao_id") REFERENCES "opcoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estoque" ADD CONSTRAINT "estoque_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estoque" ADD CONSTRAINT "estoque_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estoque" ADD CONSTRAINT "estoque_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_estoque" ADD CONSTRAINT "movimentos_estoque_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_estoque" ADD CONSTRAINT "movimentos_estoque_variacao_id_fkey" FOREIGN KEY ("variacao_id") REFERENCES "variacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "movimentos_estoque" ADD CONSTRAINT "movimentos_estoque_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

