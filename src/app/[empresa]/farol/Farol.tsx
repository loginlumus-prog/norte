'use client'

// A tela do Farol. Três blocos, na ordem do uso:
//   1. A marca — o que a IA precisa saber (e nada de cliente).
//   2. Pedir — o que escrever agora: o tipo, e o pedido em uma frase.
//   3. O conteúdo — o que foi escrito: ler, editar, aprovar, marcar publicado.
// O Farol escreve; quem publica e comenta é gente (ver servidor/farol.ts).

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, Situacao, cx } from '@/ui/base'
import { Markdown } from '@/ui/Markdown'
import { arquivarMarcaAcao, atualizarPecaAcao, gerarAcao, salvarMarcaAcao, type EstadoFarol } from './acoes'

export type MarcaNaTela = {
  id: string
  nome: string
  nicho: string | null
  cidade: string | null
  instagram: string | null
  tiktok: string | null
  publico: string | null
  tom: string | null
  diferenciais: string | null
  objetivos: string | null
  unidadeIds: string[]
}

export type PecaNaTela = {
  id: string
  tipo: string
  titulo: string
  pedido: string | null
  conteudo: string
  situacao: 'RASCUNHO' | 'APROVADA' | 'PUBLICADA' | 'ARQUIVADA'
  para: string | null
  custoCent: number
  quem: string
  criadaEm: string
}

const reais = (cent: number) => (cent / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

const SITUACAO: Record<PecaNaTela['situacao'], { rotulo: string; nivel: 'neutro' | 'atencao' | 'bom' }> = {
  RASCUNHO: { rotulo: 'rascunho', nivel: 'neutro' },
  APROVADA: { rotulo: 'aprovada', nivel: 'atencao' },
  PUBLICADA: { rotulo: 'publicada', nivel: 'bom' },
  ARQUIVADA: { rotulo: 'arquivada', nivel: 'neutro' },
}

const vazia: Omit<MarcaNaTela, 'id'> = {
  nome: '', nicho: '', cidade: '', instagram: '', tiktok: '', publico: '', tom: '', diferenciais: '', objetivos: '', unidadeIds: [],
}

function FormMarca({
  slug,
  marca,
  lojas,
  aoTerminar,
}: {
  slug: string
  marca: MarcaNaTela | null
  lojas: { id: string; nome: string }[]
  aoTerminar: (r: EstadoFarol) => void
}) {
  const [d, setD] = useState<Omit<MarcaNaTela, 'id'>>(marca ? { ...marca } : vazia)
  const [indo, comecar] = useTransition()
  const campo = (k: keyof Omit<MarcaNaTela, 'id' | 'unidadeIds'>) => ({
    value: d[k] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.currentTarget.value }),
  })
  const area = 'w-full rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-3'
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        comecar(async () => aoTerminar(await salvarMarcaAcao(slug, marca?.id ?? null, d)))
      }}
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo="Nome da marca" required placeholder="Como aparece no perfil" {...campo('nome')} />
        <Campo rotulo="Nicho" placeholder="Sorveteria e açaí" {...campo('nicho')} />
        <Campo rotulo="Cidade e bairros" placeholder="Salvador — Itapuã, Stella Maris" {...campo('cidade')} />
        <Campo rotulo="Instagram" placeholder="@seuperfil" {...campo('instagram')} />
        <Campo rotulo="TikTok" placeholder="@seuperfil (se tiver)" {...campo('tiktok')} />
        <Campo rotulo="Tom de voz" placeholder="Leve, divertido, de família" {...campo('tom')} />
      </div>
      <label className="flex flex-col gap-1 text-sm font-medium text-tinta">
        Para quem a marca fala
        <textarea className={area} rows={2} placeholder="Famílias com criança no fim de semana; jovens depois da escola; quem compra picolé para revender…" {...campo('publico')} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-tinta">
        O que a diferencia
        <textarea className={area} rows={2} placeholder="Fábrica própria, sabores da fruta da estação, preço de atacado a partir de 20…" {...campo('diferenciais')} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-tinta">
        O que quer nos próximos meses
        <textarea className={area} rows={2} placeholder="Encher a loja nova, vender mais pote de 2 litros, crescer o perfil…" {...campo('objetivos')} />
      </label>
      {lojas.length > 1 && (
        <fieldset className="flex flex-wrap gap-3 text-sm text-tinta">
          <legend className="mb-1 text-sm font-medium">Lojas que este perfil cobre (nenhuma marcada = todas)</legend>
          {lojas.map((l) => (
            <label key={l.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                className="size-4 accent-[var(--marca)]"
                checked={d.unidadeIds.includes(l.id)}
                onChange={(e) =>
                  setD({ ...d, unidadeIds: e.currentTarget.checked ? [...d.unidadeIds, l.id] : d.unidadeIds.filter((x) => x !== l.id) })
                }
              />
              {l.nome}
            </label>
          ))}
        </fieldset>
      )}
      <div className="flex justify-end">
        <Botao type="submit" tom="confirmar" carregando={indo}>
          {marca ? 'Salvar a marca' : 'Cadastrar a marca'}
        </Botao>
      </div>
    </form>
  )
}

