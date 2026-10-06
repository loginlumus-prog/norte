-- O programa de parceiros: quem indica o Norte, as empresas indicadas, a
-- mensalidade paga (de onde a comissão nasce), as comissões e os repasses.
-- O isolamento (RLS e as funções de cadastro e login) vem do rls.sql, no preparar.

ALTER TABLE "orgs" ADD COLUMN "parceiro_id" TEXT;

-- CreateTable
CREATE TABLE "parceiros" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "telefone" TEXT,
    "codigo" TEXT NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'ATIVO',
    "patrocinador_id" TEXT,
    "pix_tipo" TEXT,
    "pix_chave" TEXT,
    "documento" TEXT,
    "termos" TEXT NOT NULL,
    "sessoes_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "troca_resumo" TEXT,
    "troca_ate" TIMESTAMP(3),
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parceiros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parceiros_tentativas" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "email_resumo" TEXT,
    "ip_resumo" TEXT,
    "ok" BOOLEAN NOT NULL DEFAULT false,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parceiros_tentativas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "indicacoes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "parceiro_id" TEXT NOT NULL,
    "empresa_nome" TEXT NOT NULL,
    "primeiro_pagamento_em" TIMESTAMP(3),
    "ultimo_pagamento_em" TIMESTAMP(3),
    "desconto_usado_em" TIMESTAMP(3),
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "indicacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagamentos_norte" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "referencia" TEXT NOT NULL,
    "valor_cheio" DECIMAL(10,2) NOT NULL,
    "desconto" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "valor_pago" DECIMAL(10,2) NOT NULL,
    "forma" TEXT NOT NULL,
    "pago_em" TIMESTAMP(3) NOT NULL,
    "quem" TEXT NOT NULL,
    "observacao" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pagamentos_norte_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comissoes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "pagamento_id" TEXT NOT NULL,
    "parceiro_id" TEXT NOT NULL,
    "nivel" INTEGER NOT NULL,
    "percentual" DECIMAL(5,2) NOT NULL,
    "base" DECIMAL(10,2) NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "referencia" TEXT NOT NULL,
    "empresa_nome" TEXT NOT NULL,
    "libera_em" TIMESTAMP(3) NOT NULL,
    "estornada_em" TIMESTAMP(3),
    "repasse_id" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comissoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repasses" (
    "id" TEXT NOT NULL,
    "parceiro_id" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "pix_chave" TEXT NOT NULL,
    "comprovante" TEXT,
    "quem" TEXT NOT NULL,
    "pago_em" TIMESTAMP(3) NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repasses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "parceiros_email_key" ON "parceiros"("email");

-- CreateIndex
CREATE UNIQUE INDEX "parceiros_codigo_key" ON "parceiros"("codigo");

-- CreateIndex
CREATE INDEX "parceiros_patrocinador_id_idx" ON "parceiros"("patrocinador_id");

-- CreateIndex
CREATE INDEX "parceiros_tentativas_email_resumo_criado_em_idx" ON "parceiros_tentativas"("email_resumo", "criado_em");

-- CreateIndex
CREATE INDEX "parceiros_tentativas_ip_resumo_criado_em_idx" ON "parceiros_tentativas"("ip_resumo", "criado_em");

-- CreateIndex
CREATE UNIQUE INDEX "indicacoes_org_id_key" ON "indicacoes"("org_id");

-- CreateIndex
CREATE INDEX "indicacoes_parceiro_id_idx" ON "indicacoes"("parceiro_id");

-- CreateIndex
CREATE INDEX "pagamentos_norte_org_id_idx" ON "pagamentos_norte"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "pagamentos_norte_org_id_referencia_key" ON "pagamentos_norte"("org_id", "referencia");

-- CreateIndex
CREATE INDEX "comissoes_org_id_idx" ON "comissoes"("org_id");

-- CreateIndex
CREATE INDEX "comissoes_parceiro_id_idx" ON "comissoes"("parceiro_id");

-- CreateIndex
CREATE UNIQUE INDEX "comissoes_pagamento_id_nivel_key" ON "comissoes"("pagamento_id", "nivel");

-- CreateIndex
CREATE INDEX "repasses_parceiro_id_idx" ON "repasses"("parceiro_id");

-- AddForeignKey
ALTER TABLE "parceiros" ADD CONSTRAINT "parceiros_patrocinador_id_fkey" FOREIGN KEY ("patrocinador_id") REFERENCES "parceiros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicacoes" ADD CONSTRAINT "indicacoes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "indicacoes" ADD CONSTRAINT "indicacoes_parceiro_id_fkey" FOREIGN KEY ("parceiro_id") REFERENCES "parceiros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos_norte" ADD CONSTRAINT "pagamentos_norte_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_pagamento_id_fkey" FOREIGN KEY ("pagamento_id") REFERENCES "pagamentos_norte"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_parceiro_id_fkey" FOREIGN KEY ("parceiro_id") REFERENCES "parceiros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comissoes" ADD CONSTRAINT "comissoes_repasse_id_fkey" FOREIGN KEY ("repasse_id") REFERENCES "repasses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repasses" ADD CONSTRAINT "repasses_parceiro_id_fkey" FOREIGN KEY ("parceiro_id") REFERENCES "parceiros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

