'use client'

// Uma linha por loja: o link (copiar, mandar no WhatsApp, abrir), se está no
// ar, e o jeito de receber (retirada, entrega, taxa, mínimo, Pix). Fechado, o
// link mostra "não encontrado" — a cliente não vê produto de loja que não
// quer vender assim.

import { useState, useTransition } from 'react'
import type { CatalogoDaLoja } from '@/servidor/catalogo'
import { Aviso, Botao, Campo, Cartao, Situacao } from '@/ui/base'
import { salvarCatalogoAcao } from './acoes'

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
  empresaNome,
}: {
  slug: string
  base: string
  lojas: CatalogoDaLoja[]
  encomendaLigada: boolean
  podeMudar: boolean
  empresaNome: string
}) {
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <p className="text-sm text-tinta-2">
        Cada loja tem o seu catálogo, com o estoque dela: a cliente abre o link no celular, escolhe e manda o pedido. O pedido chega
        em <a href={`/${slug}/encomendas`} className="font-semibold text-marca underline-offset-4 hover:underline">Encomendas</a> e no
        WhatsApp da loja, e você recebe no balcão como qualquer encomenda.
      </p>
      {!encomendaLigada && podeMudar ? (
        <Aviso nivel="neutro">Ao abrir o primeiro catálogo, as Encomendas são ligadas: é para lá que os pedidos vão.</Aviso>
      ) : null}
      {lojas.length === 0 ? <p className="text-sm text-tinta-2">Nenhuma loja que vende ao público.</p> : null}
      {lojas.map((l) => (
        <UmaLoja key={l.unidadeId} slug={slug} base={base} loja={l} podeMudar={podeMudar} empresaNome={empresaNome} />
      ))}
      <Cartao titulo="Para o catálogo ficar bonito">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm text-tinta-2">
          <li>
            Ponha foto nos produtos (em <a href={`/${slug}/produtos`} className="font-semibold text-marca">Produtos</a>, abra o produto e
            toque em “Foto”). Produto sem foto aparece com a inicial.
          </li>
          <li>Organize por categoria: cada categoria vira um botão no topo do catálogo.</li>
          <li>Só aparece o que tem preço e está à venda nesta loja. Acabou o estoque, some sozinho (ou aparece como esgotado, se preferir).</li>
        </ul>
      </Cartao>
    </div>
  )
}

function UmaLoja({ slug, base, loja, podeMudar, empresaNome }: { slug: string; base: string; loja: CatalogoDaLoja; podeMudar: boolean; empresaNome: string }) {
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
