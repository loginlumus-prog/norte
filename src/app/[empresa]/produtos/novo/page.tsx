import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { eixosDaEmpresa } from '@/servidor/produto'
import { comoOrg } from '@/servidor/banco'
import { RAMOS, type Ramo } from '@/servidor/modulos'
import { pode } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Secao } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'
import { Editor } from '../Editor'
import { lojasSugeridas } from '@/servidor/catalogo-loja'

export default async function NovoProduto({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'produto.editar' })
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

  // As lojas que têm balcão — para a pergunta "Vendido em". Depósito não
  // vende, então não entra.
  const [lojasCruas, org] = await comoOrg(sessao.orgId, async (db) => [
    await db.unidade.findMany({
      where: { ativa: true, ehDeposito: false },
      orderBy: { nome: 'asc' },
      select: { id: true, nome: true, ramo: true },
    }),
    await db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { ramo: true } }),
  ] as const)
  const lojasQueVendem = lojasCruas.map((u) => ({
    ...u,
    ramo: u.ramo && u.ramo in RAMOS ? RAMOS[u.ramo as Ramo].titulo : null,
  }))

  // Cada categoria que é de um ramo sugere as lojas daquele ramo: o picolé
  // novo nasce marcado só na sorveteria. Só no cadastro — na edição vale o
  // que já foi escolhido.
  const catRamo = Object.fromEntries(Object.entries(RAMOS).map(([r, p]) => [r, p.categorias]))
  const sugestao: Record<string, string[]> = Object.fromEntries(
    categorias.map((c) => [c.id, lojasSugeridas(c.nome, lojasCruas, org.ramo, catRamo)]),
  )

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
        <Editor
          slug={slug}
          eixos={eixos}
          categorias={categorias}
          lojas={lojasQueVendem}
          sugestao={sugestao}
        />
      </Secao>
    </Estrutura>
  )
}
