// De qual arquivo vêm as credenciais desta execução.
//
// ── por que não basta o .env ─────────────────────────────────
// A tentação é pôr a URL do banco hospedado no mesmo `.env` do dia a dia. Foi
// o que aconteceu aqui, e deu o resultado errado de um jeito difícil de ver:
// a chave ficou repetida no arquivo, o dotenv usou a ÚLTIMA, e a aplicação
// passou a rodar metade no banco local e metade no hospedado — o login
// procurando a empresa num banco vazio enquanto o resto lia o outro. Nada
// quebra alto; só para de achar a empresa.
//
// E tem o problema maior: com produção no `.env`, todo `npm run dev` carrega a
// senha do DONO das tabelas de produção no ambiente. Basta um script
// distraído para escrever no lugar errado.
//
// ── a regra ──────────────────────────────────────────────────
// `.env` é o laptop, sempre. Produção mora em `.env.producao`, e só é lida
// quando alguém pede na mão:
//
//   npm run preparar -- --producao
//   npm run conferir -- --producao
//
// Ler produção passa a ser um ato explícito, visível na linha de comando e no
// histórico — que é como tem que ser.

import { config } from 'dotenv'
import { existsSync } from 'node:fs'

/** Carrega o arquivo certo e devolve para onde esta execução está apontando. */
export function carregarAmbiente(): { producao: boolean; arquivo: string } {
  const producao = process.argv.includes('--producao')
  const arquivo = producao ? '.env.producao' : '.env'

  if (producao && !existsSync(arquivo)) {
    console.error(
      `\n  Falta o ${arquivo}.\n\n` +
        `  Ele guarda as credenciais do banco hospedado e NÃO vai para o git.\n` +
        `  Formato:\n\n` +
        `    DATABASE_URL_ADMIN="postgresql://postgres:SENHA@db.SEU-PROJETO.supabase.co:5432/postgres"\n` +
        `    SENHA_APP="uma-senha-forte-e-diferente"\n`,
    )
    process.exit(1)
  }

  config({ path: arquivo })
  return { producao, arquivo }
}
