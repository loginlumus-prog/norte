import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { carimbar } from '@/servidor/autocadastro'
import { lerVitrinePublica, produtosDoCatalogo } from '@/servidor/catalogo'
import { Loja } from './Loja'

// O CATÁLOGO DA LOJA, como a cliente vê. Pública: o link vai no WhatsApp, no
// Instagram, no cartaz do balcão. Ver src/servidor/catalogo.ts para o que
// sai daqui (só o que um cartaz mostraria) e o que entra (o pedido, conferido).

type Params = { params: Promise<{ empresa: string; endereco: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { empresa, endereco } = await params
  const v = await lerVitrinePublica(empresa, endereco)
  if (!v) return { title: { absolute: 'Catálogo' }, robots: { index: false, follow: false } }
  const titulo = v.loja.nome && v.loja.nome !== v.empresa.nome ? `${v.empresa.nome} — ${v.loja.nome}` : v.empresa.nome
  const descricao = v.loja.recado || `Veja o que tem na loja e faça o seu pedido${v.loja.entrega ? ' para entrega ou retirada' : ''}.`
  return {
    // Sem o "· Norte" do modelo: é a vitrine DA LOJA.
    title: { absolute: `${titulo} · Catálogo` },
    description: descricao,
    robots: { index: false, follow: false },
    // A prévia do link no WhatsApp.
    openGraph: {
      title: titulo,
      description: descricao,
      type: 'website',
      ...(v.empresa.logoUrl ? { images: [{ url: v.empresa.logoUrl }] } : {}),
    },
  }
}

export default async function CatalogoPublico({ params }: Params) {
  const { empresa, endereco } = await params
  const vitrine = await lerVitrinePublica(empresa, endereco)
  if (!vitrine) notFound()
  const primeira = await produtosDoCatalogo(empresa, endereco, {})
  return <Loja vitrine={vitrine} primeira={primeira ?? { produtos: [], mais: false, proximo: 0 }} carimbo={carimbar()} />
}
