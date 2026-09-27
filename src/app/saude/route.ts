// O endereço que a hospedagem (e o monitor externo) chama para saber se o
// Norte está de pé.
//
//   GET /saude           → 200 enquanto o PROCESSO está vivo; o corpo diz
//                          também se o banco responde.
//   GET /saude?estrito=1 → 503 quando o banco não responde. É este que o
//                          monitor externo vigia.
//
// ── por que dois ────────────────────────────────────────────
// O Render usa /saude para duas decisões: trocar de versão no deploy (só
// manda tráfego para a instância nova quando ela responde 200) e reiniciar a
// que parou de responder. Se o banco cair e /saude virar 503, o Render
// reinicia um processo que está bom e segura o deploy de uma correção — e
// nada disso conserta banco. Então para ELE o status é do processo, e o banco
// vai no corpo. Quem precisa ser acordado quando o banco cai é uma pessoa, e
// para isso o monitor chama a versão estrita.
//
// ── o que o banco custa aqui ────────────────────────────────
// Um `select 1` pela portaria (o papel com menos poder, fora do pool das
// telas), com prazo de 2 s, e a resposta guardada por 10 s: o Render bate a
// cada poucos segundos, e cem batidas não viram cem consultas.
//
// ── o que NÃO vai ────────────────────────────────────────────
// Endereço do banco, mensagem de erro, variável de ambiente, região. Esta
// porta é pública. Vai a versão do pacote e o commit curto (o mesmo que está
// no GitHub, público para quem tem o repositório) — é o que responde "a
// correção já subiu?" sem abrir o painel.

import { NextResponse } from 'next/server'
import { pingBanco } from '@/servidor/banco'
import pacote from '../../../package.json'

const nasceu = Date.now()
const GUARDA_MS = 10_000

export const dynamic = 'force-dynamic'

const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.RENDER_GIT_COMMIT ?? process.env.NORTE_COMMIT ?? '')
  .trim()
  .slice(0, 7) || null

type Banco = { ok: boolean; ms: number; em: number }
let ultimo: Banco | null = null
let emCurso: Promise<Banco> | null = null

async function banco(): Promise<Banco> {
  if (ultimo && Date.now() - ultimo.em < GUARDA_MS) return ultimo
  // Batidas simultâneas esperam a mesma consulta.
  emCurso ??= pingBanco(2_000)
    .then((r) => (ultimo = { ok: r.ok, ms: r.ms, em: Date.now() }))
    .finally(() => {
      emCurso = null
    })
  return emCurso
}

export async function GET(request: Request) {
  const estrito = new URL(request.url).searchParams.has('estrito')
  const b = await banco()
  return NextResponse.json(
    {
      ok: estrito ? b.ok : true,
      servico: 'norte',
      versao: pacote.version,
      commit,
      noArHa: Math.round((Date.now() - nasceu) / 1000),
      banco: { ok: b.ok, ms: b.ms },
    },
    { status: estrito && !b.ok ? 503 : 200, headers: { 'Cache-Control': 'no-store' } },
  )
}
