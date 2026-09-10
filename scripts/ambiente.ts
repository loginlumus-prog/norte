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

/**
 * O banco desta URL é o do laptop?
 *
 * Definição única de propósito: dois scripts decidem coisa diferente com esta
 * mesma resposta (um pula o exemplo, o outro se recusa a rodar), e duas cópias
 * da regra divergiriam no dia em que alguém acrescentasse um host.
 *
 * Casa com o `@` que separa a senha do host, e não com a senha — senha com `@`
 * dentro existe, e um teste ingênuo diria "local" para um banco remoto.
 */
export function ehLocal(url: string | undefined): boolean {
  return !!url && /@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(url)
}

/**
 * Impede que um script destrutivo rode em banco que não é o do laptop.
 *
 * A conferência APAGA e recria as duas empresas de exemplo a cada execução —
 * ela é bancada de teste, não diagnóstico. A trava que já existia dentro dela
 * só dispara quando encontra empresa de verdade, e por isso não protege o pior
 * caso: banco de produção ainda VAZIO, esperando o primeiro cliente. Ali ela
 * passaria direto e deixaria ana@exemplo.com com senha conhecida no ar.
 */
export function exigirBancoLocal(o: { script: string }): void {
  const url = process.env.DATABASE_URL_ADMIN
  if (ehLocal(url)) return

  let onde = 'um banco remoto'
  try {
    onde = new URL(url!).host
  } catch {}

  console.error(
    `\n  RECUSADO: ${o.script} apaga e recria as empresas de exemplo,\n` +
      `  e este banco não é o do laptop — é ${onde}.\n\n` +
      `  Rode sem --producao, contra o banco local.\n`,
  )
  process.exit(1)
}
