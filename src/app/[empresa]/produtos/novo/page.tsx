import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { eixosDaEmpresa } from '@/servidor/produto'
import { comoOrg } from '@/servidor/banco'
import { pode } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Secao } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'
import { Editor } from '../Editor'

export default async function NovoProduto({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  // A tela nem abre para quem não pode. O botão que leva até aqui já está
  // escondido, mas endereço colado no navegador não passa pelo botão.
  //
  // `notFound()` e não `forbidden()`: o segundo é experimental no Next e
  // exige ligar uma bandeira. E a nossa tela de "este endereço não abre" já
  // diz as duas possibilidades sem escolher — o que também evita confirmar,
  // para quem não deveria saber, que a tela existe.
  if (!pode(sessao, 'produto.editar')) notFound()

  const [eixos, categorias] = await Promise.all([
    eixosDaEmpresa(sessao),
    comoOrg(sessao.orgId, (db) =>
      db.categoria.findMany({ orderBy: { ordem: 'asc' }, select: { id: true, nome: true } }),
    ),
  ])

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/produtos`}
      tema={tema}
      titulo="Novo produto"
    >
      <Secao titulo="Cadastro">
        <Editor slug={slug} eixos={eixos} categorias={categorias} />
      </Secao>
    </Estrutura>
  )
}
