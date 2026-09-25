// Os ícones do menu do sistema.
//
// Grade de 24, traço 1.75, pontas redondas, `currentColor`: o mesmo desenho
// serve à barra branca e à azul-noite, aberta ou recolhida. São sinais de
// NAVEGAÇÃO, não ilustração — cada um é a forma mais reconhecível do assunto
// (a sacola é vender, a caixa é estoque, a etiqueta é preço), porque no trilho
// recolhido do balcão o ícone é tudo o que a pessoa vê.
//
// A chave é o último pedaço do endereço do item (`/loja/produtos` → produtos),
// então acrescentar uma tela ao menu não obriga a mexer em dois lugares — só
// quem quiser um desenho próprio vem aqui.

import type { ReactNode } from 'react'

const D: Record<string, ReactNode> = {
  painel: (
    <>
      <rect x="3.5" y="3.5" width="7" height="8" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.5" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.5" />
      <rect x="3.5" y="14.5" width="7" height="6" rx="1.5" />
    </>
  ),
  balcao: (
    <>
      <path d="M5 8h14l-1.2 11.1a1.5 1.5 0 0 1-1.5 1.4H7.7a1.5 1.5 0 0 1-1.5-1.4L5 8Z" />
      <path d="M9 10.5V7a3 3 0 0 1 6 0v3.5" />
    </>
  ),
  vendas: (
    <>
      <path d="M6 3.5h12v17l-2.5-1.5-2 1.5-1.5-1.5-1.5 1.5-2-1.5L6 20.5v-17Z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </>
  ),
  caixa: (
    <>
      <rect x="3" y="6.5" width="18" height="12" rx="2" />
      <path d="M3 10.5h18" />
      <path d="M7 14.5h3" />
    </>
  ),
  crediario: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
      <path d="M8 14h2M12 14h2M8 17h2" />
    </>
  ),
  encomendas: (
    <>
      <path d="M12 3.5 20 7.5v9L12 20.5 4 16.5v-9L12 3.5Z" />
      <path d="M4 7.5 12 11.5l8-4M12 11.5v9" />
    </>
  ),
  produtos: (
    <>
      <path d="M3.5 12.3 11 4.8a1.5 1.5 0 0 1 1.1-.4l6.4.1a1 1 0 0 1 1 1l.1 6.4a1.5 1.5 0 0 1-.4 1.1l-7.5 7.5a1.5 1.5 0 0 1-2.1 0l-6.1-6.1a1.5 1.5 0 0 1 0-2.1Z" />
      <circle cx="15.5" cy="8.5" r="1.3" />
    </>
  ),
  estoque: (
    <>
      <rect x="3.5" y="3.5" width="17" height="6" rx="1.2" />
      <path d="M5 9.5v9.5a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5V9.5" />
      <path d="M10 13.5h4" />
    </>
  ),
  precos: (
    <>
      <path d="M12 3v18" />
      <path d="M16.5 7.5c-.6-1.5-2.3-2.5-4.5-2.5-2.5 0-4.5 1.3-4.5 3.3 0 4.7 9.3 2.6 9.3 7.4 0 2-2 3.3-4.8 3.3-2.3 0-4.1-1-4.8-2.7" />
    </>
  ),
  clientes: (
    <>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.5 20.5c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6" />
    </>
  ),
  equipe: (
    <>
      <circle cx="9" cy="8.5" r="3.3" />
      <path d="M3 20c.6-3.3 3-5.2 6-5.2s5.4 1.9 6 5.2" />
      <path d="M15.5 5.5a3.2 3.2 0 0 1 0 6.2M17.5 14.9c1.9.6 3.1 2.3 3.5 5.1" />
    </>
  ),
  tarefas: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="m7.5 12 3 3 6-6.5" />
    </>
  ),
  financeiro: (
    <>
      <path d="M4 20.5h16" />
      <path d="M6.5 16.5v-5M11 16.5v-9M15.5 16.5v-6.5M20 16.5V5" />
    </>
  ),
  analise: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="m4.5 15.5 4.5-5 4 3 6.5-8" />
      <path d="M15.5 5.5h4v4" />
    </>
  ),
  agente: (
    <>
      <path d="M4.5 5.5h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5V17.5h-1A1.5 1.5 0 0 1 3 16V7a1.5 1.5 0 0 1 1.5-1.5Z" />
      <path d="M8 11.5h.01M12 11.5h.01M16 11.5h.01" />
    </>
  ),
  // Campanhas: o megafone — falar para muita gente, com hora marcada.
  campanhas: (
    <>
      <path d="M4 10v4a1 1 0 0 0 1 1h2l6 4.5V4.5L7 9H5a1 1 0 0 0-1 1Z" />
      <path d="M7 15v3.5a1.5 1.5 0 0 0 3 0V16.3" />
      <path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  auditoria: (
    <>
      <path d="M12 3.5 19 6v5.5c0 4.3-2.9 7.8-7 9-4.1-1.2-7-4.7-7-9V6l7-2.5Z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </>
  ),
  lojas: (
    <>
      <path d="M4 9.5 5.5 4h13L20 9.5" />
      <path d="M4 9.5c0 1.4 1.1 2.5 2.7 2.5s2.6-1.1 2.6-2.5c0 1.4 1.1 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1 2.5 2.6 2.5S20 10.9 20 9.5" />
      <path d="M5.5 12v8.5h13V12M10 20.5v-5h4v5" />
    </>
  ),
  assinatura: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="M3 9.5h18M7 14.5h4" />
    </>
  ),
  configuracoes: (
    <>
      <path d="M4 7h10M18 7h2M4 17h3M11 17h9" />
      <circle cx="16" cy="7" r="2.2" />
      <circle cx="9" cy="17" r="2.2" />
    </>
  ),
}

/** A chave do ícone a partir do endereço do item: `/loja/produtos` → produtos. */
export function chaveDoItem(href: string): string {
  const partes = href.split('/').filter(Boolean)
  return partes.length <= 1 ? 'painel' : (partes.at(-1) ?? 'painel')
}

export function IconeDoItem({
  href,
  tamanho = 18,
  className,
}: {
  href: string
  tamanho?: number
  className?: string
}) {
  const desenho = D[chaveDoItem(href)]
  return (
    <svg
      aria-hidden
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {desenho ?? <circle cx="12" cy="12" r="7.5" />}
    </svg>
  )
}
