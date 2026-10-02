import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { acompanharPedido } from '@/servidor/catalogo'
import { Atualizar, CopiarPix } from './Atualizar'

// ACOMPANHAR O PEDIDO feito pelo catálogo. O link é secreto (16 bytes
// aleatórios) e é a única chave: quem tem o link vê o pedido — e só o
// primeiro nome, os itens e a situação. Telefone e endereço completo não
// aparecem, para o link encaminhado não espalhar dado de ninguém.

export const metadata: Metadata = { title: { absolute: 'Seu pedido' }, robots: { index: false, follow: false } }

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default async function Acompanhar({ params }: { params: Promise<{ empresa: string; token: string }> }) {
  const { empresa, token } = await params
  const p = await acompanharPedido(empresa, token)
  if (!p) notFound()

  const passos = ['Enviado', 'Aceito', p.entrega ? 'Saiu para entrega' : 'Pronto', p.entrega ? 'Entregue' : 'Retirado']
  const cor = p.empresa.corMarca && /^#[0-9a-fA-F]{6}$/.test(p.empresa.corMarca) ? p.empresa.corMarca : null
  const aberto = !p.situacao.cancelado && p.situacao.passo < 3

  return (
    <main style={cor ? ({ '--marca': cor } as React.CSSProperties) : undefined} className="min-h-dvh bg-fundo px-4 py-8">
      {aberto ? <Atualizar /> : null}
      <div className="mx-auto flex max-w-md flex-col gap-5">
        <header className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-marca text-lg font-extrabold text-marca-tinta">
            {p.empresa.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.empresa.logoUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              p.empresa.nome.trim().charAt(0).toUpperCase()
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-titulo">{p.empresa.nome}</p>
            <p className="truncate text-xs text-tinta-2">{p.loja.nome}</p>
          </div>
        </header>

        <section className="flex flex-col gap-4 rounded-3xl border border-borda bg-superficie p-5">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-semibold tracking-wide text-tinta-3 uppercase">Pedido {p.codigo}</p>
            <h1 className={`text-2xl font-extrabold text-balance ${p.situacao.cancelado ? 'text-critico' : 'text-titulo'}`}>{p.situacao.titulo}</h1>
            <p className="text-sm text-tinta-2">{p.situacao.texto}</p>
          </div>
          {!p.situacao.cancelado ? (
            <ol className="grid grid-cols-4 gap-1.5" aria-label="Andamento">
              {passos.map((nome, i) => (
                <li key={nome} className="flex flex-col gap-1.5">
                  <span className={`h-1.5 rounded-full ${i <= p.situacao.passo ? 'bg-marca' : 'bg-superficie-3'}`} />
                  <span className={`text-[11px] leading-tight ${i <= p.situacao.passo ? 'font-semibold text-tinta' : 'text-tinta-3'}`}>{nome}</span>
                </li>
              ))}
            </ol>
          ) : null}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-tinta-3">{p.entrega ? 'Entrega' : 'Retirada'}</dt>
              <dd className="font-medium text-tinta">{quando(p.para)}</dd>
            </div>
            <div>
              <dt className="text-xs text-tinta-3">Pagamento</dt>
              <dd className="font-medium text-tinta">{p.forma ?? 'Combinar com a loja'}</dd>
            </div>
          </dl>
        </section>

        {p.chavePix ? (
          <section className="flex flex-col gap-2 rounded-3xl border border-borda bg-superficie p-5">
            <h2 className="text-sm font-bold text-titulo">Pix da loja</h2>
            <p className="text-sm text-tinta-2">Pague {brl(p.total)} e mande o comprovante no WhatsApp da loja.</p>
            <CopiarPix chave={p.chavePix} />
          </section>
        ) : null}

        <section className="flex flex-col gap-3 rounded-3xl border border-borda bg-superficie p-5">
          <h2 className="text-sm font-bold text-titulo">O que você pediu</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {p.itens.map((i, n) => (
              <li key={n} className="flex justify-between gap-3">
                <span className="text-tinta">
                  <span className="font-semibold tabular-nums">{i.quantidade.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}×</span> {i.descricao}
                </span>
                <span className="text-tinta-2 tabular-nums">{brl(i.total)}</span>
              </li>
            ))}
            {p.taxaEntrega > 0 ? (
              <li className="flex justify-between gap-3 text-tinta-2">
                <span>Entrega</span>
                <span className="tabular-nums">{brl(p.taxaEntrega)}</span>
              </li>
            ) : null}
          </ul>
          <p className="flex justify-between border-t border-borda-suave pt-3 text-base font-extrabold text-titulo">
            <span>Total</span>
            <span className="tabular-nums">{brl(p.total)}</span>
          </p>
        </section>

        <div className="flex flex-col gap-2.5">
          {p.loja.whatsapp ? (
            <a
              href={`https://wa.me/${p.loja.whatsapp}?text=${encodeURIComponent(`Olá! Sobre o meu pedido ${p.codigo}:`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl bg-[#1f9d55] px-5 py-3.5 text-center text-[15px] font-bold text-white hover:brightness-95"
            >
              Falar com a loja no WhatsApp
            </a>
          ) : null}
          {p.loja.catalogo ? (
            <a
              href={`/${p.empresa.slug}/catalogo/${p.loja.catalogo}`}
              className="rounded-2xl border border-borda bg-superficie px-5 py-3 text-center text-sm font-semibold text-tinta hover:bg-superficie-2"
            >
              Voltar ao catálogo
            </a>
          ) : null}
        </div>
      </div>
    </main>
  )
}
