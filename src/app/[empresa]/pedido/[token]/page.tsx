import '../../catalogo/[endereco]/vitrine.css'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { acompanharPedido } from '@/servidor/catalogo'
import { estiloDaMarca } from '../../catalogo/[endereco]/marca'
import { Adiante, Fechar, MarcaDaLoja, Visto, Zap } from '../../catalogo/[endereco]/Pecas'
import { Atualizar, CopiarPix } from './Atualizar'
import { Avaliar } from './Avaliar'

// ACOMPANHAR O PEDIDO feito pelo catálogo. O link é secreto (16 bytes
// aleatórios) e é a única chave: quem tem o link vê o pedido — e só o
// primeiro nome, os itens e a situação. Telefone e endereço completo não
// aparecem, para o link encaminhado não espalhar dado de ninguém.

export const metadata: Metadata = { title: { absolute: 'Seu pedido' }, robots: { index: false, follow: false } }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca'

export default async function Acompanhar({ params }: { params: Promise<{ empresa: string; token: string }> }) {
  const { empresa, token } = await params
  const p = await acompanharPedido(empresa, token)
  if (!p) notFound()

  const passos = [
    { nome: 'Pedido enviado', detalhe: quando(p.criadoEm) },
    { nome: 'Aceito pela loja', detalhe: 'A loja confirma e prepara' },
    { nome: p.entrega ? 'Saiu para entrega' : 'Pronto para retirar', detalhe: p.entrega ? 'A caminho do seu endereço' : 'Separado na loja' },
    { nome: p.entrega ? 'Entregue' : 'Retirado', detalhe: 'Pedido concluído' },
  ]
  const aberto = !p.situacao.cancelado && p.situacao.passo < 3
  const zap = p.loja.whatsapp ? `https://wa.me/${p.loja.whatsapp}?text=${encodeURIComponent(`Olá! Sobre o meu pedido ${p.codigo}:`)}` : null
  const cartao = 'rounded-[24px] border border-borda-suave bg-superficie shadow-[0_1px_2px_rgb(0_0_0/0.04)]'

  return (
    <main style={estiloDaMarca(p.empresa.corMarca)} className="relative min-h-dvh bg-fundo px-4 pt-6 pb-12 sm:pt-10">
      {aberto ? <Atualizar /> : null}
      <div aria-hidden className="vt-halo pointer-events-none absolute inset-x-0 top-0 h-64" />
      <div className="relative mx-auto flex max-w-md flex-col gap-4">
        <header className="flex items-center gap-3 pb-1">
          <MarcaDaLoja nome={p.empresa.nome} logo={p.empresa.logoUrl} className="h-12 w-12 rounded-2xl text-base" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-extrabold tracking-tight text-titulo">{p.empresa.nome}</p>
            <p className="truncate text-sm text-tinta-2">{p.loja.nome}</p>
          </div>
          {zap ? (
            <a
              href={zap}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Falar com a loja no WhatsApp"
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-borda bg-superficie vt-zap shadow-sm hover:bg-superficie-2 ${FOCO}`}
            >
              <Zap />
            </a>
          ) : null}
        </header>

        {/* ── a situação ── */}
        <section className={`${cartao} flex flex-col gap-5 p-5 sm:p-6`} aria-labelledby="situacao">
          <div className="flex flex-col gap-1.5">
            <p className="text-xs font-bold tracking-[0.1em] text-tinta-3 uppercase">
              Pedido {p.codigo}
              {p.primeiroNome ? <span className="tracking-normal normal-case"> · {p.primeiroNome}</span> : null}
            </p>
            <h1 id="situacao" className={`text-[26px] leading-tight font-extrabold tracking-tight text-balance ${p.situacao.cancelado ? 'text-critico' : 'text-titulo'}`}>
              {p.situacao.titulo}
            </h1>
            <p className="text-[15px] text-tinta-2">{p.situacao.texto}</p>
          </div>

          {p.situacao.cancelado ? (
            <p className="flex items-center gap-3 rounded-2xl bg-critico-fundo px-4 py-3 text-sm font-medium text-critico">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-critico text-white">
                <Fechar tamanho={16} />
              </span>
              Este pedido não segue mais.
            </p>
          ) : (
            <ol className="flex flex-col" aria-label="Andamento do pedido">
              {passos.map((s, i) => {
                const feito = i < p.situacao.passo || p.situacao.passo === 3
                const agora = i === p.situacao.passo && p.situacao.passo < 3
                const ultimo = i === passos.length - 1
                return (
                  <li key={s.nome} className="relative flex gap-3.5 pb-5 last:pb-0" aria-current={agora ? 'step' : undefined}>
                    {!ultimo ? (
                      <span aria-hidden className={`absolute top-8 bottom-0 left-[13px] w-0.5 rounded-full ${i < p.situacao.passo ? 'bg-marca' : 'bg-superficie-3'}`} />
                    ) : null}
                    <span
                      aria-hidden
                      className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                        feito ? 'bg-marca text-marca-tinta' : agora ? 'vt-agora bg-marca text-marca-tinta ring-4 ring-[var(--marca-anel)]' : 'border-2 border-borda bg-superficie'
                      }`}
                    >
                      {feito ? <Visto tamanho={14} /> : agora ? <span className="h-2 w-2 rounded-full bg-marca-tinta" /> : null}
                    </span>
                    <div className="flex min-w-0 flex-col pt-0.5">
                      <span className={`text-[15px] leading-tight ${feito || agora ? 'font-bold text-titulo' : 'font-medium text-tinta-3'}`}>
                        {s.nome}
                        {agora ? <span className="sr-only"> (agora)</span> : feito ? <span className="sr-only"> (feito)</span> : null}
                      </span>
                      <span className={`mt-0.5 text-[13px] ${agora ? 'text-tinta-2' : 'text-tinta-3'}`}>{s.detalhe}</span>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}

          <dl className="grid grid-cols-2 gap-2.5 text-sm">
            <div className="rounded-2xl bg-superficie-2 px-3.5 py-3">
              <dt className="text-xs font-medium text-tinta-3">{p.entrega ? 'Entrega' : 'Retirada'}</dt>
              <dd className="mt-0.5 font-semibold text-tinta">{quando(p.para)}</dd>
            </div>
            <div className="rounded-2xl bg-superficie-2 px-3.5 py-3">
              <dt className="text-xs font-medium text-tinta-3">Pagamento</dt>
              <dd className="mt-0.5 font-semibold text-tinta">{p.forma ?? 'Combinar com a loja'}</dd>
            </div>
          </dl>
          {aberto ? <p className="-mt-2 text-center text-xs text-tinta-3">Esta página se atualiza sozinha.</p> : null}
        </section>

        {p.chavePix ? (
          <section className={`${cartao} flex flex-col gap-2.5 p-5`}>
            <h2 className="text-base font-extrabold tracking-tight text-titulo">Pix da loja</h2>
            <p className="text-sm text-tinta-2">
              Pague <strong className="text-tinta tabular-nums">{brl(p.total)}</strong> e mande o comprovante no WhatsApp da loja.
            </p>
            <CopiarPix chave={p.chavePix} />
          </section>
        ) : null}

        {/* ── o que foi pedido ── */}
        <section className={`${cartao} flex flex-col gap-3 p-5`}>
          <h2 className="text-base font-extrabold tracking-tight text-titulo">O que você pediu</h2>
          <ul className="flex flex-col divide-y divide-borda-suave text-sm">
            {p.itens.map((i, n) => (
              <li key={n} className="flex items-start justify-between gap-3 py-2.5 first:pt-0">
                <span className="flex min-w-0 gap-2.5 text-tinta">
                  <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-md bg-marca-suave px-1.5 text-xs font-bold text-[var(--marca-texto)] tabular-nums">
                    {i.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}×
                  </span>
                  <span className="pt-0.5">{i.descricao}</span>
                </span>
                <span className="shrink-0 pt-0.5 font-medium text-tinta-2 tabular-nums">{brl(i.total)}</span>
              </li>
            ))}
            {p.taxaEntrega > 0 ? (
              <li className="flex justify-between gap-3 py-2.5 text-tinta-2">
                <span>Entrega</span>
                <span className="tabular-nums">{brl(p.taxaEntrega)}</span>
              </li>
            ) : null}
          </ul>
          <p className="flex justify-between border-t border-borda-suave pt-3 text-lg font-extrabold text-titulo">
            <span>Total</span>
            <span className="tabular-nums">{brl(p.total)}</span>
          </p>
        </section>

        {p.avaliacao.pode ? <Avaliar slug={p.empresa.slug} token={token} feita={p.avaliacao.feita} /> : null}

        <div className="flex flex-col gap-2.5 pt-1">
          {zap ? (
            <a
              href={zap}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex min-h-14 items-center justify-center gap-2.5 rounded-2xl bg-[#15803d] px-5 text-base font-bold text-white shadow-[0_10px_24px_-12px_#15803d] hover:bg-[#126c34] ${FOCO}`}
            >
              <Zap /> Falar com a loja no WhatsApp
            </a>
          ) : null}
          {p.loja.catalogo ? (
            <a
              href={`/${p.empresa.slug}/catalogo/${p.loja.catalogo}`}
              className={`flex min-h-12 items-center justify-center gap-1.5 rounded-2xl border border-borda bg-superficie px-5 text-[15px] font-semibold text-tinta hover:bg-superficie-2 ${FOCO}`}
            >
              Voltar ao catálogo <Adiante tamanho={16} />
            </a>
          ) : null}
        </div>
      </div>
    </main>
  )
}
