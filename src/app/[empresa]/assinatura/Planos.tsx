'use client'

// Os planos.
//
// ── o desenho, e por que ele mudou ───────────────────────────
// A primeira versão do destaque era um cartão azul-noite cheio, com textura de
// carta celeste por trás. Ficou pesado: num quadro de pacotes, encher um de
// tinta não destaca — atrapalha, porque o olho para de comparar e passa a
// olhar o bloco escuro.
//
// O jeito que funciona é o oposto: TODOS os cartões iguais, claros e leves, e
// o recomendado se separa por detalhes pequenos — borda um pouco mais forte e
// uma pílula discreta. É o mesmo princípio do resto do sistema: quem separa é
// o espaço, não a tinta.
//
// ── quais cartões aparecem ───────────────────────────────────
// Desde a tabela de 02/10/2026: os dois que se vendem (o Norte e o Norte +
// Assistente), o Corporativo (que é conversa) e o plano de hoje quando ele é
// de contrato. O Grátis não aparece como opção: ele não se vende, é onde a
// empresa fica quando o teste acaba — e o quadro "O que você tem" já diz isso.
//
// ── o preço é o DESTA empresa ────────────────────────────────
// O número grande é a conta com as lojas que ela tem hoje (`mudanca` usa
// `mensalidade`), e não o preço de vitrine da primeira loja. Quem tem três
// lojas e lê "R$ X" no cartão espera pagar X; a composição (a primeira loja,
// cada loja a mais, o assistente) vem embaixo, em letra menor.
//
// ── teste e contrato ─────────────────────────────────────────
// Em teste, nenhum cartão está "em uso": o botão de todos é "Assinar este", e
// o clique vira pedido — a gente confirma o pagamento e o teste vira
// assinatura sem perder nada. No plano de contrato, os botões dão lugar ao
// contato: trocar por clique desfaria o que foi combinado.
//
// ── e por que o Corporativo não tem botão ────────────────────
// Ele não é comprado por clique: é um acordo, com escopo e preço definidos
// depois de olhar a operação. Botão de "assinar" ali criaria uma empresa com
// tudo liberado e sem preço combinado — e a conversa começaria devendo.

import { useActionState } from 'react'
import type { Plano, Situacao } from '@prisma/client'
import { MODULOS, type Modulo } from '@/servidor/modulos'
import { PLANOS, PLANOS_COM_PRECO, PRECOS, RECOMENDADO, RECURSOS, temRecurso, type Mudanca } from '@/servidor/planos'
import { Botao, Aviso } from '@/ui/base'
import { Confirmar } from '@/ui/Confirmar'
import { trocar, type EstadoAssinatura } from './acoes'

/** Os nomes dos módulos, para gente: "Crediário", e não "crediario". */
const nomes = (lista: string[]) => lista.map((x) => MODULOS[x as Modulo]?.titulo ?? x).join(', ')

const brl = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)

/** Sem centavos, para a composição em letra miúda: "R$ 139 cada loja a mais". */
const brl0 = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v)

/** Separa "R$ 1.497,00" em corpo e centavos, para o centavo ficar menor. */
function partes(v: number) {
  const s = brl(v)
  const i = s.lastIndexOf(',')
  return { corpo: s.slice(0, i), cent: s.slice(i) }
}

