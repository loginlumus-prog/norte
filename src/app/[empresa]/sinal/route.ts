// "Ainda estou aqui", mandado pela tela enquanto alguém mexe nela.
//
// A tela (ui/Tranca.tsx) chama isto no máximo uma vez por minuto, e só
// quando houve toque de verdade: tecla, clique, rolagem. Serve a duas coisas:
//
//   • o cookie do último toque (`marcarToque`): é por ele que a tela trancada
//     continua trancada depois do F5 ou numa aba nova;
//   • a presença (`ultimoSinal`): quem passa meia hora num relatório sem
//     trocar de tela estava DENTRO, e a vaga dele não deve parecer parada.
//     Quem grava é o próprio `conferirSessao`, como em toda tela.
//
// Rota, e não Server Action: ação que grava cookie faz o Next redesenhar a
// tela aberta (ver cookies.md) — um redesenho por minuto no meio da venda.
//
// Não recusa nada nem tranca nada: a tranca continua sendo da tela. O que
// isto muda é só o que a tela sabe ao abrir.

import { conferirSessao } from '@/servidor/pagina'
import { marcarToque } from '@/servidor/sessao'

export async function POST(_req: Request, { params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const { sessao } = await conferirSessao(slug)
  if (!sessao) return new Response(null, { status: 401 })
  await marcarToque(slug)
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } })
}
