'use client'

// A capa e os destaques (as bolinhas do topo), no painel da aparência.
//
// Destaque é como o do perfil do Instagram: a loja dá o nome ("Promoções",
// "Açaí", "Para presente"), põe a foto da bolinha e escolhe o que aparece
// dentro — uma categoria inteira (que acompanha o cadastro) ou os produtos que
// ela escolher, na ordem em que tocou neles.

import '../[endereco]/vitrine.css'
import { useMemo, useRef, useState } from 'react'
import type { AparenciaDaLoja } from '@/servidor/vitrine'
import { Botao, cx } from '@/ui/base'
import { reduzirFoto } from '../../produtos/[id]/FotoDoProduto'
import { capaAcao, destaqueAcao, destaquesDasCategoriasAcao, moverDestaqueAcao, tirarDestaqueAcao } from './acoes'

type Resposta = { ok: true } | { ok: false; erro: string }
type Agir = (f: () => Promise<Resposta>, ok?: string) => void

/** Escolhe uma imagem, reduz no aparelho e devolve; erro vira recado. */
function useImagem(agir: Agir) {
  const entrada = useRef<HTMLInputElement>(null)
  const pedir = (usar: (b: Blob) => void) => {
    const el = entrada.current
    if (!el) return
    el.onchange = async () => {
      const f = el.files?.[0]
      el.value = ''
      if (!f) return
      try {
        usar(await reduzirFoto(f))
      } catch {
        agir(async () => ({ ok: false, erro: 'Não deu para ler essa imagem. Tente outra (JPG ou PNG).' }))
      }
    }
    el.click()
  }
  const input = <input ref={entrada} type="file" accept="image/*" className="hidden" />
  return { pedir, input }
}

export function Capa({ slug, unidadeId, capa, agir, indo }: { slug: string; unidadeId: string; capa: string | null; agir: Agir; indo: boolean }) {
  const img = useImagem(agir)
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-semibold text-tinta">Capa</p>
      <div className="relative h-28 w-full max-w-xl overflow-hidden rounded-2xl border border-borda bg-[linear-gradient(135deg,var(--marca),var(--marca-forte,var(--marca)))] sm:h-32">
        {capa ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={capa} alt="A capa" className="h-full w-full object-cover" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-white/85">Sem foto: a cor do tema</span>
        )}
      </div>
      {img.input}
      <div className="flex flex-wrap gap-2">
        <Botao
          tom="secundario"
          disabled={indo}
          onClick={() =>
            img.pedir((b) => {
              const fd = new FormData()
              fd.set('capa', b)
              agir(() => capaAcao(slug, unidadeId, fd), 'Capa trocada.')
            })
          }
        >
          {capa ? 'Trocar capa' : 'Pôr foto na capa'}
        </Botao>
        {capa ? (
          <Botao
            tom="discreto"
            disabled={indo}
            onClick={() => {
              const fd = new FormData()
              fd.set('tirar', '1')
              agir(() => capaAcao(slug, unidadeId, fd))
            }}
          >
            Tirar
          </Botao>
        ) : null}
      </div>
      <p className="text-xs text-tinta-3">Deitada (mais larga que alta) fica melhor: a fachada, a vitrine, o produto mais bonito.</p>
    </div>
  )
}

