import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { pode } from '@/servidor/permissao'
import { listarCatalogos } from '@/servidor/catalogo'
import { enderecoPublico } from '@/servidor/requisicao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import type { Tema } from '@/ui/TrocaTema'
import { Catalogos } from './Catalogos'

export const metadata: Metadata = { title: 'Catálogo' }

// O CATÁLOGO DE CADA LOJA: o link que a loja manda para a cliente ver o que
// tem e pedir. Aqui se abre, se ajusta (entrega, taxa, Pix) e se copia o
// link. O pedido que chega vira encomenda — ver Encomendas.

export default async function TelaCatalogo({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'venda.ver' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema
  const { lojas, encomendaLigada } = await listarCatalogos(sessao)
  let base = await enderecoPublico()
  if (!base) {
    const h = await headers()
    base = `https://${h.get('x-forwarded-host') ?? h.get('host') ?? ''}`
  }

  return (
    <Estrutura empresa={empresa} sessao={sessao} itens={MENU(slug)} ativo={`/${slug}/catalogo`} tema={tema} titulo="Catálogo">
      <Catalogos
        slug={slug}
        base={base}
        lojas={lojas}
        encomendaLigada={encomendaLigada}
        podeMudar={pode(sessao, 'empresa.configurar')}
        podeFoto={pode(sessao, 'produto.editar')}
        empresaNome={empresa.nome}
      />
    </Estrutura>
  )
}
