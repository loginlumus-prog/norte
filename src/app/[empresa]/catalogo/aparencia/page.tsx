import type { Metadata } from 'next'
import Link from 'next/link'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { pode } from '@/servidor/permissao'
import { comoOrg } from '@/servidor/banco'
import { aVendaNaLoja } from '@/servidor/catalogo-loja'
import { aparenciaDaLoja } from '@/servidor/vitrine'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Aviso } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'
import { Aparencia } from './Aparencia'

export const metadata: Metadata = { title: 'Aparência do catálogo' }

// A APARÊNCIA DO CATÁLOGO de uma loja: o tema, a logo, os temas de data, as
// postagens (mural e stories) e as avaliações de quem pediu. É de quem
// responde pela empresa, como os outros ajustes do catálogo.

export default async function TelaAparencia({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ loja?: string | string[] }>
}) {
  const { empresa: slug } = await params
  const pedida = (await searchParams).loja
  const { empresa, sessao } = await exigirEntrada(slug)
  if (!pode(sessao, 'empresa.configurar')) semAcesso(slug, 'cargo')
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const lojas = await comoOrg(sessao.orgId, (db) =>
    db.catalogoLoja.findMany({
      where: { unidade: { ativa: true, ehDeposito: false, ehFabrica: false } },
      orderBy: { unidade: { nome: 'asc' } },
      select: { unidadeId: true, endereco: true, ativo: true, unidade: { select: { nome: true, apelido: true } } },
    }),
  )
  const escolhida = lojas.find((l) => l.unidadeId === pedida) ?? lojas.find((l) => l.ativo) ?? lojas[0]
  const dados = escolhida ? await aparenciaDaLoja(sessao, escolhida.unidadeId) : null
  const produtos = escolhida
    ? await comoOrg(sessao.orgId, (db) =>
        db.produto.findMany({
          where: { ativo: true, ...aVendaNaLoja(escolhida.unidadeId) },
          orderBy: { nome: 'asc' },
          take: 600,
          select: { id: true, nome: true },
        }),
      )
    : []

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/catalogo`}
      tema={tema}
      titulo="Aparência do catálogo"
      acao={
        <Link href={`/${slug}/catalogo`} className="text-sm font-medium text-tinta-2 hover:text-tinta">
          ← catálogo
        </Link>
      }
    >
      {!escolhida || !dados ? (
        <Aviso nivel="neutro">Abra o catálogo de uma loja primeiro (em Catálogo) — a aparência é de cada catálogo.</Aviso>
      ) : (
        <Aparencia
          key={escolhida.unidadeId}
          slug={slug}
          empresaNome={empresa.nome}
          lojas={lojas.map((l) => ({ id: l.unidadeId, nome: l.unidade.apelido || l.unidade.nome, ativo: l.ativo }))}
          loja={{ id: escolhida.unidadeId, endereco: escolhida.endereco, ativo: escolhida.ativo }}
          dados={dados}
          produtos={produtos}
        />
      )}
    </Estrutura>
  )
}
