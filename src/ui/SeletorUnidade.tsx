'use client'

// Qual loja estou olhando — no cabeçalho de cada tela.
//
// É a cápsula com o azulejo da loja; tocar abre a troca de loja inteira
// (TrocaDeLoja), a mesma do cartão da barra lateral. As opções são as DESTA
// tela: quem vê o estoque de três lojas e as vendas de uma recebe, em cada
// tela, só as lojas que ela alcança.
//
// A escolha vai para o ENDEREÇO quando vem de um link (o gerente manda o link
// para o dono e os dois veem a mesma tela) e fica LEMBRADA
// (unidade-lembrada.ts): o menu e os links de cada tela não levam a loja, e
// sem a lembrança cada clique voltava para "Todas as unidades".

import { useEffect } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import type { UnidadeVisivel } from '@/servidor/unidade'
import { UNIDADE_LEMBRADA_SEG, cookieDaUnidade } from '@/servidor/unidade-lembrada'
import { TrocaDeLoja } from './TrocaDeLoja'

export function SeletorUnidade({
  opcoes,
  atual,
}: {
  opcoes: UnidadeVisivel[]
  /** null = consolidado */
  atual: string | null
}) {
  const caminho = usePathname()
  const busca = useSearchParams()
  const slug = caminho.split('/')[1] ?? ''

  // Chegou por um link que já trazia a loja (o painel manda para o Estoque
  // daquela loja; o gerente manda o endereço): ela passa a ser a lembrada,
  // e o próximo clique no menu continua nela. Só quando o endereço foi
  // obedecido — loja que esta tela não alcança não apaga a lembrança.
  const doEndereco = busca.get('unidade')
  useEffect(() => {
    if (!slug || !doEndereco || doEndereco !== atual) return
    const seguro = window.location.protocol === 'https:' ? '; secure' : ''
    document.cookie =
      `${cookieDaUnidade(slug)}=${encodeURIComponent(atual)}` +
      `; path=/${slug}; max-age=${UNIDADE_LEMBRADA_SEG}; samesite=lax${seguro}`
  }, [doEndereco, atual, slug])

  return <TrocaDeLoja slug={slug} opcoes={opcoes} atual={atual} jeito="topo" />
}