/** Plano de contrato: tem conta de tabela, mas não está à venda. */
const deContrato = (p: Plano) => !PLANOS[p].aVenda && p !== 'GRATIS'

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
  situacao,
  lojas,
  opcoes,
  podeTrocar,
  whatsapp,
}: {
  slug: string
  atual: Plano
  situacao: Situacao
  /** Lojas de venda abertas hoje — a conta de cada cartão é com elas. */
  lojas: number
  opcoes: Mudanca[]
  podeTrocar: boolean
  /** Nosso WhatsApp comercial. Sem ele, o contato vai pelo suporte. */
  whatsapp: string | null
}) {
  const acao = trocar.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoAssinatura, FormData>(acao, {})

  const emTeste = situacao === 'TESTE'
  const contratoHoje = deContrato(atual)
  const mostrar = opcoes.filter(
    (m) => PLANOS[m.para].aVenda || m.para === 'CORPORATIVO' || (m.para === atual && contratoHoje),
  )

  // Os planos à venda, para a frase do "fale com a gente".
  const aVenda = PLANOS_COM_PRECO.map((p) => PLANOS[p].titulo).join(' ou o ')

  const contato = (texto: string) =>
    whatsapp ? (
      <a
        href={`https://wa.me/${whatsapp}?text=${encodeURIComponent(texto)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="block rounded-norte border border-tinta bg-tinta px-3 py-2.5 text-center text-sm font-semibold text-superficie hover:opacity-90"
      >
        Falar com a gente
      </a>
    ) : (
      <span className="block rounded-norte border border-borda py-2.5 text-center text-sm font-semibold text-tinta-3">
        Fale com o suporte
      </span>
    )

  return (
    <div className="flex flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}

      <div className="grid items-stretch gap-3 lg:grid-cols-3">
        {mostrar.map((m) => {
          const p = PLANOS[m.para]
          const eOAtual = m.para === atual
          const eRecomendado = m.para === RECOMENDADO
          const sobConsulta = p.mensal === null
          const contrato = deContrato(m.para) && m.para !== 'CORPORATIVO'
          const travado = m.impedimentos.length > 0
          const comAssistente = p.modulos.includes('agente')
          // Em teste o plano de hoje não está "em uso": ainda não foi assinado.
          const emUso = eOAtual && !emTeste

          return (
            <section
              key={m.para}
              className={
                'relative flex flex-col gap-4 rounded-norte border bg-superficie p-5 transition-shadow ' +
                (eOAtual
                  ? 'border-marca shadow-norte'
                  : eRecomendado
                    ? 'border-tinta/25 shadow-norte'
                    : 'border-borda hover:shadow-norte')
              }
            >
              {/* A pílula. Uma por vez: "seu plano" ganha de "recomendado" —
                  dizer as duas coisas no mesmo cartão confunde qual é qual. E
                  é "recomendado", não "mais escolhido": é o que a gente
                  recomenda (`RECOMENDADO`), não uma contagem que não temos. */}
              {(eOAtual || eRecomendado) && (
                <span
                  className={
                    'absolute top-4 right-4 rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ' +
                    (eOAtual ? 'border-marca text-marca' : 'border-sol text-sol')
                  }
                >
                  {eOAtual ? (emTeste ? 'em teste' : 'seu plano') : 'recomendado'}
                </span>
              )}

              <div className="flex flex-col gap-1.5 pr-24">
                <h3 className="text-lg font-bold tracking-tight">{p.titulo}</h3>
                <p className="text-xs leading-relaxed text-tinta-2">{p.resumo}</p>
              </div>

              <div className="flex flex-col gap-1">
                {sobConsulta ? (
                  <span className="text-[26px] leading-none font-bold tracking-tight text-tinta">Sob consulta</span>
                ) : contrato ? (
                  <>
                    <span className="text-[26px] leading-none font-bold tracking-tight text-tinta">
                      Valor de contrato
                    </span>
                    {/* A conta da tabela é a referência para a conversa — o
                        que se paga de fato é o combinado. */}
                    {m.novoMensal !== null && (
                      <span className="numero text-[11px] text-tinta-3">
                        pela tabela, {brl(m.novoMensal)} por mês com {lojas === 1 ? '1 loja' : `${lojas} lojas`}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className="flex items-baseline gap-1">
                      <span className="numero text-[30px] leading-none font-bold tracking-tight text-tinta">
                        {partes(m.novoMensal!).corpo}
                      </span>
                      <span className="numero text-base font-bold text-tinta-3">{partes(m.novoMensal!).cent}</span>
                      <span className="ml-0.5 text-xs text-tinta-3">/mês</span>
                    </span>
                    <span className="numero text-[11px] leading-snug text-tinta-3">
                      {lojas <= 1 ? 'com 1 loja' : `com as suas ${lojas} lojas`}: {brl0(PRECOS.primeiraLoja)} a
                      primeira, {brl0(PRECOS.lojaExtra)} cada loja a mais
                      {comAssistente ? `, ${brl0(PRECOS.assistente)} o assistente` : ''}. Depósito não conta.
                    </span>
                  </>
                )}
              </div>

              {/* O CRÉDITO, dentro do plano: é o que separa os dois cartões na
                  prática — o resto da loja vem igual nos dois. */}
              <div className="rounded-norte bg-superficie-2 px-3 py-2.5">
                {p.creditoMensal === null ? (
                  <p className="text-[11px] leading-snug text-tinta-3">Crédito de IA combinado no contrato.</p>
                ) : p.creditoMensal > 0 ? (
                  <>
                    <p className="numero text-base font-bold text-tinta">
                      {brl(p.creditoMensal)} <span className="font-medium text-tinta-2">de crédito de IA</span>
                    </p>
                    <p className="pt-0.5 text-[11px] leading-snug text-tinta-3">
                      por mês, para o assistente. Acabou antes, você recarrega.
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-base font-bold text-tinta-3">Sem assistente</p>
                    <p className="pt-0.5 text-[11px] leading-snug text-tinta-3">
                      tudo da loja, e o WhatsApp continua sendo você.
                    </p>
                  </>
                )}
              </div>

              <div>
                {emUso ? (
                  <span className="block rounded-norte border border-borda py-2.5 text-center text-sm font-semibold text-tinta-3">
                    {contrato ? 'Em uso, pelo contrato' : 'Em uso'}
                  </span>
                ) : sobConsulta ? (
                  contato('Olá! Quero conversar sobre o plano Corporativo do Norte.')
                ) : contratoHoje ? (
                  // Plano de contrato: a troca passa pela gente, porque mexe no
                  // que foi combinado. O servidor recusa igual (acoes.ts).
                  <div className="flex flex-col gap-1.5">
                    {contato(`Olá! Tenho o plano ${PLANOS[atual].titulo} e quero conversar sobre o ${p.titulo}.`)}
                    <p className="text-center text-[11px] text-tinta-3">o seu plano é de contrato</p>
                  </div>
                ) : (
                  <div>
                    {m.sentido === 'descer' && !emTeste && podeTrocar && !travado ? (
                      // Descer desliga módulos NA HORA — e era um clique só.
                      // Agora pergunta, dizendo o que sai.
                      <Confirmar
                        tom="secundario"
                        tomSim="perigo"
                        className="w-full py-2.5"
                        pergunta={
                          <span className="block text-left">
                            {m.perde.length > 0 ? `Desliga agora: ${nomes(m.perde)}.` : 'Nenhum módulo sai.'}
                            {PLANOS[atual].creditoMensal !== 0 && p.creditoMensal === 0
                              ? ' O assistente para de responder.'
                              : ''}{' '}
                            Trocar mesmo?
                          </span>
                        }
                        sim="Sim, trocar"
                        aoConfirmar={() => {
                          const fd = new FormData()
                          fd.set('plano', m.para)
                          agir(fd)
                        }}
                      >
                        Mudar para este
                      </Confirmar>
                    ) : (
                      // Fora do <form> o Confirmar: botão sem `type` dentro de
                      // formulário é "submit", e trocaria o plano antes de
                      // perguntar.
                      <form action={agir}>
                        <input type="hidden" name="plano" value={m.para} />
                        <Botao
                          type="submit"
                          largo
                          tom={eRecomendado || (emTeste && eOAtual) ? 'principal' : 'secundario'}
                          disabled={!podeTrocar || travado || pendente}
                          carregando={pendente}
                          className="py-2.5"
                        >
                          {emTeste ? 'Assinar este' : 'Mudar para este'}
                        </Botao>
                      </form>
                    )}
                    {!emTeste && m.diferenca !== null && m.diferenca !== 0 && (
                      <p className="numero pt-1.5 text-center text-[11px] text-tinta-3">
                        {m.diferenca > 0 ? '+' : ''}
                        {brl(m.diferenca)} por mês
                      </p>
                    )}
                  </div>
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
                  depois de assinar. Só entram as linhas que algum plano à venda
                  tem: a implantação do Corporativo não é um ✕ do Norte. */}
              <ul className="flex flex-col gap-1.5 border-t border-borda-suave pt-3 text-xs">
                {RECURSOS.filter(
                  (r) => r.destaque && (temRecurso(r, m.para) || PLANOS_COM_PRECO.some((x) => temRecurso(r, x))),
                ).map((r) => {
                  const tem = temRecurso(r, m.para)
                  const detalhe = r.detalhe?.[m.para]
                  return (
                    <li key={r.titulo} className="flex items-start gap-2">
                      {tem ? <Certo /> : <Errado />}
                      <span className={tem ? 'text-tinta-2' : 'text-tinta-3 line-through opacity-60'}>
                        {r.titulo}
                        {tem && detalhe && <strong className="font-semibold text-tinta"> — {detalhe}</strong>}
                        {r.quando === 'breve' && <span className="text-tinta-3"> (em breve)</span>}
                      </span>
                    </li>
                  )
                })}
              </ul>

              {!eOAtual && !contratoHoje && (m.ganha.length > 0 || m.perde.length > 0) && (
                <div className="flex flex-col gap-1 text-[11px]">
                  {m.ganha.length > 0 && <span className="text-bom">Passa a ter: {nomes(m.ganha)}</span>}
                  {m.perde.length > 0 && <span className="text-critico">Deixa de ter: {nomes(m.perde)}</span>}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {emTeste && (
        <p className="text-xs leading-relaxed text-tinta-3">
          Assinar é um pedido: a gente confirma o pagamento com você e o teste vira assinatura, com
          tudo o que já foi lançado. Escolha o {aVenda} — dá para trocar depois.
        </p>
      )}
      {!podeTrocar && <Aviso nivel="neutro">Só quem responde pela empresa muda o plano.</Aviso>}
    </div>
  )
}
