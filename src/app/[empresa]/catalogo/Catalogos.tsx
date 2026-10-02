'use client'

// Uma linha por loja: o link (copiar, mandar no WhatsApp, abrir), se está no
// ar, e o jeito de receber (retirada, entrega, taxa, mínimo, Pix). Fechado, o
// link mostra "não encontrado" — a cliente não vê produto de loja que não
// quer vender assim.

import { useRef, useState, useTransition } from 'react'
import type { CatalogoDaLoja, FotosQueFaltam } from '@/servidor/catalogo'
import { Aviso, Botao, Campo, Cartao, Situacao } from '@/ui/base'
import { reduzirFoto } from '../produtos/[id]/FotoDoProduto'
import { fotoPeloCatalogoAcao, maisSemFotoAcao, salvarCatalogoAcao } from './acoes'

const dinheiro = (t: string) => {
  const n = Number(t.replace(/\s|R\$/g, '').replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : null
}
const mostrar = (n: number | null) => (n == null ? '' : n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

export function Catalogos({
  slug,
  base,
  lojas,
  encomendaLigada,
  podeMudar,
  podeFoto,
  empresaNome,
}: {
  slug: string
  base: string
  lojas: CatalogoDaLoja[]
  encomendaLigada: boolean
  podeMudar: boolean
  /** Edita produto em alguma loja: vê o botão de tirar a foto (o servidor confere o alcance). */
  podeFoto: boolean
  empresaNome: string
}) {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-sm text-tinta-2">
        Um catálogo por loja, com o estoque dela. Os pedidos chegam em{' '}
        <a href={`/${slug}/encomendas`} className="font-semibold text-marca underline-offset-4 hover:underline">Encomendas</a> e no
        WhatsApp da loja.
      </p>
      {!encomendaLigada && podeMudar ? (
        <Aviso nivel="neutro">Ao abrir o primeiro catálogo, as Encomendas são ligadas: é para lá que os pedidos vão.</Aviso>
      ) : null}
      {lojas.length === 0 ? <p className="text-sm text-tinta-2">Nenhuma loja que vende ao público.</p> : null}
      {lojas.map((l) => (
        <UmaLoja key={l.unidadeId} slug={slug} base={base} loja={l} podeMudar={podeMudar} podeFoto={podeFoto} empresaNome={empresaNome} />
      ))}
      <Cartao titulo="Para o catálogo ficar bonito">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-tinta-2">
          <li>
            Ponha foto nos produtos: com foto vendem mais. Sem foto, o produto aparece com um ícone e o botão “Pedir foto no WhatsApp”. Tire a
            foto na lista de cada loja aqui em cima, ou em{' '}
            <a href={`/${slug}/produtos`} className="font-semibold text-marca">Produtos</a> (abra o produto e toque em “Pôr foto”).
          </li>
          <li>Organize por categoria: cada categoria vira um botão no topo do catálogo.</li>
          <li>Só aparece o que tem preço e está à venda nesta loja. Acabou o estoque, some sozinho (ou aparece como esgotado, se preferir).</li>
        </ul>
      </Cartao>
    </div>
  )
}

function UmaLoja({
  slug,
  base,
  loja,
  podeMudar,
  podeFoto,
  empresaNome,
}: {
  slug: string
  base: string
  loja: CatalogoDaLoja
  podeMudar: boolean
  podeFoto: boolean
  empresaNome: string
}) {
  const [f, setF] = useState({
    ativo: loja.ativo,
    endereco: loja.endereco,
    whatsapp: loja.whatsapp ?? '',
    recado: loja.recado ?? '',
    retirada: loja.retirada,
    entrega: loja.entrega,
    taxaEntrega: mostrar(loja.taxaEntrega),
    pedidoMinimo: mostrar(loja.pedidoMinimo),
    chavePix: loja.chavePix ?? '',
    mostrarEsgotado: loja.mostrarEsgotado,
  })
  const [salvo, setSalvo] = useState({ ativo: loja.ativo, endereco: loja.endereco })
  const [aberto, setAberto] = useState(false)
  const [recado, setRecado] = useState<{ nivel: 'bom' | 'critico'; texto: string } | null>(null)
  const [copiou, setCopiou] = useState(false)
  const [salvando, comecar] = useTransition()
  const link = `${base}/${slug}/catalogo/${salvo.endereco}`
  const convite = `Olá! Veja o nosso catálogo e faça o seu pedido por aqui: ${link}`

  function salvar(ativo = f.ativo) {
    setRecado(null)
    comecar(async () => {
      const r = await salvarCatalogoAcao(slug, loja.unidadeId, {
        ativo,
        endereco: f.endereco,
        whatsapp: f.whatsapp || null,
        recado: f.recado || null,
        retirada: f.retirada,
        entrega: f.entrega,
        taxaEntrega: dinheiro(f.taxaEntrega),
        pedidoMinimo: dinheiro(f.pedidoMinimo),
        chavePix: f.chavePix || null,
        mostrarEsgotado: f.mostrarEsgotado,
      })
      if (!r.ok) {
        // O que faltou (quase sempre o WhatsApp) está nos ajustes: abre.
        setAberto(true)
        return setRecado({ nivel: 'critico', texto: r.erro })
      }
      setF((x) => ({ ...x, ativo, endereco: r.endereco }))
      setSalvo({ ativo, endereco: r.endereco })
      setRecado({ nivel: 'bom', texto: ativo ? 'Catálogo no ar. Copie o link e mande para as clientes.' : 'Catálogo fechado. O link deixa de abrir.' })
    })
  }

  return (
    <Cartao caixa>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-base font-bold text-titulo">{loja.lojaNome}</h2>
            <p className="text-xs text-tinta-3">
              {loja.pedidos30d > 0 ? `${loja.pedidos30d} pedido${loja.pedidos30d === 1 ? '' : 's'} pelo catálogo nos últimos 30 dias` : 'Nenhum pedido pelo catálogo ainda'}
            </p>
          </div>
          {salvo.ativo ? <Situacao nivel="bom">No ar</Situacao> : <Situacao>Fechado</Situacao>}
        </div>

        {salvo.ativo ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 rounded-norte border border-borda bg-superficie-2 px-3 py-2">
              <code className="min-w-0 flex-1 truncate text-sm text-tinta">{link}</code>
            </div>
            <p className="text-xs text-tinta-3">Produto sem foto aparece com um ícone e o botão “Pedir foto”.</p>
            <div className="flex flex-wrap gap-2">
              <Botao
                tom="secundario"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(link)
                    setCopiou(true)
                    setTimeout(() => setCopiou(false), 2000)
                  } catch {
                    // sem permissão de copiar: o link está à vista
                  }
                }}
              >
                {copiou ? 'Link copiado' : 'Copiar link'}
              </Botao>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(convite)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-norte border border-borda bg-superficie px-3 py-2 text-sm font-semibold text-tinta hover:bg-superficie-2"
              >
                Mandar no WhatsApp
              </a>
              <a
                href={`/${slug}/catalogo/${salvo.endereco}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-norte border border-borda bg-superficie px-3 py-2 text-sm font-semibold text-tinta hover:bg-superficie-2"
              >
                Ver como a cliente vê
              </a>
            </div>
          </div>
        ) : null}

        {recado ? <Aviso nivel={recado.nivel}>{recado.texto}</Aviso> : null}

        <SemFoto slug={slug} unidadeId={loja.unidadeId} inicio={loja.semFoto} aparecendo={loja.aparecendo} podeFoto={podeFoto} />

        {podeMudar ? (
          <>
            <div className="flex flex-wrap gap-2">
              {salvo.ativo ? (
                <Botao tom="secundario" onClick={() => salvar(false)} carregando={salvando}>
                  Fechar o catálogo
                </Botao>
              ) : (
                <Botao onClick={() => salvar(true)} carregando={salvando}>
                  Abrir o catálogo desta loja
                </Botao>
              )}
              <Botao tom="discreto" onClick={() => setAberto((a) => !a)} aria-expanded={aberto}>
                {aberto ? 'Esconder ajustes' : 'Ajustes: entrega, Pix, link'}
              </Botao>
            </div>
            {aberto ? (
              <form
                className="grid gap-4 border-t border-borda-suave pt-4 sm:grid-cols-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  salvar()
                }}
              >
                <Campo
                  rotulo="WhatsApp da loja"
                  id={`whatsapp-${loja.unidadeId}`}
                  value={f.whatsapp}
                  onChange={(e) => setF({ ...f, whatsapp: e.target.value })}
                  placeholder="(71) 99999-0000"
                  inputMode="tel"
                  dica="Para onde os pedidos vão."
                />
                <Campo
                  rotulo="Endereço do link"
                  id={`endereco-${loja.unidadeId}`}
                  value={f.endereco}
                  onChange={(e) => setF({ ...f, endereco: e.target.value.toLowerCase() })}
                  dica={`…/${slug}/catalogo/${f.endereco || 'loja'}`}
                />
                <div className="sm:col-span-2">
                  <Campo
                    rotulo="Recado no topo (opcional)"
                  id={`recado-${loja.unidadeId}`}
                    value={f.recado}
                    onChange={(e) => setF({ ...f, recado: e.target.value })}
                    placeholder={`Ex.: ${empresaNome} entrega no bairro até as 22h`}
                    maxLength={200}
                  />
                </div>
                <fieldset className="flex flex-col gap-2 sm:col-span-2">
                  <legend className="mb-1 text-sm font-medium text-tinta">Como a cliente recebe</legend>
                  <label className="flex items-center gap-2 text-sm text-tinta">
                    <input type="checkbox" checked={f.retirada} onChange={(e) => setF({ ...f, retirada: e.target.checked })} />
                    Retira na loja
                  </label>
                  <label className="flex items-center gap-2 text-sm text-tinta">
                    <input type="checkbox" checked={f.entrega} onChange={(e) => setF({ ...f, entrega: e.target.checked })} />
                    A loja entrega
                  </label>
                </fieldset>
                {f.entrega ? (
                  <Campo
                    rotulo="Taxa de entrega (R$)"
                  id={`taxa-${loja.unidadeId}`}
                    value={f.taxaEntrega}
                    onChange={(e) => setF({ ...f, taxaEntrega: e.target.value })}
                    inputMode="decimal"
                    placeholder="Vazio = grátis"
                  />
                ) : null}
                <Campo
                  rotulo="Pedido mínimo (R$)"
                  id={`minimo-${loja.unidadeId}`}
                  value={f.pedidoMinimo}
                  onChange={(e) => setF({ ...f, pedidoMinimo: e.target.value })}
                  inputMode="decimal"
                  placeholder="Vazio = sem mínimo"
                />
                <Campo
                  rotulo="Chave Pix (opcional)"
                  id={`pix-${loja.unidadeId}`}
                  value={f.chavePix}
                  onChange={(e) => setF({ ...f, chavePix: e.target.value })}
                  dica="Aparece para quem escolheu pagar no Pix."
                />
                <label className="flex items-center gap-2 self-end text-sm text-tinta sm:col-span-2">
                  <input type="checkbox" checked={f.mostrarEsgotado} onChange={(e) => setF({ ...f, mostrarEsgotado: e.target.checked })} />
                  Mostrar o que acabou como “esgotado” (em vez de esconder)
                </label>
                <div className="sm:col-span-2">
                  <Botao type="submit" tom="secundario" carregando={salvando}>
                    Salvar ajustes
                  </Botao>
                </div>
              </form>
            ) : null}
          </>
        ) : !salvo.ativo ? (
          <p className="text-sm text-tinta-2">Quem responde pela empresa abre o catálogo desta loja.</p>
        ) : null}
      </div>
    </Cartao>
  )
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const plural = (n: number, um: string, varios: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`

/**
 * Quantos aparecem no link e quais aparecem SEM foto (com o ícone e o "Pedir
 * foto") — com o botão de tirar a foto ali mesmo. No celular, o botão abre a
 * câmera de trás; a foto é reduzida no aparelho (o mesmo caminho da ficha do
 * produto) e o produto sai da lista, sem recarregar a página.
 */
function SemFoto({
  slug,
  unidadeId,
  inicio,
  aparecendo,
  podeFoto,
}: {
  slug: string
  unidadeId: string
  inicio: FotosQueFaltam
  aparecendo: number
  podeFoto: boolean
}) {
  const [lista, setLista] = useState(inicio)
  const [entraram, setEntraram] = useState<{ id: string; nome: string; foto: string }[]>([])
  const [aberta, setAberta] = useState(false)
  const [enviando, setEnviando] = useState<string | null>(null)
  const [erro, setErro] = useState<{ id: string; texto: string } | null>(null)
  const [lendo, comecarLeitura] = useTransition()
  const entrada = useRef<HTMLInputElement>(null)
  const alvo = useRef<string | null>(null)

  function tirar(id: string) {
    alvo.current = id
    setErro(null)
    entrada.current?.click()
  }

  async function escolheu(arquivo: File | undefined) {
    const id = alvo.current
    if (entrada.current) entrada.current.value = ''
    if (!arquivo || !id) return
    setEnviando(id)
    try {
      let pequena: Blob
      try {
        pequena = await reduzirFoto(arquivo)
      } catch {
        return setErro({ id, texto: 'Não deu para abrir essa foto. Tente de novo.' })
      }
      const form = new FormData()
      form.append('foto', pequena, 'foto')
      const r = await fotoPeloCatalogoAcao(slug, id, form)
      if (!r.ok) return setErro({ id, texto: r.erro })
      const p = lista.produtos.find((x) => x.id === id)
      setLista((l) => ({ ...l, total: Math.max(0, l.total - 1), produtos: l.produtos.filter((x) => x.id !== id) }))
      if (p) setEntraram((e) => [{ id, nome: p.nome, foto: URL.createObjectURL(pequena) }, ...e].slice(0, 8))
    } catch {
      setErro({ id, texto: 'Não deu para guardar a foto. Confira a internet e tente de novo.' })
    } finally {
      setEnviando(null)
    }
  }

  function mostrarMais() {
    comecarLeitura(async () => {
      // A próxima página começa onde a lista está agora: o que ganhou foto já
      // saiu da conta no servidor também.
      const r = await maisSemFotoAcao(slug, unidadeId, lista.produtos.length)
      if (!r) return
      setLista((l) => {
        const ja = new Set(l.produtos.map((p) => p.id))
        return { total: r.total, mais: r.mais, produtos: [...l.produtos, ...r.produtos.filter((p) => !ja.has(p.id))] }
      })
    })
  }

  const visiveis = aberta ? lista.produtos : lista.produtos.slice(0, 5)

  return (
    <section className="flex flex-col gap-3 rounded-norte border border-borda-suave bg-superficie-2/60 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
        <span className="inline-flex items-center gap-1.5 font-semibold text-tinta">
          <span aria-hidden className="h-2 w-2 rounded-full bg-bom-vivo" />
          {plural(aparecendo, 'produto aparecendo', 'produtos aparecendo')}
        </span>
        {lista.total > 0 ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-atencao">
            <span aria-hidden className="h-2 w-2 rounded-full bg-atencao-vivo" />
            {plural(lista.total, 'sem foto', 'sem foto')}
          </span>
        ) : null}
      </div>

      {entraram.length > 0 ? (
        <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Acabaram de entrar no catálogo">
          {entraram.map((e) => (
            <li key={e.id} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-bom-borda" title={e.nome}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={e.foto} alt={`Foto de ${e.nome}`} className="h-full w-full object-cover" />
              <span className="absolute right-0.5 bottom-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-bom-vivo text-[10px] font-bold text-white" aria-hidden>
                ✓
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {lista.total > 0 ? (
        <div className="flex flex-col gap-2">
          {/* A conta ("1 sem foto") já está na linha de cima: aqui, só o
              porquê, curto. */}
          <p className="text-sm text-tinta-2">
            Com foto vendem mais.{podeFoto ? '' : ' Quem cuida dos produtos põe a foto.'}
          </p>
          <ul className="flex flex-col divide-y divide-borda-suave rounded-norte border border-borda-suave bg-superficie">
            {visiveis.map((p) => (
              <li key={p.id} className="flex flex-col gap-1.5 px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <a href={`/${slug}/produtos/${p.id}`} className="block truncate text-sm font-semibold text-tinta hover:underline">
                      {p.nome}
                    </a>
                    <p className="text-xs text-tinta-3 tabular-nums">
                      {brl(p.preco)}
                      {p.estoque != null ? ` · ${p.estoque.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} em estoque` : ''}
                    </p>
                  </div>
                  {podeFoto ? (
                    <Botao
                      tom="secundario"
                      className="shrink-0 px-2.5 py-1.5"
                      carregando={enviando === p.id}
                      disabled={!!enviando && enviando !== p.id}
                      onClick={() => tirar(p.id)}
                    >
                      {enviando === p.id ? null : <Camera />}
                      Tirar foto
                    </Botao>
                  ) : null}
                </div>
                {erro?.id === p.id ? <p className="text-xs font-medium text-critico">{erro.texto}</p> : null}
              </li>
            ))}
          </ul>
          {!aberta && lista.produtos.length > 5 ? (
            <div>
              <Botao tom="discreto" className="px-2 py-1" onClick={() => setAberta(true)}>
                Ver a lista toda
              </Botao>
            </div>
          ) : (aberta || lista.produtos.length <= 5) && lista.mais ? (
            <div>
              <Botao tom="discreto" className="px-2 py-1" carregando={lendo} onClick={() => (setAberta(true), mostrarMais())}>
                Mostrar mais ({(lista.total - lista.produtos.length).toLocaleString('pt-BR')})
              </Botao>
            </div>
          ) : null}
          <input ref={entrada} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => escolheu(e.target.files?.[0])} />
        </div>
      ) : (
        <p className="text-sm text-tinta-2">Todo produto à venda nesta loja tem foto.</p>
      )}
    </section>
  )
}

function Camera() {
  return (
    <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8h3l1.6-2.2h6.8L17 8h3v11H4z" />
      <circle cx="12" cy="13.2" r="3.4" />
    </svg>
  )
}
