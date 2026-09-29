-- CreateEnum
CREATE TYPE "SituacaoMatricula" AS ENUM ('ATIVA', 'TRANCADA', 'CANCELADA', 'CONCLUIDA');

-- AlterTable
ALTER TABLE "orgs" ADD COLUMN     "aviso_atraso_dias" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "aviso_mensalidade_ativo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "aviso_mensalidade_dias" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "mensalidade_juros_mes" DECIMAL(5,2) NOT NULL DEFAULT 1,
ADD COLUMN     "mensalidade_multa_pct" DECIMAL(5,2) NOT NULL DEFAULT 2,
ADD COLUMN     "mensalidade_pontualidade_pct" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "responsaveis" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "aluno_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "parentesco" TEXT,
    "telefone" TEXT,
    "email" TEXT,
    "documento" TEXT,
    "avisos_whatsapp" "ConsentimentoOfertas" NOT NULL DEFAULT 'NAO_PERGUNTADO',
    "avisos_em" TIMESTAMP(3),
    "avisos_origem" TEXT,
    "avisos_por" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "responsaveis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turmas" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "curso" TEXT,
    "turno" TEXT,
    "professor_id" TEXT,
    "dias" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "hora_inicio" TEXT,
    "hora_fim" TEXT,
    "capacidade" INTEGER,
    "inicio" DATE,
    "fim" DATE,
    "mensalidade" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "dia_vencimento" INTEGER NOT NULL DEFAULT 10,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "turmas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matriculas" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "aluno_id" TEXT NOT NULL,
    "turma_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "situacao" "SituacaoMatricula" NOT NULL DEFAULT 'ATIVA',
    "inicio" DATE NOT NULL,
    "fim" DATE,
    "valor" DECIMAL(12,2) NOT NULL,
    "dia_vencimento" INTEGER NOT NULL,
    "desconto_pct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "desconto_valor" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "desconto_motivo" TEXT,
    "motivo_saida" TEXT,
    "saida_em" TIMESTAMP(3),
    "quem_id" TEXT,
    "quem" TEXT NOT NULL,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "matriculas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mensalidades" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "matricula_id" TEXT NOT NULL,
    "aluno_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "mes" TEXT NOT NULL,
    "vencimento" DATE NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "desconto" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pago" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "abono" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "juros" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "multa" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "multa_cobrada" BOOLEAN NOT NULL DEFAULT false,
    "juros_ate" DATE,
    "quitada_em" TIMESTAMP(3),
    "cancelada_em" TIMESTAMP(3),
    "motivo_cancelamento" TEXT,
    "aviso_em" TIMESTAMP(3),
    "aviso" TEXT,
    "aviso_atraso_em" TIMESTAMP(3),
    "aviso_atraso" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

CONSTRAINT "mensalidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagamentos_mensalidade" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "mensalidade_id" TEXT NOT NULL,
    "unidade_id" TEXT NOT NULL,
    "caixa_id" TEXT,
    "forma" "FormaPagamento" NOT NULL,
    "valor" DECIMAL(12,2) NOT NULL,
    "juros" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "multa" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "abono" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxa_pct" DECIMAL(5,2),
    "quem_id" TEXT,
    "quem" TEXT NOT NULL,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

CONSTRAINT "pagamentos_mensalidade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "responsaveis_aluno_id_key" ON "responsaveis"("aluno_id");

-- CreateIndex
CREATE INDEX "responsaveis_org_id_documento_idx" ON "responsaveis"("org_id", "documento");

-- CreateIndex
CREATE INDEX "turmas_org_id_unidade_id_ativa_idx" ON "turmas"("org_id", "unidade_id", "ativa");

-- CreateIndex
CREATE INDEX "matriculas_org_id_turma_id_situacao_idx" ON "matriculas"("org_id", "turma_id", "situacao");

-- CreateIndex
CREATE INDEX "matriculas_org_id_aluno_id_idx" ON "matriculas"("org_id", "aluno_id");

-- CreateIndex
CREATE INDEX "matriculas_org_id_situacao_idx" ON "matriculas"("org_id", "situacao");

-- CreateIndex
CREATE UNIQUE INDEX "matriculas_uma_viva" ON "matriculas"("turma_id", "aluno_id") WHERE (fim IS NULL);

-- CreateIndex
CREATE INDEX "mensalidades_org_id_unidade_id_vencimento_idx" ON "mensalidades"("org_id", "unidade_id", "vencimento");

-- CreateIndex
CREATE INDEX "mensalidades_org_id_aluno_id_idx" ON "mensalidades"("org_id", "aluno_id");

-- CreateIndex
CREATE INDEX "mensalidades_org_id_mes_idx" ON "mensalidades"("org_id", "mes");

-- CreateIndex
CREATE UNIQUE INDEX "mensalidades_matricula_id_mes_key" ON "mensalidades"("matricula_id", "mes");

-- CreateIndex
CREATE INDEX "pagamentos_mensalidade_org_id_mensalidade_id_idx" ON "pagamentos_mensalidade"("org_id", "mensalidade_id");

-- CreateIndex
CREATE INDEX "pagamentos_mensalidade_org_id_unidade_id_criado_em_idx" ON "pagamentos_mensalidade"("org_id", "unidade_id", "criado_em");

-- CreateIndex
CREATE INDEX "pagamentos_mensalidade_org_id_caixa_id_idx" ON "pagamentos_mensalidade"("org_id", "caixa_id");

-- AddForeignKey
ALTER TABLE "responsaveis" ADD CONSTRAINT "responsaveis_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responsaveis" ADD CONSTRAINT "responsaveis_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turmas" ADD CONSTRAINT "turmas_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turmas" ADD CONSTRAINT "turmas_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turmas" ADD CONSTRAINT "turmas_professor_id_fkey" FOREIGN KEY ("professor_id") REFERENCES "colaboradores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matriculas" ADD CONSTRAINT "matriculas_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matriculas" ADD CONSTRAINT "matriculas_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "clientes"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matriculas" ADD CONSTRAINT "matriculas_turma_id_fkey" FOREIGN KEY ("turma_id") REFERENCES "turmas"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matriculas" ADD CONSTRAINT "matriculas_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensalidades" ADD CONSTRAINT "mensalidades_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensalidades" ADD CONSTRAINT "mensalidades_matricula_id_fkey" FOREIGN KEY ("matricula_id") REFERENCES "matriculas"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensalidades" ADD CONSTRAINT "mensalidades_aluno_id_fkey" FOREIGN KEY ("aluno_id") REFERENCES "clientes"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mensalidades" ADD CONSTRAINT "mensalidades_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos_mensalidade" ADD CONSTRAINT "pagamentos_mensalidade_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos_mensalidade" ADD CONSTRAINT "pagamentos_mensalidade_mensalidade_id_fkey" FOREIGN KEY ("mensalidade_id") REFERENCES "mensalidades"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos_mensalidade" ADD CONSTRAINT "pagamentos_mensalidade_unidade_id_fkey" FOREIGN KEY ("unidade_id") REFERENCES "unidades"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagamentos_mensalidade" ADD CONSTRAINT "pagamentos_mensalidade_caixa_id_fkey" FOREIGN KEY ("caixa_id") REFERENCES "caixas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
