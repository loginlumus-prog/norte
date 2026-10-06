import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Aviso, Situacao } from '@/ui/base'
import { mostrar } from '@/servidor/dinheiro'
import { PRECOS } from '@/servidor/planos'
import { enderecoPublico } from '@/servidor/requisicao'
import {
  CARENCIA_DIAS,
  DESCONTO_PRIMEIRA_PCT,
  DIA_DO_REPASSE,
  FAIXAS,
  MINIMO_REPASSE,
  NIVEL2_PCT,
  NOME_DO_PIX,
  mostrarDocumento,
  painelDoParceiro,
  sessaoDoParceiroVale,
  type Painel,
} from '@/servidor/parceiros'
import { lerSessaoParceiro } from '@/servidor/sessao-parceiro'
import { Casca } from '../Casca'
import { sairAcao } from '../acoes'
import { Copiar, FormPagamento } from './Pecas'

// O painel do parceiro: só a rede dele. O que ele vê de cada empresa é o nome,
// a situação e o que ganhou com ela — nada de dentro do sistema da loja.

export const metadata: Metadata = { title: 'Meu painel · Parceiros do Norte' }

const data = (d: Date) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' }).format(d)
const diaMes = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`
const mes = (ref: string) => {
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return `${nomes[Number(ref.slice(5, 7)) - 1]}/${ref.slice(2, 4)}`
}

const SITUACAO_CLIENTE = {
  teste: { nivel: 'neutro', texto: 'Em teste' },
  pagando: { nivel: 'bom', texto: 'Pagando' },
  parou: { nivel: 'atencao', texto: 'Parou de pagar' },
} as const

const SITUACAO_COMISSAO = {
  carencia: { nivel: 'neutro', texto: 'Em carência' },
  liberada: { nivel: 'atencao', texto: 'Liberada' },
  paga: { nivel: 'bom', texto: 'Paga' },
  estornada: { nivel: 'critico', texto: 'Cancelada' },
} as const

function Numero({ rotulo, valor, nota, forte }: { rotulo: string; valor: string; nota?: string; forte?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-semibold tracking-wide text-tinta-3 uppercase">{rotulo}</span>
      <span className={'font-extrabold tracking-tight tabular-nums ' + (forte ? 'text-3xl text-titulo' : 'text-2xl text-tinta')}>{valor}</span>
      {nota && <span className="text-xs text-tinta-2">{nota}</span>}
    </div>
  )
}

function Bloco({ titulo, sub, children, id }: { titulo: string; sub?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="flex scroll-mt-20 flex-col gap-4">
      <header className="flex flex-col gap-1 border-b border-borda pb-2">
        <h2 className="text-[17px] font-bold tracking-tight text-titulo">{titulo}</h2>
        {sub && <p className="text-sm text-tinta-2">{sub}</p>}
      </header>
      {children}
    </section>
  )
}

function Nivel({ p }: { p: Painel }) {
  const max = FAIXAS[FAIXAS.length - 1]!.pct
  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-borda bg-superficie p-5 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold tracking-wide text-tinta-3 uppercase">Sua porcentagem</span>
        <span className="text-xs text-tinta-2">
          {p.ativos} {p.ativos === 1 ? 'cliente pagando' : 'clientes pagando'}
        </span>
      </div>
      <span className="text-5xl font-extrabold tracking-tight text-titulo tabular-nums">{p.faixa.pct}%</span>
      {/* A régua das faixas, com a de agora acesa. */}
      <div className="flex gap-1" aria-hidden>
        {FAIXAS.map((f) => (
          <span key={f.pct} className={'h-2 flex-1 rounded-full ' + (f.pct <= p.faixa.pct ? 'bg-marca' : 'bg-superficie-3')} />
        ))}
      </div>
      <p className="text-sm text-tinta-2">
        {p.faixa.proxima
          ? `Faltam ${p.faixa.proxima.faltam} ${p.faixa.proxima.faltam === 1 ? 'cliente pagando' : 'clientes pagando'} para ${p.faixa.proxima.pct}%.`
          : `Você está na faixa mais alta (${max}%).`}{' '}
        Mais {NIVEL2_PCT}% sobre os clientes da sua rede.
      </p>
    </div>
  )
}

export default async function PainelParceiro({ searchParams }: { searchParams: Promise<{ novo?: string }> }) {
  const s = await lerSessaoParceiro()
  if (!s || !(await sessaoDoParceiroVale(s.id, s.nasceu))) redirect('/parceiros/entrar')
  const p = await painelDoParceiro(s.id)
  if (!p) redirect('/parceiros/entrar')
  const { novo } = await searchParams

  const base = (await enderecoPublico()) ?? 'https://gestornorte.com'
  const linkLoja = `${base}/?ref=${p.parceiro.codigo}`
  const linkParceiro = `${base}/parceiros?ref=${p.parceiro.codigo}`
  const mensagem =
    `Oi! Conhece o Norte? É um sistema para loja: balcão, estoque, financeiro e um assistente no WhatsApp que manda o resumo do dia. ` +
    `Dá para testar ${PRECOS.diasDeTeste} dias grátis, sem cartão, e pelo meu link a primeira mensalidade sai com ${DESCONTO_PRIMEIRA_PCT}% de desconto: ${linkLoja}`
  const primeiroNome = p.parceiro.nome.trim().split(/\s+/)[0]

  return (
    <Casca
      largo
      direita={
        <form action={sairAcao}>
          <button type="submit" className="text-sm font-medium text-tinta-2 hover:text-tinta">
            Sair
          </button>
        </form>
      }
    >
      <div className="flex flex-col gap-10">
        <header className="flex flex-col gap-1">
          <h1 className="text-[clamp(1.6rem,3vw,2.2rem)] font-extrabold tracking-[-0.03em] text-titulo">Olá, {primeiroNome}</h1>
          <p className="text-[15px] text-tinta-2">
            Seu código: <b className="font-mono text-tinta">{p.parceiro.codigo}</b> · parceiro desde {data(p.parceiro.desde)}
          </p>
        </header>

        {novo && (
          <Aviso nivel="bom">
            Conta criada. Copie o seu link abaixo e mande para quem tem loja — e cadastre a chave Pix para receber.
          </Aviso>
        )}
        {!p.parceiro.pixChave && (
          <Aviso nivel="atencao">
            Falta a chave Pix. Sem ela o dinheiro fica guardado e não sai. <a href="#receber" className="underline">Cadastrar agora</a>
          </Aviso>
        )}

        {/* ── o resumo ── */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
          <Nivel p={p} />
          <div className="grid grid-cols-2 gap-x-6 gap-y-6 rounded-3xl border border-borda bg-superficie p-5 sm:grid-cols-4 sm:p-6">
            <Numero rotulo="Liberado" valor={mostrar(p.totais.liberadoCent)} nota="Sai no próximo Pix" forte />
            <Numero rotulo="Em carência" valor={mostrar(p.totais.carenciaCent)} nota={`Libera em ${CARENCIA_DIAS} dias`} />
            <Numero rotulo="Já recebido" valor={mostrar(p.totais.pagoCent)} />
            <Numero rotulo="Ganho no mês" valor={mostrar(p.totais.doMesCent)} />
            <div className="col-span-2 rounded-2xl bg-superficie-2 px-4 py-3 text-sm text-tinta-2 sm:col-span-4">
              {p.proximoRepasse ? (
                <>
                  Próximo Pix: <b className="text-tinta">{diaMes(p.proximoRepasse.dia)}</b>, cerca de{' '}
                  <b className="text-tinta">{mostrar(p.proximoRepasse.valorCent)}</b>
                  {p.proximoRepasse.faltaPix ? ' — cadastre a chave Pix para receber.' : '.'}
                </>
              ) : (
                <>
                  O Pix sai todo dia {DIA_DO_REPASSE}, quando o liberado chega a {mostrar(MINIMO_REPASSE * 100)}. Até lá, acumula.
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── os links ── */}
        <Bloco titulo="Seus links" sub="Quem abre o link fica marcado como seu por 90 dias.">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-borda bg-superficie p-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-bold text-titulo">Para lojas</span>
                <span className="text-xs text-tinta-2">
                  A loja testa {PRECOS.diasDeTeste} dias e paga metade da primeira mensalidade.
                </span>
              </div>
              <code className="truncate rounded-xl bg-superficie-2 px-3 py-2.5 text-sm text-tinta">{linkLoja}</code>
              <div className="flex flex-wrap gap-2">
                <Copiar texto={linkLoja} rotulo="Copiar link" copiado="Link copiado" />
                <Copiar texto={mensagem} rotulo="Copiar mensagem pronta" copiado="Mensagem copiada" />
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(mensagem)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded-norte border border-borda px-3 py-2 text-sm font-semibold text-tinta hover:bg-superficie-2"
                >
                  Mandar no WhatsApp
                </a>
              </div>
            </div>
            <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-borda bg-superficie p-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-bold text-titulo">Para novos parceiros</span>
                <span className="text-xs text-tinta-2">Você ganha {NIVEL2_PCT}% das mensalidades dos clientes deles.</span>
              </div>
              <code className="truncate rounded-xl bg-superficie-2 px-3 py-2.5 text-sm text-tinta">{linkParceiro}</code>
              <div className="flex flex-wrap gap-2">
                <Copiar texto={linkParceiro} rotulo="Copiar link de convite" copiado="Link copiado" />
              </div>
            </div>
          </div>
        </Bloco>

        {/* ── os clientes ── */}
        <Bloco titulo="Seus clientes" sub="As empresas que se cadastraram pelo seu link ou código.">
          {p.indicacoes.length === 0 ? (
            <p className="rounded-2xl bg-superficie-2 px-4 py-6 text-center text-sm text-tinta-2">
              Ainda ninguém. Mande o link para três lojas que você conhece hoje.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-borda bg-superficie">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="bg-superficie-2 text-xs text-tinta-2">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Empresa</th>
                    <th className="px-4 py-2.5 font-semibold">Chegou em</th>
                    <th className="px-4 py-2.5 font-semibold">Situação</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Você ganhou</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {p.indicacoes.map((i) => (
                    <tr key={i.id} className="border-t border-borda">
                      <td className="px-4 py-2.5 font-medium text-tinta">{i.empresa}</td>
                      <td className="px-4 py-2.5 text-tinta-2">{data(i.desde)}</td>
                      <td className="px-4 py-2.5">
                        <Situacao nivel={SITUACAO_CLIENTE[i.situacao].nivel}>{SITUACAO_CLIENTE[i.situacao].texto}</Situacao>
                      </td>
                      <td className="px-4 py-2.5 text-right font-semibold">{mostrar(i.ganhoCent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Bloco>

        {/* ── a rede ── */}
        <Bloco titulo="Sua rede" sub={`Parceiros que entraram pelo seu convite. Você ganha ${NIVEL2_PCT}% sobre os clientes deles.`}>
          {p.rede.length === 0 ? (
            <p className="rounded-2xl bg-superficie-2 px-4 py-6 text-center text-sm text-tinta-2">
              Ninguém ainda. Conhece alguém que vende para lojas — contador, representante, consultor? Mande o link de convite.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-borda bg-superficie">
              <table className="w-full min-w-[440px] text-left text-sm">
                <thead className="bg-superficie-2 text-xs text-tinta-2">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Parceiro</th>
                    <th className="px-4 py-2.5 font-semibold">Desde</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Indicou</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Pagando</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {p.rede.map((r) => (
                    <tr key={r.id} className="border-t border-borda">
                      <td className="px-4 py-2.5 font-medium text-tinta">{r.nome}</td>
                      <td className="px-4 py-2.5 text-tinta-2">{data(r.desde)}</td>
                      <td className="px-4 py-2.5 text-right">{r.indicadas}</td>
                      <td className="px-4 py-2.5 text-right font-semibold">{r.ativas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {p.totais.nivel2Cent > 0 && (
            <p className="text-sm text-tinta-2">
              Ganho com a rede até hoje: <b className="text-tinta">{mostrar(p.totais.nivel2Cent)}</b>
            </p>
          )}
        </Bloco>

        {/* ── as comissões ── */}
        <Bloco titulo="Comissões" sub="Uma linha por mensalidade paga.">
          {p.comissoes.length === 0 ? (
            <p className="rounded-2xl bg-superficie-2 px-4 py-6 text-center text-sm text-tinta-2">
              A primeira aparece aqui quando um cliente seu pagar a mensalidade.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-borda bg-superficie">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead className="bg-superficie-2 text-xs text-tinta-2">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">Mês</th>
                    <th className="px-4 py-2.5 font-semibold">Cliente</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Mensalidade</th>
                    <th className="px-4 py-2.5 text-right font-semibold">%</th>
                    <th className="px-4 py-2.5 text-right font-semibold">Comissão</th>
                    <th className="px-4 py-2.5 font-semibold">Situação</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {p.comissoes.map((c) => (
                    <tr key={c.id} className="border-t border-borda">
                      <td className="px-4 py-2.5 text-tinta-2">{mes(c.referencia)}</td>
                      <td className="px-4 py-2.5 text-tinta">
                        {c.empresa}
                        {c.nivel === 2 && <span className="ml-1.5 text-xs text-tinta-3">(rede)</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right text-tinta-2">{mostrar(c.baseCent)}</td>
                      <td className="px-4 py-2.5 text-right text-tinta-2">{c.pct}%</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-tinta">{mostrar(c.valorCent)}</td>
                      <td className="px-4 py-2.5">
                        <Situacao nivel={SITUACAO_COMISSAO[c.situacao].nivel}>
                          {c.situacao === 'carencia' ? `Libera ${data(c.liberaEm)}` : SITUACAO_COMISSAO[c.situacao].texto}
                        </Situacao>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Bloco>

        {/* ── os Pix ── */}
        {p.repasses.length > 0 && (
          <Bloco titulo="Pix recebidos">
            <ul className="flex flex-col divide-y divide-borda rounded-2xl border border-borda bg-superficie">
              {p.repasses.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <span className="text-tinta-2">
                    {data(r.pagoEm)} · {r.pixChave}
                    {r.comprovante && <span className="ml-2 text-xs text-tinta-3">{r.comprovante}</span>}
                  </span>
                  <b className="tabular-nums text-tinta">{mostrar(r.valorCent)}</b>
                </li>
              ))}
            </ul>
          </Bloco>
        )}

        {/* ── receber ── */}
        <Bloco
          id="receber"
          titulo="Dados para receber"
          sub={`O Pix sai todo dia ${DIA_DO_REPASSE}, só para a chave do próprio parceiro.`}
        >
          {p.parceiro.pixChave && (
            <p className="text-sm text-tinta-2">
              Hoje: <b className="text-tinta">{NOME_DO_PIX[p.parceiro.pixTipo ?? 'aleatoria']}</b> {p.parceiro.pixChave}
              {p.parceiro.documento ? ` · ${mostrarDocumento(p.parceiro.documento)}` : ''}
            </p>
          )}
          <FormPagamento
            inicial={{
              pixTipo: p.parceiro.pixTipo ?? '',
              pixChave: p.parceiro.pixChave ?? '',
              documento: mostrarDocumento(p.parceiro.documento),
              telefone: p.parceiro.telefone ?? '',
            }}
          />
        </Bloco>

        <p className="text-xs text-tinta-3">
          Dúvidas sobre comissão ou pagamento? Fale com a equipe do Norte. As regras completas estão nos{' '}
          <a href="/parceiros/termos" className="underline">
            termos do programa
          </a>
          .
        </p>
      </div>
    </Casca>
  )
}
