'use client'

// A troca de plano, feita pelo próprio cliente.
//
// ── por que o quadro inteiro antes do clique ─────────────────
// Trocar de plano mexe em preço E em funcionalidade. O erro comum é mostrar
// só o preço: a pessoa desce de plano para economizar, e três dias depois
// descobre que o Crediário sumiu com a carteira de fiado dela dentro. Aqui
// cada cartão diz o que GANHA, o que PERDE e o que IMPEDE, antes.
//
// ── e por que o Corporativo não tem botão ────────────────────
// Ele não é comprado por clique: é um acordo, com escopo e preço definidos
// depois de olhar a operação. Botão de "assinar" ali criaria uma empresa com
// tudo liberado e sem preço combinado — e a conversa começaria devendo.

import { useActionState } from 'react'
import { MODULOS, type Modulo } from '@/servidor/modulos'
import { PLANOS } from '@/servidor/planos'
import type { Mudanca } from '@/servidor/planos'
import { Botao, Aviso, Situacao } from '@/ui/base'
import { trocar, type EstadoAssinatura } from './acoes'

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

export function Planos({
  slug,
  atual,
  opcoes,
  podeTrocar,
  whatsapp,
}: {
  slug: string
  atual: string
  opcoes: Mudanca[]
  podeTrocar: boolean
  whatsapp: string
}) {
  const acao = trocar.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoAssinatura, FormData>(acao, {})

  return (
    <div className="flex flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
        {opcoes.map((m) => {
          const p = PLANOS[m.para]
          const eOAtual = m.para === atual
          const sobConsulta = p.mensal === null
          const travado = m.impedimentos.length > 0

          return (
            <section
              key={m.para}
              className={
                'realce relative flex flex-col gap-3 rounded-norte border p-4 ' +
                (eOAtual ? 'border-marca bg-marca-suave' : 'border-borda bg-superficie')
              }
            >
              {eOAtual && (
                <span className="absolute -top-2.5 left-4 rounded-full bg-marca px-2 py-0.5 text-[10px] font-bold tracking-wide text-marca-tinta uppercase">
                  seu plano
                </span>
              )}

              <div className="flex flex-col gap-1">
                <h3 className="text-base font-bold text-tinta">{p.titulo}</h3>
                <p className="text-xs leading-relaxed text-tinta-2">{p.resumo}</p>
              </div>

              <div className="flex items-baseline gap-1.5">
                {sobConsulta ? (
                  <span className="text-xl font-bold text-tinta">Sob consulta</span>
                ) : (
                  <>
                    <span className="numero text-2xl font-bold tracking-tight text-tinta">
                      {brl(p.mensal!)}
                    </span>
                    <span className="text-xs text-tinta-3">/mês</span>
                  </>
                )}
              </div>

              <ul className="flex flex-col gap-1 text-xs text-tinta-2">
                <li>
                  {p.unidades === null ? 'Unidades à vontade' : `${p.unidades} unidade${p.unidades === 1 ? '' : 's'}`}
                  {p.porUnidadeExtra !== null && ` · extra ${brl(p.porUnidadeExtra)}/mês`}
                </li>
                <li>{p.usuarios === null ? 'Equipe à vontade' : `Até ${p.usuarios} pessoas`}</li>
                <li>
                  {p.creditoMensal > 0
                    ? `${brl(p.creditoMensal)} de crédito de IA por mês`
                    : 'Sem assistente de IA'}
                </li>
              </ul>

              {/* O que muda de verdade, comparado com o plano de hoje. */}
              {!eOAtual && (m.ganha.length > 0 || m.perde.length > 0) && (
                <div className="flex flex-col gap-1 border-t border-borda-suave pt-2 text-xs">
                  {m.ganha.length > 0 && (
                    <span className="text-bom">
                      + {m.ganha.map((x) => MODULOS[x as Modulo].titulo).join(', ')}
                    </span>
                  )}
                  {m.perde.length > 0 && (
                    <span className="text-critico">
                      − {m.perde.map((x) => MODULOS[x as Modulo].titulo).join(', ')}
                    </span>
                  )}
                </div>
              )}

              {travado && (
                <div className="flex flex-col gap-1">
                  {m.impedimentos.map((i) => (
                    <Situacao key={i} nivel="atencao">
                      {i}
                    </Situacao>
                  ))}
                </div>
              )}

              <div className="mt-auto pt-1">
                {eOAtual ? (
                  <span className="block py-2 text-center text-xs font-semibold text-tinta-3">
                    Em uso
                  </span>
                ) : sobConsulta ? (
                  <a
                    href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(
                      'Olá! Quero conversar sobre o plano Corporativo do Norte.',
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded-norte border border-borda bg-superficie px-3 py-2 text-center text-sm font-semibold text-tinta hover:bg-superficie-2"
                  >
                    Falar com a gente
                  </a>
                ) : (
                  <form action={agir}>
                    <input type="hidden" name="plano" value={m.para} />
                    <Botao
                      type="submit"
                      largo
                      tom={m.sentido === 'subir' ? 'principal' : 'secundario'}
                      disabled={!podeTrocar || travado || pendente}
                      carregando={pendente}
                    >
                      {m.sentido === 'subir' ? 'Mudar para este' : 'Voltar para este'}
                      {m.diferenca !== null && m.diferenca !== 0 && (
                        <span className="numero ml-1 text-xs opacity-80">
                          ({m.diferenca > 0 ? '+' : ''}
                          {brl(m.diferenca)})
                        </span>
                      )}
                    </Botao>
                  </form>
                )}
              </div>
            </section>
          )
        })}
      </div>

      {!podeTrocar && (
        <Aviso nivel="neutro">Só quem responde pela empresa muda o plano.</Aviso>
      )}
    </div>
  )
}
