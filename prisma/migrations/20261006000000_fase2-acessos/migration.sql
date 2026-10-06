-- Tarefa que repete todo dia (abrir e fechar a loja)
ALTER TABLE "tarefas" ADD COLUMN "diaria" BOOLEAN NOT NULL DEFAULT false;

-- O quadro de abertura e fechamento que já existe passa a ser diário, como o modelo novo
UPDATE "tarefas" SET "diaria" = true
 WHERE "quadro_id" IN (SELECT "id" FROM "quadros" WHERE "nome" LIKE 'Abertura e fechamento d%');

-- Capacidades novas (venda.historico, caixa.historico, fabrica.ver, fabrica.pedir):
-- os cargos que a empresa já criou continuam podendo o que podiam antes.
UPDATE "cargos" SET "capacidades" = array_append("capacidades", 'venda.historico')
 WHERE 'venda.ver' = ANY("capacidades") AND NOT ('venda.historico' = ANY("capacidades"));
UPDATE "cargos" SET "capacidades" = array_append("capacidades", 'caixa.historico')
 WHERE 'caixa.ver' = ANY("capacidades") AND NOT ('caixa.historico' = ANY("capacidades"));
UPDATE "cargos" SET "capacidades" = array_append("capacidades", 'fabrica.ver')
 WHERE 'estoque.ver' = ANY("capacidades") AND NOT ('fabrica.ver' = ANY("capacidades"));
UPDATE "cargos" SET "capacidades" = array_append("capacidades", 'fabrica.pedir')
 WHERE 'estoque.ajustar' = ANY("capacidades") AND NOT ('fabrica.pedir' = ANY("capacidades"));
