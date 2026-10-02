import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { exigirEntrada } from '@/servidor/pagina'
import { comoOrg } from '@/servidor/banco'
import { pode, unidadesQuePodem } from '@/servidor/permissao'
import { unidadesVisiveis } from '@/servidor/unidade'
import { temChaveIA } from '@/servidor/ia'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import type { Tema } from '@/ui/TrocaTema'
import { Importar } from './Importar'

export const metadata: Metadata = { title: 'Trazer produtos de outro sistema' }

// Trazer produtos de outro sistema.
//
// A loja chega com o catálogo em algum lugar — o sistema antigo, uma
// planilha, o relatório de estoque — e sai desta tela com ele no Norte, sem
// digitar de novo. A planilha é lida no NAVEGADOR (o arquivo não sobe), a
// tela mostra o que entendeu de cada coluna para a pessoa conferir, e os
// produtos sobem em lotes, pelas mesmas regras do cadastro de um por um.
//
// Abre para quem cadastra produto. O estoque entra numa loja escolhida aqui,
// entre as que a pessoa pode ajustar; sem nenhuma, a planilha entra sem
// estoque.

export default async function TrazerProdutos({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'produto.cadastrar' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const lojas = await unidadesVisiveis(sessao, 'estoque.ajustar')
  const [categorias, produtos, org] = await Promise.all([
    comoOrg(sessao.orgId, (db) => db.categoria.findMany({ select: { nome: true } })),
    comoOrg(sessao.orgId, (db) => db.produto.count({ where: { ativo: true } })),
    comoOrg(sessao.orgId, (db) => db.org.findUnique({ where: { id: sessao.orgId }, select: { pinNasExcecoes: true } })),
  ])

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/produtos`}
      tema={tema}
      titulo="Trazer produtos de outro sistema"
      acao={
        <Link
          href={`/${slug}/produtos`}
          className="rounded-norte border border-borda bg-superficie px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
        >
          Voltar à lista
        </Link>
      }
    >
      <Importar
        slug={slug}
        lojas={lojas.map((u) => ({ id: u.id, nome: u.nome, deposito: u.ehDeposito }))}
        categorias={categorias.map((c) => c.nome)}
        jaTemProdutos={produtos > 0}
        temIA={temChaveIA()}
        podePreco={pode(sessao, 'produto.preco')}
        // Quem cadastra só para as próprias lojas vê a frase certa na prévia.
        empresaInteira={unidadesQuePodem(sessao, 'produto.cadastrar') === 'todas'}
        pedePin={org?.pinNasExcecoes === true}
      />
    </Estrutura>
  )
}
