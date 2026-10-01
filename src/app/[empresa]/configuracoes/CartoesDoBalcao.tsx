// Os dois cartões do balcão em Configurações: as regras (vender sem estoque,
// vale por loja, crédito em quantas vezes) e as maquininhas de cada loja.
// Componente do servidor, que busca sozinho o que mostra — a página só o põe
// no lugar.

import { comoOrg } from '@/servidor/banco'
import { configDoBalcao } from '@/servidor/venda'
import { lerMaquininhas } from '@/servidor/maquininhas'
import type { Sessao } from '@/servidor/permissao'
import { Cartao } from '@/ui/base'
import { RegrasDoBalcao } from './Balcao'
import { Maquininhas } from './Maquininhas'

export async function CartoesDoBalcao({ slug, sessao }: { slug: string; sessao: Sessao }) {
  const regras = await configDoBalcao(sessao)
  // Só loja ativa: depósito não tem balcão, nem maquininha.
  const lojas = await comoOrg(sessao.orgId, (db) =>
    db.unidade.findMany({
      where: { ativa: true, ehDeposito: false },
      orderBy: { criadaEm: 'asc' },
      select: { id: true, nome: true, maquininhas: true },
    }),
  )
  return (
    <>
      <Cartao titulo="Regras do balcão">
        <RegrasDoBalcao empresa={slug} inicial={regras} variasLojas={lojas.length > 1} />
      </Cartao>
      {lojas.length > 0 && (
        <Cartao titulo="Maquininhas de cada loja">
          <Maquininhas
            empresa={slug}
            lojas={lojas.map((l) => ({ id: l.id, nome: l.nome, maquininhas: lerMaquininhas(l.maquininhas) }))}
          />
        </Cartao>
      )}
    </>
  )
}
