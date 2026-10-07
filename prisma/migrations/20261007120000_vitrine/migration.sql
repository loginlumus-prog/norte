-- A vitrine nova do catálogo: o tema (pronto, cor à mão e o de data), as
-- postagens (mural e stories) e as avaliações de quem pediu. O isolamento vem
-- do rls.sql (as duas tabelas têm org_id e entram na varredura).

-- AlterTable
ALTER TABLE "catalogos" ADD COLUMN     "capa_id" TEXT,
ADD COLUMN     "cor_tema" TEXT,
ADD COLUMN     "especial" TEXT,
ADD COLUMN     "especial_ate" TIMESTAMP(3),
ADD COLUMN     "tema" TEXT;

-- CreateTable
CREATE TABLE "postagens_catalogo" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "catalogo_id" TEXT NOT NULL,
    "midia_id" TEXT,
    "titulo" TEXT NOT NULL,
    "texto" TEXT,
    "produto_id" TEXT,
    "stories_ate" TIMESTAMP(3),
    "nos_stories" BOOLEAN NOT NULL DEFAULT true,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "quem" TEXT NOT NULL,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "postagens_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "destaques_catalogo" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "catalogo_id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "midia_id" TEXT,
    "categoria_id" TEXT,
    "produto_ids" TEXT[],
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "destaques_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "avaliacoes_catalogo" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "catalogo_id" TEXT NOT NULL,
    "encomenda_id" TEXT NOT NULL,
    "nota" INTEGER NOT NULL,
    "texto" TEXT,
    "nome" TEXT NOT NULL,
    "resposta" TEXT,
    "oculta" BOOLEAN NOT NULL DEFAULT false,
    "oculta_por" TEXT,
    "oculta_motivo" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avaliacoes_catalogo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "postagens_catalogo_org_id_catalogo_id_criada_em_idx" ON "postagens_catalogo"("org_id", "catalogo_id", "criada_em");

-- CreateIndex
CREATE INDEX "destaques_catalogo_org_id_catalogo_id_ordem_idx" ON "destaques_catalogo"("org_id", "catalogo_id", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "avaliacoes_catalogo_encomenda_id_key" ON "avaliacoes_catalogo"("encomenda_id");

-- CreateIndex
CREATE INDEX "avaliacoes_catalogo_org_id_catalogo_id_criada_em_idx" ON "avaliacoes_catalogo"("org_id", "catalogo_id", "criada_em");

-- AddForeignKey
ALTER TABLE "catalogos" ADD CONSTRAINT "catalogos_capa_id_fkey" FOREIGN KEY ("capa_id") REFERENCES "midias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postagens_catalogo" ADD CONSTRAINT "postagens_catalogo_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postagens_catalogo" ADD CONSTRAINT "postagens_catalogo_catalogo_id_fkey" FOREIGN KEY ("catalogo_id") REFERENCES "catalogos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postagens_catalogo" ADD CONSTRAINT "postagens_catalogo_midia_id_fkey" FOREIGN KEY ("midia_id") REFERENCES "midias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "postagens_catalogo" ADD CONSTRAINT "postagens_catalogo_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "destaques_catalogo" ADD CONSTRAINT "destaques_catalogo_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "destaques_catalogo" ADD CONSTRAINT "destaques_catalogo_catalogo_id_fkey" FOREIGN KEY ("catalogo_id") REFERENCES "catalogos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "destaques_catalogo" ADD CONSTRAINT "destaques_catalogo_midia_id_fkey" FOREIGN KEY ("midia_id") REFERENCES "midias"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacoes_catalogo" ADD CONSTRAINT "avaliacoes_catalogo_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "orgs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacoes_catalogo" ADD CONSTRAINT "avaliacoes_catalogo_catalogo_id_fkey" FOREIGN KEY ("catalogo_id") REFERENCES "catalogos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avaliacoes_catalogo" ADD CONSTRAINT "avaliacoes_catalogo_encomenda_id_fkey" FOREIGN KEY ("encomenda_id") REFERENCES "encomendas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
