'use client'

// Os planos.
//
// ── o desenho, e por que ele mudou ───────────────────────────
// A primeira versão do destaque era um cartão azul-noite cheio, com textura de
// carta celeste por trás. Ficou pesado: num quadro de quatro pacotes, encher
// um de tinta não destaca — atrapalha, porque o olho para de comparar e passa
// a olhar o bloco escuro.
//
// O jeito que funciona é o oposto: TODOS os cartões iguais, claros e leves, e
// o recomendado se separa por três detalhes pequenos — borda um pouco mais
// forte, uma pílula discreta e um degrau de altura. É o mesmo princípio do
// resto do sistema: quem separa é o espaço, não a tinta.
//
// ── o crédito mora DENTRO do plano ───────────────────────────
// Não é um extra ao lado: é parte do que se compra. Por isso ele aparece num
// bloco próprio dentro do cartão, com o número grande — é ele que diferencia
// os pacotes na prática, mais que a lista de recursos.
//
// ── e por que o Corporativo não tem botão ────────────────────
// Ele não é comprado por clique: é um acordo, com escopo e preço definidos
// depois de olhar a operação. Botão de "assinar" ali criaria uma empresa com
// tudo liberado e sem preço combinado — e a conversa começaria devendo.

import { useActionState } from 'react'
import type { Plano } from '@prisma/client'
import { MODULOS, type Modulo } from '@/servidor/modulos'
import { PLANOS, RECOMENDADO, RECURSOS, temRecurso, type Mudanca } from '@/servidor/planos'
import { SELO } from '@/ui/SeloPlano'
import { Botao, Aviso } from '@/ui/base'
import { trocar, type EstadoAssinatura } from './acoes'

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

/** Separa "R$ 1.497,00" em corpo e centavos, para o centavo ficar menor. */
function partes(v: number) {
  const s = brl(v)
  const i = s.lastIndexOf(',')
  return { corpo: s.slice(0, i), cent: s.slice(i) }
}

const Certo = () => (
  <span aria-hidden className="mt-[3px] shrink-0 text-[11px] leading-none text-bom">
    ✓
  </span>
)
const Errado = () => (
  <span aria-hidden className="mt-[3px] shrink-0 text-[11px] leading-none text-tinta-3 opacity-50">
    ✕
  </span>
)

