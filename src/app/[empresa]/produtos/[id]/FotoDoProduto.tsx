'use client'

// A foto do produto: tirar com a câmera do celular ou escolher da galeria.
//
// A foto do celular tem 4 MB; o catálogo precisa de 100 KB. A redução é feita
// AQUI, no aparelho (canvas, 1000 px no lado maior, WebP), antes de subir —
// a internet da loja agradece, e o banco guarda só o que a tela mostra.

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao } from '@/ui/base'
import { guardarFotoAcao, tirarFotoAcao } from './acoes'

const LADO = 1000

/** Também usada na lista "sem foto" da tela do catálogo: o mesmo caminho. */
export async function reduzirFoto(arquivo: File): Promise<Blob> {
  const bitmap = await createImageBitmap(arquivo)
  const escala = Math.min(1, LADO / Math.max(bitmap.width, bitmap.height))
  const largura = Math.round(bitmap.width * escala)
  const altura = Math.round(bitmap.height * escala)
  const canvas = document.createElement('canvas')
  canvas.width = largura
  canvas.height = altura
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('sem canvas')
  ctx.drawImage(bitmap, 0, 0, largura, altura)
  bitmap.close()
  for (const qualidade of [0.82, 0.7, 0.55]) {
    const b = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/webp', qualidade))
    // Navegador sem WebP devolve PNG: aí vai JPEG.
    const foto = b && b.type === 'image/webp' ? b : await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/jpeg', qualidade))
    if (foto && foto.size <= 900_000) return foto
  }
  throw new Error('grande demais')
}

export function FotoDoProduto({ slug, produtoId, nome, foto }: { slug: string; produtoId: string; nome: string; foto: string | null }) {
  const entrada = useRef<HTMLInputElement>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  function escolheu(arquivo: File | undefined) {
    if (!arquivo) return
    setErro(null)
    comecar(async () => {
      let pequena: Blob
      try {
        pequena = await reduzirFoto(arquivo)
      } catch {
        setErro('Não deu para abrir essa foto. Tente outra (JPG ou PNG).')
        return
      }
      const form = new FormData()
      form.append('foto', pequena, 'foto')
      const r = await guardarFotoAcao(slug, produtoId, form)
      if (r.erro) setErro(r.erro)
      else router.refresh()
    })
    if (entrada.current) entrada.current.value = ''
  }

  return (
    <section className="flex flex-wrap items-center gap-4">
      <div className="flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-norte border border-borda bg-superficie-2">
        {foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={foto} alt={`Foto de ${nome}`} className="h-full w-full object-cover" />
        ) : (
          <span className="text-3xl font-bold text-tinta-3" aria-hidden>
            {nome.trim().charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm text-tinta-2">{foto ? 'A foto do catálogo da loja.' : 'Sem foto ainda. Com foto vende mais.'}</p>
        <div className="flex flex-wrap gap-2">
          <Botao tom="secundario" carregando={indo} onClick={() => entrada.current?.click()}>
            {foto ? 'Trocar foto' : 'Pôr foto'}
          </Botao>
          {foto ? (
            <Botao
              tom="discreto"
              disabled={indo}
              onClick={() =>
                comecar(async () => {
                  const r = await tirarFotoAcao(slug, produtoId)
                  if (r.erro) setErro(r.erro)
                  else router.refresh()
                })
              }
            >
              Tirar foto
            </Botao>
          ) : null}
        </div>
        <input ref={entrada} type="file" accept="image/*" className="hidden" onChange={(e) => escolheu(e.target.files?.[0])} />
        {erro ? <Aviso nivel="critico">{erro}</Aviso> : null}
      </div>
    </section>
  )
}
