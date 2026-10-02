import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { eixosDaEmpresa } from '@/servidor/produto'
import { comoOrg } from '@/servidor/banco'
import { RAMOS, marcasDaGaveta, type Ramo } from '@/servidor/modulos'
import { pode, soPelaEmpresa, unidadesQuePodem } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Secao } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'
import { Editor } from '../Editor'
import { alcancaLoja, lojasSugeridas } from '@/servidor/catalogo-loja'
import { vocabularioDaEmpresa, vocabularioDoEndereco } from '@/servidor/vocabulario'

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ servico?: string }>
}): Promise<Metadata> {
  if ((await searchParams).servico === '1') return { title: 'Novo serviço' }
  return { title: (await vocabularioDoEndereco((await params).empresa)).novoProduto }
}

export default async function NovoProduto({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ servico?: string }>
}) {
  const { empresa: slug } = await params
  // "Cadastrar serviço", no painel da clínica, chega aqui com ?servico=1: a
  // ficha já abre marcada como serviço. É só o padrão do campo — quem
  // desmarca cadastra material, como sempre.
  const servico = (await searchParams).servico === '1'
  // Cadastrar é capacidade própria: a vendedora a tem quando a empresa deixa
  // (EXTRAS_DO_BALCAO), sem poder editar o resto do catálogo.
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'produto.cadastrar' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  // A tela nem abre para quem não pode. O botão que leva até aqui já está
  // escondido, mas endereço colado no navegador não passa pelo botão.
  //
  // Nem `notFound()` nem `forbidden()` (experimental no Next): a tela "Sem
  // acesso" diz o motivo de verdade, dentro do sistema (ver sem-acesso.ts).
  if (!pode(sessao, 'produto.cadastrar')) semAcesso(slug, 'cargo')

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
  // O gerente cadastra para as lojas DELE: as outras aparecem travadas, e o
  // produto dele nunca nasce "em todas" (ver `vendidoEmDoGerente`).
  const alcance = unidadesQuePodem(sessao, 'produto.cadastrar')
  const lojasQueVendem = lojasCruas.map((u) => ({
    ...u,
    ramo: u.ramo && u.ramo in RAMOS ? RAMOS[u.ramo as Ramo].titulo : null,
    podeMarcar: alcancaLoja(alcance, u.id),
  }))

  // Cada categoria que é de um ramo sugere as lojas daquele ramo: o picolé
  // novo nasce marcado só na sorveteria. Só no cadastro — na edição vale o
  // que já foi escolhido.
  const catRamo = Object.fromEntries(Object.entries(RAMOS).map(([r, p]) => [r, p.categorias]))
  const sugestao: Record<string, string[]> = Object.fromEntries(
    categorias.map((c) => [c.id, lojasSugeridas(c.nome, lojasCruas, org.ramo, catRamo)]),
  )
  // A gaveta de material do ramo já traz "material de uso" marcado (a
  // acetona no salão); a do pão, "feito no dia" (a padaria). É o padrão da
  // ficha — a regra é o que for salvo no produto.
  const ramos = [org.ramo, ...lojasCruas.map((u) => u.ramo)]
  const marcas = Object.fromEntries(categorias.map((c) => [c.id, marcasDaGaveta(ramos, c.nome)]))

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/produtos`}
      tema={tema}
      titulo={servico ? 'Novo serviço' : (await vocabularioDaEmpresa(sessao.orgId)).novoProduto}
    >
      <Secao titulo="Cadastro">
        <Editor
          slug={slug}
          eixos={eixos}
          categorias={categorias}
          lojas={lojasQueVendem}
          sugestao={sugestao}
          marcas={marcas}
          servicoPadrao={servico}
          pedePin={soPelaEmpresa(sessao, 'produto.cadastrar')}
        />
      </Secao>
    </Estrutura>
  )
}