export function Planos({
  slug,
  atual,
  opcoes,
  podeTrocar,
  whatsapp,
}: {
  slug: string
  atual: Plano
  opcoes: Mudanca[]
  podeTrocar: boolean
  /** Nosso WhatsApp comercial. Sem ele, o Corporativo pede contato pelo suporte. */
  whatsapp: string | null
}) {
  const acao = trocar.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoAssinatura, FormData>(acao, {})

  return (
    <div className="flex flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      <div className="grid items-stretch gap-3 lg:grid-cols-2 xl:grid-cols-4">
        {opcoes.map((m) => {
          const p = PLANOS[m.para]
          const Selo = SELO[m.para]
          const eOAtual = m.para === atual
          const eRecomendado = m.para === RECOMENDADO
          const sobConsulta = p.mensal === null
          const travado = m.impedimentos.length > 0

          return (
            <section
              key={m.para}
              className={
                'relative flex flex-col gap-4 rounded-norte border bg-superficie p-5 transition-shadow ' +
                (eOAtual
                  ? 'border-marca shadow-norte'
                  : eRecomendado
                    ? 'border-tinta/25 shadow-norte xl:-my-2 xl:pt-7'
                    : 'border-borda hover:shadow-norte')
              }
            >
              {/* A pílula. Uma por vez: "seu plano" ganha de "recomendado" —
                  dizer as duas coisas no mesmo cartão confunde qual é qual. */}
              {(eOAtual || eRecomendado) && (
                <span
                  className={
                    'absolute top-4 right-4 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ' +
                    (eOAtual
                      ? 'border-marca text-marca'
                      : 'border-sol text-sol')
                  }
                >
                  {eOAtual ? 'seu plano' : 'mais escolhido'}
                </span>
              )}

              <div className="flex flex-col gap-1.5 pr-24">
                <div className="flex items-center gap-2">
                  <Selo tamanho={22} className="shrink-0 text-tinta-3" />
                  <h3 className="text-lg font-bold tracking-tight">{p.titulo}</h3>
                </div>
                <p className="text-xs leading-relaxed text-tinta-2">{p.resumo}</p>
              </div>

              <div className="flex items-baseline gap-1">
                {sobConsulta ? (
                  <span className="text-[26px] leading-none font-bold tracking-tight text-tinta">
                    Sob consulta
                  </span>
                ) : (
                  <>
                    <span className="numero text-[30px] leading-none font-bold tracking-tight text-tinta">
                      {partes(p.mensal!).corpo}
                    </span>
                    <span className="numero text-base font-bold text-tinta-3">
                      {partes(p.mensal!).cent}
                    </span>
                    <span className="ml-0.5 text-xs text-tinta-3">/mês</span>
                  </>
                )}
              </div>

              {/* O CRÉDITO, dentro do plano. É o que diferencia os pacotes na
                  prática — mais que a lista de recursos, que é quase a mesma. */}
              <div className="rounded-norte bg-superficie-2 px-3 py-2.5">
                {p.creditoMensal === null ? (
                  <p className="text-[11px] leading-snug text-tinta-3">
                    Crédito de IA combinado no contrato.
                  </p>
                ) : p.creditoMensal > 0 ? (
                  <>
                    <p className="numero text-base font-bold text-tinta">
                      {brl(p.creditoMensal)}{' '}
                      <span className="font-medium text-tinta-2">de crédito de IA</span>
                    </p>
                    <p className="pt-0.5 text-[11px] leading-snug text-tinta-3">
                      renovado todo mês. Acabou antes, você compra mais.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-base font-bold text-tinta-3">Sem assistente</p>
                    <p className="pt-0.5 text-[11px] leading-snug text-tinta-3">
                      o WhatsApp continua sendo você.
                    </p>
                  </>
                )}
              </div>

              <div>
                {eOAtual ? (
                  <span className="block rounded-norte border border-borda py-2.5 text-center text-sm font-semibold text-tinta-3">
                    Em uso
                  </span>
                ) : sobConsulta ? (
                  whatsapp ? (
                    <a
                      href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(
                        'Olá! Quero conversar sobre o plano Corporativo do Norte.',
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-norte border border-tinta bg-tinta px-3 py-2.5 text-center text-sm font-semibold text-superficie hover:opacity-90"
                    >
                      Falar com a gente
                    </a>
                  ) : (
                    <span className="block rounded-norte border border-borda py-2.5 text-center text-sm font-semibold text-tinta-3">
                      Fechado por conversa — chame o suporte
                    </span>
                  )
                ) : (
                  <form action={agir}>
                    <input type="hidden" name="plano" value={m.para} />
                    <Botao
                      type="submit"
                      largo
                      tom={eRecomendado ? 'principal' : 'secundario'}
                      disabled={!podeTrocar || travado || pendente}
                      carregando={pendente}
                      className="py-2.5"
                    >
                      {m.sentido === 'subir' ? 'Mudar para este' : 'Voltar para este'}
                    </Botao>
                    {m.diferenca !== null && m.diferenca !== 0 && (
                      <p className="numero pt-1.5 text-center text-[11px] text-tinta-3">
                        {m.diferenca > 0 ? '+' : ''}
                        {brl(m.diferenca)} por mês
                      </p>
                    )}
                  </form>
                )}
              </div>

              {travado && (
                <ul className="flex flex-col gap-1">
                  {m.impedimentos.map((i) => (
                    <li
                      key={i}
                      className="rounded-norte bg-atencao-fundo px-2.5 py-1.5 text-[11px] leading-snug text-atencao"
                    >
                      {i}
                    </li>
                  ))}
                </ul>
              )}

              {/* A lista com ✓ e ✕, sem caixa e sem régua: cada linha é uma
                  linha. O ✕ fica porque saber o que NÃO tem é metade da
                  decisão — esconder o que falta é o que faz o cliente descobrir
                  depois de assinar. */}
              <ul className="flex flex-col gap-1.5 border-t border-borda-suave pt-3 text-xs">
                {RECURSOS.filter((r) => r.destaque).map((r) => {
                  const tem = temRecurso(r, m.para)
                  const detalhe = r.detalhe?.[m.para]
                  return (
                    <li key={r.titulo} className="flex items-start gap-2">
                      {tem ? <Certo /> : <Errado />}
                      <span className={tem ? 'text-tinta-2' : 'text-tinta-3 line-through opacity-60'}>
                        {r.titulo}
                        {tem && detalhe && (
                          <strong className="font-semibold text-tinta"> — {detalhe}</strong>
                        )}
                      </span>
                    </li>
                  )
                })}
              </ul>

              {!eOAtual && (m.ganha.length > 0 || m.perde.length > 0) && (
                <div className="flex flex-col gap-1 text-[11px]">
                  {m.ganha.length > 0 && (
                    <span className="text-bom">
                      Passa a ter: {m.ganha.map((x) => MODULOS[x as Modulo].titulo).join(', ')}
                    </span>
                  )}
                  {m.perde.length > 0 && (
                    <span className="text-critico">
                      Deixa de ter: {m.perde.map((x) => MODULOS[x as Modulo].titulo).join(', ')}
                    </span>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {!podeTrocar && <Aviso nivel="neutro">Só quem responde pela empresa muda o plano.</Aviso>}
    </div>
  )
}