export function Destaques({
  slug,
  unidadeId,
  dados,
  produtos,
  agir,
  indo,
}: {
  slug: string
  unidadeId: string
  dados: AparenciaDaLoja
  produtos: { id: string; nome: string }[]
  agir: Agir
  indo: boolean
}) {
  const [editando, setEditando] = useState<string | 'novo' | null>(null)
  const lista = dados.destaques
  return (
    <div className="flex flex-col gap-4">
      {lista.length === 0 ? (
        <div className="flex flex-col gap-3 rounded-norte border border-dashed border-borda bg-superficie p-4">
          <p className="text-sm text-tinta-2">
            Hoje as bolinhas saem sozinhas, uma por categoria. Monte as suas: com o nome que quiser, a foto que quiser e só o que
            você escolher dentro.
          </p>
          <div className="flex flex-wrap gap-2">
            <Botao disabled={indo} onClick={() => agir(() => destaquesDasCategoriasAcao(slug, unidadeId), 'Destaques criados pelas categorias. Agora é só ajustar.')}>
              Começar pelas categorias
            </Botao>
            <Botao tom="secundario" disabled={indo} onClick={() => setEditando('novo')}>
              Criar do zero
            </Botao>
          </div>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-borda-suave rounded-norte border border-borda bg-superficie">
          {lista.map((d, i) => (
            <li key={d.id} className="flex flex-col gap-3 p-3">
              <div className="flex items-center gap-3">
                <span className="vt-anel flex h-14 w-14 shrink-0 items-center justify-center rounded-full p-[2px]">
                  <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border-2 border-superficie bg-superficie-2 text-xs font-bold text-tinta-2">
                    {d.capa ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={d.capa} alt="" className="h-full w-full object-cover" />
                    ) : (
                      d.nome.slice(0, 2).toUpperCase()
                    )}
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-tinta">{d.nome}</p>
                  <p className="truncate text-xs text-tinta-3">{d.conteudo}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button type="button" disabled={indo || i === 0} onClick={() => agir(() => moverDestaqueAcao(slug, d.id, -1))} aria-label={`Subir ${d.nome}`} className="h-8 w-8 rounded-full text-tinta-2 hover:bg-superficie-2 disabled:opacity-30">
                    ↑
                  </button>
                  <button type="button" disabled={indo || i === lista.length - 1} onClick={() => agir(() => moverDestaqueAcao(slug, d.id, 1))} aria-label={`Descer ${d.nome}`} className="h-8 w-8 rounded-full text-tinta-2 hover:bg-superficie-2 disabled:opacity-30">
                    ↓
                  </button>
                  <button type="button" onClick={() => setEditando(editando === d.id ? null : d.id)} className="rounded-full px-2.5 py-1 text-xs font-semibold text-marca hover:bg-superficie-2">
                    {editando === d.id ? 'Fechar' : 'Editar'}
                  </button>
                  <button
                    type="button"
                    disabled={indo}
                    onClick={() => {
                      if (window.confirm(`Tirar o destaque "${d.nome}"?`)) agir(() => tirarDestaqueAcao(slug, d.id))
                    }}
                    className="rounded-full px-2.5 py-1 text-xs font-semibold text-critico hover:bg-superficie-2"
                  >
                    Tirar
                  </button>
                </div>
              </div>
              {editando === d.id ? (
                <Editor slug={slug} unidadeId={unidadeId} destaque={d} categorias={dados.categorias} produtos={produtos} agir={agir} indo={indo} fechar={() => setEditando(null)} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {lista.length > 0 && editando !== 'novo' ? (
        <Botao tom="secundario" className="w-fit" onClick={() => setEditando('novo')}>
          Novo destaque
        </Botao>
      ) : null}
      {editando === 'novo' ? (
        <div className="rounded-norte border border-borda bg-superficie p-4">
          <Editor slug={slug} unidadeId={unidadeId} destaque={null} categorias={dados.categorias} produtos={produtos} agir={agir} indo={indo} fechar={() => setEditando(null)} />
        </div>
      ) : null}
    </div>
  )
}

function Editor({
  slug,
  unidadeId,
  destaque,
  categorias,
  produtos,
  agir,
  indo,
  fechar,
}: {
  slug: string
  unidadeId: string
  destaque: AparenciaDaLoja['destaques'][number] | null
  categorias: { id: string; nome: string }[]
  produtos: { id: string; nome: string }[]
  agir: Agir
  indo: boolean
  fechar: () => void
}) {
  const [nome, setNome] = useState(destaque?.nome ?? '')
  const [tipo, setTipo] = useState<'categoria' | 'produtos'>(destaque && !destaque.categoriaId ? 'produtos' : 'categoria')
  const [categoriaId, setCategoriaId] = useState(destaque?.categoriaId ?? categorias[0]?.id ?? '')
  const [escolhidos, setEscolhidos] = useState<string[]>(destaque?.produtoIds ?? [])
  const [filtro, setFiltro] = useState('')
  const [capa, setCapa] = useState<Blob | 'tirar' | null>(null)
  const [previa, setPrevia] = useState<string | null>(destaque?.capa ?? null)
  const img = useImagem(agir)
  const nomeDe = useMemo(() => new Map(produtos.map((p) => [p.id, p.nome])), [produtos])
  const visiveis = useMemo(() => {
    const f = filtro.trim().toLowerCase()
    return produtos.filter((p) => !f || p.nome.toLowerCase().includes(f)).slice(0, 80)
  }, [produtos, filtro])
  const alternar = (id: string) => setEscolhidos((e) => (e.includes(id) ? e.filter((x) => x !== id) : e.length >= 30 ? e : [...e, id]))

  return (
    <form
      className="grid gap-4 sm:grid-cols-[96px_1fr]"
      onSubmit={(e) => {
        e.preventDefault()
        const fd = new FormData()
        if (destaque) fd.set('id', destaque.id)
        fd.set('nome', nome)
        if (tipo === 'categoria') fd.set('categoriaId', categoriaId)
        else fd.set('produtoIds', JSON.stringify(escolhidos))
        if (capa instanceof Blob) fd.set('capa', capa)
        else if (capa === 'tirar') fd.set('tirarCapa', '1')
        agir(async () => {
          const r = await destaqueAcao(slug, unidadeId, fd)
          if (r.ok) fechar()
          return r
        }, destaque ? 'Destaque salvo.' : 'Destaque criado.')
      }}
    >
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={() =>
            img.pedir((b) => {
              setCapa(b)
              setPrevia(URL.createObjectURL(b))
            })
          }
          className="vt-anel flex h-20 w-20 items-center justify-center rounded-full p-[3px]"
          aria-label="Escolher a foto da bolinha"
        >
          <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-full border-2 border-superficie bg-superficie-2 text-[11px] text-tinta-3">
            {previa ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previa} alt="" className="h-full w-full object-cover" />
            ) : (
              'pôr foto'
            )}
          </span>
        </button>
        {img.input}
        {previa ? (
          <button
            type="button"
            onClick={() => {
              setCapa('tirar')
              setPrevia(null)
            }}
            className="text-xs text-tinta-3 hover:text-tinta"
          >
            tirar foto
          </button>
        ) : (
          <span className="text-center text-[11px] text-tinta-3">sem foto, usa a do 1º produto</span>
        )}
      </div>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-tinta">Nome (aparece embaixo da bolinha)</span>
          <input value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={22} placeholder="Promoções" className="rounded-norte border border-borda bg-superficie px-3 py-2 text-tinta" />
        </label>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium text-tinta">O que aparece dentro</legend>
          <div className="flex flex-wrap gap-2">
            {(['categoria', 'produtos'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(t)}
                aria-pressed={tipo === t}
                className={cx('rounded-full border px-3 py-1.5 text-sm font-semibold', tipo === t ? 'border-marca bg-marca text-marca-tinta' : 'border-borda text-tinta-2 hover:bg-superficie-2')}
              >
                {t === 'categoria' ? 'Uma categoria inteira' : 'Produtos que eu escolher'}
              </button>
            ))}
          </div>
          {tipo === 'categoria' ? (
            <select value={categoriaId} onChange={(e) => setCategoriaId(e.target.value)} className="w-full max-w-sm rounded-norte border border-borda bg-superficie px-3 py-2 text-tinta">
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          ) : (
            <div className="flex flex-col gap-2">
              {escolhidos.length > 0 ? (
                <ol className="flex flex-wrap gap-1.5">
                  {escolhidos.map((id, i) => (
                    <li key={id}>
                      <button type="button" onClick={() => alternar(id)} className="flex items-center gap-1 rounded-full bg-marca-suave px-2.5 py-1 text-xs font-semibold text-tinta">
                        {i + 1}. {nomeDe.get(id) ?? 'produto'} <span aria-hidden>×</span>
                        <span className="sr-only">tirar</span>
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-xs text-tinta-3">Toque nos produtos abaixo, na ordem em que devem aparecer.</p>
              )}
              <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Procurar produto" className="rounded-norte border border-borda bg-superficie px-3 py-2 text-tinta" />
              <ul className="flex max-h-56 flex-col overflow-y-auto rounded-norte border border-borda-suave">
                {visiveis.map((p) => {
                  const marcado = escolhidos.includes(p.id)
                  return (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-superficie-2">
                        <input type="checkbox" checked={marcado} onChange={() => alternar(p.id)} />
                        <span className={marcado ? 'font-semibold text-tinta' : 'text-tinta-2'}>{p.nome}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </fieldset>
        <div className="flex gap-2">
          <Botao type="submit" disabled={indo} carregando={indo}>
            {destaque ? 'Salvar destaque' : 'Criar destaque'}
          </Botao>
          <Botao tom="discreto" onClick={fechar}>
            Cancelar
          </Botao>
        </div>
      </div>
    </form>
  )
}