function Peca({ slug, p, aoMudar }: { slug: string; p: PecaNaTela; aoMudar: (r: EstadoFarol) => void }) {
  const [aberta, setAberta] = useState(false)
  const [editando, setEditando] = useState(false)
  const [texto, setTexto] = useState(p.conteudo)
  const [indo, comecar] = useTransition()
  const s = SITUACAO[p.situacao]
  const mudar = (d: { conteudo?: string; situacao?: string }) => comecar(async () => aoMudar(await atualizarPecaAcao(slug, p.id, d)))
  return (
    <li className="rounded-norte border border-borda bg-superficie">
      <button type="button" onClick={() => setAberta(!aberta)} className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold text-tinta">{p.titulo}</span>
          <span className="text-xs text-tinta-3">
            {p.criadaEm} · {p.quem}
            {p.para ? ` · para ${p.para.split('-').reverse().join('/')}` : ''} · {reais(p.custoCent)} de crédito
          </span>
        </span>
        <Situacao nivel={s.nivel}>{s.rotulo}</Situacao>
      </button>
      {aberta && (
        <div className="flex flex-col gap-3 border-t border-borda-suave px-4 py-3">
          {editando ? (
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.currentTarget.value)}
              rows={16}
              className="w-full rounded-norte border border-borda bg-superficie px-3 py-2 font-mono text-xs text-tinta"
            />
          ) : (
            <Markdown texto={p.conteudo} />
          )}
          <div className="flex flex-wrap gap-2">
            {editando ? (
              <>
                <Botao tom="confirmar" className="px-3 py-1.5 text-xs" carregando={indo} onClick={() => { mudar({ conteudo: texto }); setEditando(false) }}>
                  Salvar o texto
                </Botao>
                <Botao tom="discreto" className="px-3 py-1.5 text-xs" onClick={() => { setTexto(p.conteudo); setEditando(false) }}>
                  Cancelar
                </Botao>
              </>
            ) : (
              <>
                <Botao tom="discreto" className="px-3 py-1.5 text-xs" onClick={() => setEditando(true)}>Editar</Botao>
                <Botao
                  tom="discreto"
                  className="px-3 py-1.5 text-xs"
                  onClick={() => navigator.clipboard?.writeText(p.conteudo).then(() => aoMudar({ ok: 'Texto copiado.' }))}
                >
                  Copiar
                </Botao>
                {p.situacao === 'RASCUNHO' && (
                  <Botao tom="secundario" className="px-3 py-1.5 text-xs" carregando={indo} onClick={() => mudar({ situacao: 'APROVADA' })}>Aprovar</Botao>
                )}
                {p.situacao !== 'PUBLICADA' && (
                  <Botao tom="confirmar" className="px-3 py-1.5 text-xs" carregando={indo} onClick={() => mudar({ situacao: 'PUBLICADA' })}>Marcar publicada</Botao>
                )}
                <Botao tom="discreto" className="px-3 py-1.5 text-xs" carregando={indo} onClick={() => mudar({ situacao: 'ARQUIVADA' })}>Arquivar</Botao>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  )
}

export function Farol({
  slug,
  marcas,
  atualId,
  pecas,
  lojas,
  tipos,
  creditoCent,
}: {
  slug: string
  marcas: MarcaNaTela[]
  atualId: string | null
  pecas: PecaNaTela[]
  lojas: { id: string; nome: string }[]
  tipos: { chave: string; titulo: string; resumo: string }[]
  creditoCent: number
}) {
  const router = useRouter()
  const [recado, setRecado] = useState<EstadoFarol | null>(null)
  const [editandoMarca, setEditandoMarca] = useState(false)
  const [novaMarca, setNovaMarca] = useState(false)
  const [tipo, setTipo] = useState(tipos[0]?.chave ?? 'DIAGNOSTICO')
  const [pedido, setPedido] = useState('')
  const [para, setPara] = useState('')
  const [filtro, setFiltro] = useState('')
  const [indo, comecar] = useTransition()
  const atual = marcas.find((m) => m.id === atualId) ?? null

  const terminou = (r: EstadoFarol) => {
    setRecado(r)
    if (r.ok) {
      setEditandoMarca(false)
      setNovaMarca(false)
      router.refresh()
    }
  }

  if (marcas.length === 0 || novaMarca) {
    return (
      <div className="flex max-w-4xl flex-col gap-4">
        {recado?.erro && <Aviso nivel="critico">{recado.erro}</Aviso>}
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold text-tinta">{marcas.length === 0 ? 'Comece pela marca' : 'Nova marca'}</p>
          <p className="text-sm text-tinta-2">
            Uma marca é um perfil nas redes. Conte o que a IA precisa saber para escrever do seu jeito — o resto ela tira dos
            números da loja (o que mais vende, os horários de movimento). Nada de cliente sai do sistema.
          </p>
        </div>
        <FormMarca slug={slug} marca={null} lojas={lojas} aoTerminar={terminou} />
        {marcas.length > 0 && (
          <button type="button" className="w-fit text-sm text-tinta-3 hover:text-tinta" onClick={() => setNovaMarca(false)}>
            voltar
          </button>
        )}
      </div>
    )
  }

  const visiveis = pecas.filter((p) => !filtro || p.tipo === filtro)

  return (
    <div className="flex flex-col gap-5">
      {recado?.erro && <Aviso nivel="critico">{recado.erro}</Aviso>}
      {recado?.ok && <Aviso nivel="bom">{recado.ok}</Aviso>}

      {/* ── a marca ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {marcas.map((m) => (
            <Link
              key={m.id}
              href={`/${slug}/farol?marca=${m.id}`}
              className={cx(
                'rounded-full border px-3 py-1.5 text-sm font-semibold transition',
                m.id === atualId ? 'border-marca bg-marca-suave text-tinta' : 'border-borda text-tinta-2 hover:border-marca/50',
              )}
            >
              {m.nome}
              {m.instagram ? <span className="ml-1 font-normal text-tinta-3">@{m.instagram}</span> : null}
            </Link>
          ))}
          <button type="button" className="text-xs font-semibold text-marca hover:underline" onClick={() => setNovaMarca(true)}>
            + marca
          </button>
        </div>
        <span className="text-sm text-tinta-2">
          Crédito de IA: <strong className={creditoCent <= 0 ? 'text-critico' : 'text-tinta'}>{reais(creditoCent)}</strong>
          {' · '}
          <Link href={`/${slug}/assinatura`} className="font-semibold text-marca hover:underline">recarregar</Link>
        </span>
      </div>

      {atual && (
        <div className="rounded-norte border border-borda bg-superficie p-4">
          {editandoMarca ? (
            <>
              <FormMarca slug={slug} marca={atual} lojas={lojas} aoTerminar={terminou} />
              <div className="mt-2 flex gap-3">
                <button type="button" className="text-xs text-tinta-3 hover:text-tinta" onClick={() => setEditandoMarca(false)}>cancelar</button>
                <button
                  type="button"
                  className="text-xs text-critico hover:underline"
                  onClick={() => comecar(async () => terminou(await arquivarMarcaAcao(slug, atual.id)))}
                >
                  arquivar esta marca
                </button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap items-start justify-between gap-3 text-sm text-tinta-2">
              <span className="flex max-w-3xl flex-col gap-0.5">
                <span className="font-semibold text-tinta">{[atual.nicho, atual.cidade].filter(Boolean).join(' · ') || 'Complete a marca: nicho e cidade ajudam muito.'}</span>
                {atual.publico && <span>Público: {atual.publico}</span>}
                {atual.tom && <span>Tom: {atual.tom}</span>}
              </span>
              <Botao tom="discreto" className="px-3 py-1.5 text-xs" onClick={() => setEditandoMarca(true)}>Editar a marca</Botao>
            </div>
          )}
        </div>
      )}

      {/* ── pedir ── */}
      {atual && (
        <section className="flex flex-col gap-3">
          <p className="text-base font-semibold text-tinta">O que o Farol escreve agora</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {tipos.map((t) => (
              <button
                key={t.chave}
                type="button"
                onClick={() => setTipo(t.chave)}
                className={cx(
                  'flex flex-col gap-1 rounded-norte border p-3 text-left transition',
                  tipo === t.chave ? 'border-marca bg-marca-suave' : 'border-borda bg-superficie hover:border-marca/50',
                )}
              >
                <span className="text-sm font-semibold text-tinta">{t.titulo}</span>
                <span className="text-xs text-tinta-2">{t.resumo}</span>
              </button>
            ))}
          </div>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              setRecado(null)
              comecar(async () => {
                const r = await gerarAcao(slug, { marcaId: atual.id, tipo, pedido, para: para || null })
                setRecado(r)
                if (r.ok) {
                  setPedido('')
                  router.refresh()
                }
              })
            }}
          >
            <textarea
              value={pedido}
              onChange={(e) => setPedido(e.currentTarget.value)}
              rows={2}
              placeholder="Em uma frase, o que você quer (opcional): “picolé de coco para o calor de sábado”, “promoção do pote de 2 litros”…"
              className="w-full rounded-norte border border-borda bg-superficie px-3 py-2 text-sm text-tinta placeholder:text-tinta-3"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm text-tinta-2">
                Vai ao ar em
                <input type="date" value={para} onChange={(e) => setPara(e.currentTarget.value)} className="rounded-norte border border-borda bg-superficie px-2 py-1 text-sm text-tinta" />
              </label>
              <Botao type="submit" tom="confirmar" carregando={indo} disabled={creditoCent <= 0}>
                {indo ? 'Escrevendo… (até um minuto)' : 'Escrever'}
              </Botao>
            </div>
            {creditoCent <= 0 && <Aviso nivel="atencao">O crédito de IA acabou. Recarregue em Assinatura para o Farol voltar a escrever.</Aviso>}
          </form>
        </section>
      )}

      {/* ── o conteúdo ── */}
      {atual && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-base font-semibold text-tinta">O que já foi escrito</p>
            <select value={filtro} onChange={(e) => setFiltro(e.currentTarget.value)} className="rounded-norte border border-borda bg-superficie px-2 py-1 text-sm text-tinta">
              <option value="">Tudo</option>
              {tipos.map((t) => (
                <option key={t.chave} value={t.chave}>{t.titulo}</option>
              ))}
            </select>
          </div>
          {visiveis.length === 0 ? (
            <p className="text-sm text-tinta-3">Nada escrito ainda{filtro ? ' deste tipo' : ''}. Comece pelo diagnóstico: ele dá a direção do resto.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {visiveis.map((p) => (
                <Peca key={p.id} slug={slug} p={p} aoMudar={terminou} />
              ))}
            </ul>
          )}
          <p className="text-xs text-tinta-3">
            O Farol escreve; quem publica e comenta é você. Instagram e TikTok derrubam perfil que comenta ou posta por automação —
            por isso nada sai daqui sozinho.
          </p>
        </section>
      )}
    </div>
  )
}
