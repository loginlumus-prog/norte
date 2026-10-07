'use client'

// A cara do catálogo, editada em cima da prévia: a capa e a logo aparecem
// como a cliente vê no topo do catálogo (a capa na cor do tema escolhido, a
// logo por cima), e cada uma troca ali mesmo — tocando no botão da câmera ou
// arrastando a imagem para cima dela.
//
// Antes eram dois blocos soltos (a capa sempre azul, na cor do Norte, e a logo
// num quadrado ao lado), e a dona não via o conjunto até abrir o catálogo.

import { useRef, useState } from 'react'
import { cx } from '@/ui/base'
import { classeDaAcao, IconeDaAcao } from '@/ui/premium'
import { reduzirFoto } from '../../produtos/[id]/FotoDoProduto'
import { sigla } from '../[endereco]/marca'
import { capaAcao, logoAcao } from './acoes'

type Resposta = { ok: true } | { ok: false; erro: string }
type Agir = (f: () => Promise<Resposta>, ok?: string) => void

const Camera = ({ className }: { className?: string }) => (
  <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2l1.4-2h6.2l1.4 2h2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5Z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
)

/** Escolher ou soltar uma imagem: reduz no aparelho e entrega o arquivo. */
function useFoto(agir: Agir, usar: (b: Blob) => void) {
  const entrada = useRef<HTMLInputElement>(null)
  const [sobre, setSobre] = useState(false)
  const ler = async (f: File | undefined) => {
    if (!f) return
    if (!f.type.startsWith('image/')) return agir(async () => ({ ok: false, erro: 'Isso não é uma imagem. Use JPG ou PNG.' }))
    try {
      usar(await reduzirFoto(f))
    } catch {
      agir(async () => ({ ok: false, erro: 'Não deu para ler essa imagem. Tente outra (JPG ou PNG).' }))
    }
  }
  return {
    sobre,
    abrir: () => entrada.current?.click(),
    input: (
      <input
        ref={entrada}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          void ler(f)
        }}
      />
    ),
    soltar: {
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault()
        setSobre(true)
      },
      onDragLeave: () => setSobre(false),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        setSobre(false)
        void ler(e.dataTransfer.files?.[0])
      },
    },
  }
}

export function Perfil({
  slug,
  unidadeId,
  nome,
  loja,
  capa,
  logo,
  cor,
  agir,
  indo,
}: {
  slug: string
  unidadeId: string
  nome: string
  loja: string
  capa: string | null
  logo: string | null
  /** A cor do tema que está valendo neste catálogo. */
  cor: string
  agir: Agir
  indo: boolean
}) {
  const daCapa = useFoto(agir, (b) => {
    const fd = new FormData()
    fd.set('capa', b)
    agir(() => capaAcao(slug, unidadeId, fd), 'Capa trocada.')
  })
  const daLogo = useFoto(agir, (b) => {
    const fd = new FormData()
    fd.set('logo', b)
    agir(() => logoAcao(slug, fd), 'Logo trocada.')
  })
  const tirar = (campo: 'capa' | 'logo') => {
    const fd = new FormData()
    fd.set('tirar', '1')
    agir(() => (campo === 'capa' ? capaAcao(slug, unidadeId, fd) : logoAcao(slug, fd)), campo === 'capa' ? 'Capa tirada: fica a cor do tema.' : 'Logo tirada: ficam as iniciais.')
  }

  return (
    <div className={cx('perfil-catalogo w-full max-w-2xl overflow-hidden rounded-3xl', indo && 'opacity-70')} style={{ '--tema': cor } as React.CSSProperties} aria-busy={indo || undefined}>
      {daCapa.input}
      {daLogo.input}

      {/* ── A CAPA ── */}
      <div {...daCapa.soltar} className={cx('perfil-capa relative h-40 sm:h-48', daCapa.sobre && 'perfil-soltando')}>
        {capa ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={capa} alt="A capa do catálogo" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 pb-6 text-center text-white">
            <Camera className="size-7 opacity-80" />
            <span className="text-[13px] font-bold opacity-90">Sem foto, a capa fica na cor do tema</span>
            <span className="text-[12px] font-semibold opacity-70">Arraste uma foto para cá</span>
          </span>
        )}
        {daCapa.sobre ? <span className="absolute inset-0 grid place-items-center text-sm font-extrabold text-white">Solte para usar na capa</span> : null}
        <div className="absolute top-3 right-3 flex gap-2">
          <button type="button" disabled={indo} onClick={daCapa.abrir} className="perfil-vidro flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-bold">
            <Camera className="size-4" />
            {capa ? 'Trocar capa' : 'Pôr foto na capa'}
          </button>
          {capa ? (
            <button type="button" disabled={indo} onClick={() => tirar('capa')} aria-label="Tirar a foto da capa" title="Tirar a foto da capa" className="perfil-vidro grid size-9 place-items-center rounded-full">
              <IconeDaAcao icone="excluir" tamanho={16} />
            </button>
          ) : null}
        </div>
      </div>

      {/* ── A LOGO, por cima da capa, como no catálogo ── */}
      <div className="flex flex-col gap-4 px-5 pb-5">
        <div className="-mt-12 flex items-start gap-4">
          <div {...daLogo.soltar} className="relative shrink-0">
            <button
              type="button"
              disabled={indo}
              onClick={daLogo.abrir}
              aria-label={logo ? 'Trocar a logo' : 'Pôr a logo'}
              className={cx('perfil-logo group relative grid size-24 place-items-center overflow-hidden rounded-[26px] text-3xl font-extrabold text-white', daLogo.sobre && 'perfil-soltando')}
            >
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logo} alt="A logo" className="h-full w-full object-cover" />
              ) : (
                sigla(nome)
              )}
              <span aria-hidden className="perfil-logo-veu absolute inset-0 grid place-items-center">
                <Camera className="size-7" />
              </span>
            </button>
            <span aria-hidden className="perfil-logo-selo pointer-events-none absolute -right-1.5 -bottom-1.5 grid size-8 place-items-center rounded-full">
              <Camera className="size-4" />
            </span>
          </div>
          <div className="flex min-w-0 flex-col pt-14">
            <span className="truncate text-lg font-extrabold text-tinta">{nome}</span>
            <span className="truncate text-sm font-semibold text-tinta-3">{loja}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={indo} onClick={daLogo.abrir} className={classeDaAcao({ jeito: 'pilula', tom: 'principal' })}>
            <Camera className="size-[15px]" />
            {logo ? 'Trocar logo' : 'Pôr a logo'}
          </button>
          {logo ? (
            <button type="button" disabled={indo} onClick={() => tirar('logo')} className={classeDaAcao({ jeito: 'pilula', tom: 'perigo' })}>
              <IconeDaAcao icone="excluir" tamanho={15} />
              Tirar logo
            </button>
          ) : null}
        </div>

        <ul className="grid gap-1.5 text-[13px] text-tinta-2 sm:grid-cols-2">
          <li>
            <b className="text-tinta">Capa:</b> deitada (mais larga que alta) fica melhor — a fachada, a vitrine, o produto mais bonito. Vale só para este catálogo.
          </li>
          <li>
            <b className="text-tinta">Logo:</b> quadrada fica melhor. Sem logo, aparecem as iniciais. Vale para todas as lojas.
          </li>
        </ul>
      </div>
    </div>
  )
}
