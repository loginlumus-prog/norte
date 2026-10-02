-- O acesso de SUPORTE (nosso) ganha um modo, escolhido ao conceder: só
-- leitura (false, o de sempre) ou edição (true). Ver SUPORTE_EDICAO em
-- src/servidor/permissao.ts. Os acessos que já existem ficam só leitura.
ALTER TABLE "acessos" ADD COLUMN "suporte_edita" BOOLEAN NOT NULL DEFAULT false;
