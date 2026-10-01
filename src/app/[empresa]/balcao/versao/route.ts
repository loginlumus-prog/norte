// GET /<empresa>/balcao/versao → { versao } — a versão que este servidor roda
// (ver ../versaoDoBuild.ts). O balcão pergunta de tempos em tempos e, se
// mudou, oferece recarregar (AvisoVersao.tsx).
//
// Não diz nada da empresa nem de ninguém: é o mesmo identificador que vai nos
// endereços dos arquivos da página. Sem cache, para a resposta ser a de agora.

import { versaoDoBuild } from '../versaoDoBuild'

export const dynamic = 'force-dynamic'

export async function GET() {
  return Response.json({ versao: versaoDoBuild() }, { headers: { 'Cache-Control': 'no-store' } })
}
