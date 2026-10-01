'use client'

// A ficha da cliente, em tela cheia, sem sair do balcão.
//
// ── por que aqui, e não um link para Clientes ────────────────
// "Quanto eu devo?", "quando paguei a de julho?", "meu telefone mudou" — é a
// conversa de toda cliente do crediário, e ela acontece COM A VENDA MONTADA.
// Sair para a página da ficha era perder o lugar (e, no tablet, a venda que a
// moça estava montando). Aqui a ficha abre por cima, Esc fecha, e o pedido
// está lá atrás do jeito que ficou. Abre pela cliente escolhida ou com Alt+N
// (com a cliente já escolhida — sem cliente, Alt+N continua sendo procurar).
//
// ── as quatro abas ───────────────────────────────────────────
// Resumo (o que ela deve em cada loja, vencido separado do carnê inteiro, e o
// botão de receber), Dados (completar o CPF que o carnê pede), Crediário (por
// compra, com a parcela paga e o dia em que foi paga — "eu paguei essa!" se
// resolve aqui) e Histórico (compras e pagamentos numa linha do tempo só).
//
// O que mostra vem de servidor/cliente.ts (`fichaNoBalcao`), com o alcance de
// cada tela: compra das lojas em que a pessoa vê venda, carnê das lojas em que
// ela vê crediário.

import { useEffect, useId, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Situacao, cx } from '@/ui/base'
import { plural } from '@/ui/texto'
import { ReceberParcelas } from '../crediario/ReceberParcelas'
import { ListaDeRecibos } from '../crediario/Recibos'
import type { CarneNaFicha, EventoNaFicha, FichaNoBalcao } from '@/servidor/cliente'
import { fichaDaClienteAcao, salvarDadosDaCliente, type DadosDaFicha } from './acoes'
import { brl } from './conta'
import { usePalavras } from './palavras'
import type { AbaDaFicha, Venda } from './useVenda'

const ABAS: { chave: AbaDaFicha; titulo: string }[] = [
  { chave: 'resumo', titulo: 'Resumo' },
  { chave: 'dados', titulo: 'Dados' },
  { chave: 'crediario', titulo: 'Crediário' },
  { chave: 'historico', titulo: 'Histórico' },
]

/** 'AAAA-MM-DD' → '25/09/26'. Dia de coluna `date`: sem fuso no meio (ver servidor/dia.ts). */
const diaCurto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`
/** Um instante, no dia de São Paulo. */
const quando = (d: Date | string) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' }).format(
    new Date(d),
  )
const telefoneBonito = (t: string | null) => {
  if (!t) return ''
  const d = t.replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return t
}
const cpfBonito = (c: string | null) => {
  const d = (c ?? '').replace(/\D/g, '')
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (c ?? '')
}

export function FichaDaCliente({ v, slug, unidadeId }: { v: Venda; slug: string; unidadeId: string }) {
  const aba = v.fichaAberta
  const cliente = v.cliente
  if (!aba || !cliente) return null
  return (
    <Ficha
      key={cliente.id}
      slug={slug}
      unidadeId={unidadeId}
      clienteId={cliente.id}
      nomeInicial={cliente.nome}
      aba={aba}
      aoTrocarAba={v.setFichaAberta}
      aoFechar={() => v.setFichaAberta(null)}
      aoSalvar={v.atualizarCliente}
    />
  )
}

function Ficha({
  slug,
  unidadeId,
  clienteId,
  nomeInicial,
  aba,
  aoTrocarAba,
  aoFechar,
  aoSalvar,
}: {
  slug: string
  unidadeId: string
  clienteId: string
  nomeInicial: string
  aba: AbaDaFicha
  aoTrocarAba: (a: AbaDaFicha) => void
  aoFechar: () => void
  aoSalvar: (d: { nome: string; telefone: string | null }) => void
}) {
  const p = usePalavras()
  const router = useRouter()
  const idTitulo = useId()
  const painel = useRef<HTMLDivElement>(null)
  const [ficha, setFicha] = useState<FichaNoBalcao | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [carregando, comecar] = useTransition()
  const [vez, setVez] = useState(0)
  /** A loja do "Receber parcelas" aberto, ou nula. */
  const [recebendo, setRecebendo] = useState<string | null>(null)
  const recebeu = useRef(false)

  useEffect(() => {
    let vivo = true
    setErro(null)
    comecar(async () => {
      try {
        const f = await fichaDaClienteAcao(slug, clienteId)
        if (!vivo) return
        if (f) setFicha(f)
        else setErro('Não achamos esta ficha. Ela pode ter sido juntada a outra ou desativada.')
      } catch {
        if (vivo) setErro('Não deu para abrir a ficha agora. Confira a internet e tente de novo.')
      }
    })
    return () => {
      vivo = false
    }
  }, [slug, clienteId, vez])

  // Esc fecha, o foco entra e volta, e a página de trás não rola — como a
  // Folha. Com o "Receber parcelas" aberto por cima, a tecla é dele.
  const fechar = useRef(aoFechar)
  useEffect(() => {
    fechar.current = aoFechar
  })
  useEffect(() => {
    const el = painel.current
    const antes = document.activeElement as HTMLElement | null
    const tecla = (e: KeyboardEvent) => {
      const janelas = document.querySelectorAll('[aria-modal="true"]:not([aria-hidden="true"])')
      if (el && janelas.length > 0 && janelas[janelas.length - 1] !== el) return
      if (e.key === 'Escape') {
        e.preventDefault()
        fechar.current()
      }
    }
    document.addEventListener('keydown', tecla)
    const rolagem = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    el?.focus()
    return () => {
      document.removeEventListener('keydown', tecla)
      document.body.style.overflow = rolagem
      if (antes && document.contains(antes)) antes.focus({ preventScroll: true })
    }
  }, [])

  const nome = ficha?.cliente.nome ?? nomeInicial
  const abas = ABAS.filter((a) => a.chave !== 'crediario' || ficha?.veCrediario !== false)

  if (typeof document === 'undefined') return null
  return createPortal(
    // z-[45], como a Folha: abaixo do "Receber parcelas" (46), que abre por
    // cima daqui, e da tranca de inatividade (60).
    <div className="fixed inset-0 z-[45] flex items-stretch justify-center sm:p-4">
      <div aria-hidden onClick={aoFechar} className="absolute inset-0 bg-nav/45 backdrop-blur-[2px]" />
      <div
        ref={painel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        tabIndex={-1}
        className="realce-alto relative flex h-dvh w-full max-w-5xl flex-col overflow-hidden border border-borda bg-superficie outline-none sm:h-auto sm:rounded-2xl"
      >
        <header className="flex shrink-0 flex-col gap-3 border-b border-borda-suave px-5 pt-4">
          <div className="flex items-start gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-xs font-semibold tracking-wide text-tinta-3 uppercase">Ficha {p.daPessoa}</span>
              <h2 id={idTitulo} className="truncate text-xl leading-tight font-bold">
                {nome}
              </h2>
              {ficha && (
                <span className="text-sm text-tinta-2">
                  {[
                    telefoneBonito(ficha.cliente.telefone) || 'sem telefone',
                    ficha.cliente.documento ? `CPF ${cpfBonito(ficha.cliente.documento)}` : 'sem CPF',
                    ficha.cliente.pontos > 0 ? plural(ficha.cliente.pontos, 'ponto', 'pontos') : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={aoFechar}
              aria-label="Fechar a ficha"
              title="Fechar (Esc)"
              className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-tinta-2 hover:bg-superficie-2 hover:text-tinta"
            >
              <svg aria-hidden width="18" height="18" viewBox="0 0 16 16" fill="none">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div role="tablist" aria-label="Partes da ficha" className="-mx-1 flex gap-1 overflow-x-auto px-1">
            {abas.map((a) => (
              <button
                key={a.chave}
                type="button"
                role="tab"
                aria-selected={aba === a.chave}
                onClick={() => aoTrocarAba(a.chave)}
                className={cx(
                  'min-h-11 shrink-0 border-b-2 px-4 text-sm font-semibold whitespace-nowrap transition-colors',
                  aba === a.chave ? 'border-marca text-tinta' : 'border-transparent text-tinta-3 hover:text-tinta',
                )}
              >
                {a.titulo}
                {a.chave === 'dados' && ficha && ficha.falta.length > 0 && (
                  <span aria-label=" (incompleto)" className="ml-1.5 inline-block size-2 rounded-full bg-atencao-vivo align-middle" />
                )}
              </button>
            ))}
          </div>
        </header>

        <div role="tabpanel" className="relative min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:max-h-[min(100dvh-12rem,48rem)] sm:min-h-[24rem]">
          {erro ? (
            <div className="flex flex-col items-start gap-3">
              <Aviso nivel="critico">{erro}</Aviso>
              <Botao tom="secundario" onClick={() => setVez((n) => n + 1)}>
                Tentar de novo
              </Botao>
            </div>
          ) : !ficha ? (
            <div className="flex flex-col gap-3" aria-busy>
              <span className="sr-only">Abrindo a ficha…</span>
              {[0, 1, 2].map((i) => (
                <span key={i} aria-hidden className="h-20 animate-pulse rounded-xl bg-superficie-2" />
              ))}
            </div>
          ) : aba === 'resumo' ? (
            <Resumo ficha={ficha} unidadeId={unidadeId} aoReceber={setRecebendo} aoCompletar={() => aoTrocarAba('dados')} />
          ) : aba === 'dados' ? (
            <Dados
              slug={slug}
              ficha={ficha}
              aoSalvar={(d) => {
                aoSalvar(d)
                setVez((n) => n + 1)
              }}
            />
          ) : aba === 'crediario' ? (
            <Crediario slug={slug} ficha={ficha} unidadeId={unidadeId} aoReceber={setRecebendo} />
          ) : (
            <Historico slug={slug} ficha={ficha} />
          )}
          {carregando && ficha && (
            <span className="absolute top-2 right-4 text-xs text-tinta-3" role="status">
              atualizando…
            </span>
          )}
        </div>
      </div>

      {recebendo && (
        <ReceberParcelas
          slug={slug}
          unidadeId={recebendo}
          clienteId={clienteId}
          aoReceber={() => {
            recebeu.current = true
          }}
          aoFechar={() => {
            setRecebendo(null)
            // Recebeu: a ficha e o balcão lá atrás (o "ela já deve", a barra
            // do caixa) mostram o saldo novo.
            if (recebeu.current) {
              recebeu.current = false
              setVez((n) => n + 1)
              router.refresh()
            }
          }}
        />
      )}
    </div>,
    document.body,
  )
}

// ─────────────────────────────────────────────────────────────
// RESUMO
// ─────────────────────────────────────────────────────────────

function Numero({ rotulo, valor, detalhe, nivel }: { rotulo: string; valor: string; detalhe?: ReactNode; nivel?: 'critico' | 'bom' }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-borda bg-superficie p-3">
      <span className="text-xs font-semibold tracking-wide text-tinta-3 uppercase">{rotulo}</span>
      <span className={cx('numero text-xl font-bold', nivel === 'critico' ? 'text-critico' : nivel === 'bom' ? 'text-bom' : 'text-tinta')}>
        {valor}
      </span>
      {detalhe && <span className="text-xs text-tinta-3">{detalhe}</span>}
    </div>
  )
}

function Resumo({
  ficha,
  unidadeId,
  aoReceber,
  aoCompletar,
}: {
  ficha: FichaNoBalcao
  unidadeId: string
  aoReceber: (unidadeId: string) => void
  aoCompletar: () => void
}) {
  const p = usePalavras()
  const r = ficha.resumo
  const dias = r.ultimaCompra ? Math.floor((Date.now() - new Date(r.ultimaCompra).getTime()) / 864e5) : null
  // A loja deste balcão primeiro: é a dívida que se recebe aqui.
  const lojas = [...r.lojas].sort((a, b) => (a.unidadeId === unidadeId ? -1 : b.unidadeId === unidadeId ? 1 : 0))
  return (
    <div className="flex flex-col gap-4">
      {ficha.falta.length > 0 && (
        <Aviso nivel="atencao">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>Cadastro incompleto: falta {ficha.falta.join(', ')}.</span>
            <button type="button" onClick={aoCompletar} className="font-semibold underline underline-offset-2">
              Completar agora
            </button>
          </span>
        </Aviso>
      )}

      {ficha.veCrediario && (
        <section aria-label="Crediário" className="flex flex-col gap-2">
          <h3 className="text-sm font-bold text-tinta">Crediário</h3>
          {lojas.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-borda bg-superficie p-3 text-sm text-tinta-2">
              <Situacao nivel="bom">em dia</Situacao>
              Nada em aberto{r.pagoCrediario > 0 ? ` · já pagou ${brl(r.pagoCrediario)} de crediário` : ''}.
            </div>
          ) : (
            lojas.map((l) => (
              <div key={l.unidadeId} className="flex flex-col gap-3 rounded-xl border border-borda bg-superficie p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-tinta">
                    {l.unidade}
                    {l.unidadeId === unidadeId && <span className="font-normal text-tinta-3"> · esta loja</span>}
                  </span>
                  {l.vencido > 0 ? (
                    <Situacao nivel="critico">{plural(l.parcelasVencidas, 'parcela vencida', 'parcelas vencidas')}</Situacao>
                  ) : (
                    <Situacao nivel="bom">em dia</Situacao>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Numero
                    rotulo="Vencido"
                    valor={brl(l.vencido)}
                    nivel={l.vencido > 0 ? 'critico' : 'bom'}
                    detalhe={l.atrasoHoje > 0 ? `+ ${brl(l.atrasoHoje)} de atraso hoje` : l.vencido > 0 ? undefined : 'nada vencido'}
                  />
                  <Numero rotulo="Carnê inteiro" valor={brl(l.aberto)} detalhe={plural(l.parcelasAbertas, 'parcela em aberto', 'parcelas em aberto')} />
                </div>
                {l.podeReceber && (
                  <Botao tom="confirmar" onClick={() => aoReceber(l.unidadeId)} className="min-h-12 self-start rounded-xl px-5 text-base">
                    Receber parcelas{lojas.length > 1 ? ` em ${l.unidade}` : ''}
                  </Botao>
                )}
              </div>
            ))
          )}
          {lojas.length > 0 && r.pagoCrediario > 0 && (
            <p className="text-sm text-tinta-2">
              Já pagou <b className="numero text-tinta">{brl(r.pagoCrediario)}</b> de crediário.
            </p>
          )}
        </section>
      )}

      <section aria-label="Compras" className="grid gap-2 sm:grid-cols-3">
        <Numero
          // "Compras aqui" na loja; "Atendimentos aqui" na clínica (vocabulario.ts).
          rotulo={`${p.Vendas === 'Vendas' ? 'Compras' : p.Vendas} aqui`}
          valor={String(r.compras)}
          detalhe={r.compras > 0 ? `${brl(r.gastou)} no total` : r.anteriores > 0 ? 'nenhuma ainda neste sistema' : 'nenhuma ainda'}
        />
        <Numero
          rotulo="Última"
          valor={dias === null ? '—' : dias === 0 ? 'hoje' : `há ${plural(dias, 'dia', 'dias')}`}
          detalhe={r.ultimaCompra ? quando(r.ultimaCompra) : undefined}
        />
        <Numero
          rotulo="Do sistema anterior"
          valor={String(r.anteriores)}
          detalhe={r.anteriores > 0 ? 'compras trazidas no carnê' : 'nenhuma trazida'}
        />
      </section>

      {(r.vales.length > 0 || ficha.cliente.pontos > 0) && (
        <section aria-label="Vales e pontos" className="grid gap-2 sm:grid-cols-2">
          {r.vales.length > 0 && (
            <div className="flex flex-col gap-1 rounded-xl border border-borda bg-superficie p-3">
              <span className="text-xs font-semibold tracking-wide text-tinta-3 uppercase">Vales de troca</span>
              <ul className="flex flex-col divide-y divide-borda-suave text-sm">
                {r.vales.map((x) => (
                  <li key={x.codigo} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-mono font-bold text-tinta">{x.codigo}</span>
                      <span className="text-xs text-tinta-3">
                        {[x.loja, x.validade ? `${x.vencido ? 'venceu' : 'vale até'} ${diaCurto(x.validade)}` : 'sem validade'].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className={cx('numero font-semibold', x.vencido ? 'text-tinta-3 line-through' : 'text-bom')}>{brl(x.saldo)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {ficha.cliente.pontos > 0 && <Numero rotulo="Pontos" valor={ficha.cliente.pontos.toLocaleString('pt-BR')} detalhe="o pagamento oferece usar" />}
        </section>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// DADOS
// ─────────────────────────────────────────────────────────────

const doCadastro = (f: FichaNoBalcao): DadosDaFicha => ({
  nome: f.cliente.nome,
  telefone: telefoneBonito(f.cliente.telefone),
  documento: cpfBonito(f.cliente.documento),
  email: f.cliente.email ?? '',
  nascimento: f.cliente.nascimento,
  endereco: f.cliente.endereco ?? '',
  numero: f.cliente.numero ?? '',
  bairro: f.cliente.bairro ?? '',
  cidade: f.cliente.cidade ?? '',
  estado: f.cliente.estado ?? '',
  cep: f.cliente.cep ?? '',
})

function Dados({ slug, ficha, aoSalvar }: { slug: string; ficha: FichaNoBalcao; aoSalvar: (d: { nome: string; telefone: string | null }) => void }) {
  const p = usePalavras()
  const id = useId()
  // O que foi digitado fica no campo mesmo se o servidor recusar (CPF que não
  // confere, telefone de outra pessoa): apagar faria a moça digitar tudo de novo.
  const [d, setD] = useState<DadosDaFicha>(() => doCadastro(ficha))
  const [erro, setErro] = useState<string | null>(null)
  const [salvo, setSalvo] = useState(false)
  const [indo, comecar] = useTransition()
  const muda = (k: keyof DadosDaFicha) => (e: { target: { value: string } }) => {
    setD((x) => ({ ...x, [k]: e.target.value }))
    setSalvo(false)
  }

  if (ficha.cliente.anonimizado) {
    return <Aviso nivel="neutro">Este cadastro foi anonimizado a pedido do titular e não se edita mais.</Aviso>
  }

  const campo = (k: keyof DadosDaFicha, rotulo: string, extra: Record<string, unknown> = {}, larga = false) => (
    <label key={k} htmlFor={`${id}-${k}`} className={cx('flex min-w-0 flex-col gap-1.5', larga && 'sm:col-span-2')}>
      <span className="text-sm font-medium text-tinta">{rotulo}</span>
      <input
        id={`${id}-${k}`}
        value={d[k]}
        onChange={muda(k)}
        autoComplete="off"
        className="h-11 w-full min-w-0 rounded-norte border border-borda bg-superficie px-3 text-sm text-tinta placeholder:text-tinta-3"
        {...extra}
      />
    </label>
  )

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        setErro(null)
        comecar(async () => {
          const r = await salvarDadosDaCliente(slug, ficha.cliente.id, d)
          if (!r.ok) return setErro(r.erro)
          setSalvo(true)
          aoSalvar({ nome: d.nome.trim(), telefone: d.telefone.replace(/\D/g, '') || null })
        })
      }}
    >
      {ficha.falta.length > 0 && (
        <Aviso nivel="atencao">
          Falta {ficha.falta.join(', ')}. O carnê do crediário sai com o CPF e o endereço {p.daPessoa}.
        </Aviso>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {campo('nome', 'Nome', { required: true }, true)}
        {campo('telefone', 'WhatsApp', { inputMode: 'tel', placeholder: '(71) 99999-0000' })}
        {campo('documento', 'CPF', { inputMode: 'numeric', placeholder: '000.000.000-00' })}
        {campo('nascimento', 'Nascimento', { type: 'date' })}
        {campo('email', 'E-mail', { type: 'email', inputMode: 'email' })}
      </div>
      <fieldset className="grid gap-3 sm:grid-cols-[1fr_7rem]">
        <legend className="mb-2 text-sm font-bold text-tinta">Endereço</legend>
        {campo('endereco', 'Rua')}
        {campo('numero', 'Número')}
        {campo('bairro', 'Bairro')}
        {campo('cep', 'CEP', { inputMode: 'numeric' })}
        {campo('cidade', 'Cidade')}
        {campo('estado', 'UF', { maxLength: 2, placeholder: 'BA' })}
      </fieldset>
      {erro && <Aviso nivel="critico">{erro}</Aviso>}
      {salvo && <Aviso nivel="bom">Cadastro salvo.</Aviso>}
      <Botao type="submit" tom="confirmar" carregando={indo} className="min-h-12 self-start rounded-xl px-6 text-base">
        Salvar o cadastro
      </Botao>
    </form>
  )
}

// ─────────────────────────────────────────────────────────────
// CREDIÁRIO
// ─────────────────────────────────────────────────────────────

function Crediario({
  slug,
  ficha,
  unidadeId,
  aoReceber,
}: {
  slug: string
  ficha: FichaNoBalcao
  unidadeId: string
  aoReceber: (unidadeId: string) => void
}) {
  const abertos = ficha.carnes.filter((k) => k.aberto > 0)
  const pagos = ficha.carnes.filter((k) => k.aberto <= 0)
  // A loja deste balcão primeiro, como no Resumo.
  const lojasQueRecebem = ficha.resumo.lojas
    .filter((l) => l.podeReceber)
    .sort((a, b) => (a.unidadeId === unidadeId ? -1 : b.unidadeId === unidadeId ? 1 : 0))
  if (ficha.carnes.length === 0) {
    return <p className="text-sm text-tinta-2">Nenhuma compra no crediário{ficha.recibos.length > 0 ? '' : ' até agora'}.</p>
  }
  return (
    <div className="flex flex-col gap-4">
      {lojasQueRecebem.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {lojasQueRecebem.map((l) => (
            <Botao key={l.unidadeId} tom="confirmar" onClick={() => aoReceber(l.unidadeId)} className="min-h-11 rounded-xl">
              Receber parcelas{lojasQueRecebem.length > 1 ? ` em ${l.unidade}` : ''}
            </Botao>
          ))}
        </div>
      )}
      {abertos.map((k) => (
        <Carne key={k.vendaId} slug={slug} k={k} aberto />
      ))}
      {pagos.length > 0 && (
        <details className="group flex flex-col gap-3">
          <summary className="cursor-pointer text-sm font-semibold text-marca select-none">
            {plural(pagos.length, 'compra quitada', 'compras quitadas')} — ver as parcelas pagas
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {pagos.map((k) => (
              <Carne key={k.vendaId} slug={slug} k={k} />
            ))}
          </div>
        </details>
      )}
      {ficha.recibos.length > 0 && (
        <section aria-label="Recibos" className="flex flex-col gap-2">
          <h3 className="text-sm font-bold text-tinta">Recibos</h3>
          <ListaDeRecibos slug={slug} recibos={ficha.recibos} />
        </section>
      )}
    </div>
  )
}

function Carne({ slug, k, aberto = false }: { slug: string; k: CarneNaFicha; aberto?: boolean }) {
  return (
    <section className="flex flex-col overflow-hidden rounded-xl border border-borda bg-superficie">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-borda-suave bg-superficie-2 px-3 py-2">
        <span className="flex min-w-0 flex-col">
          <span className="text-sm font-semibold text-tinta">
            {/* O número do carnê trazido é o mesmo do "Receber" e do recibo. */}
            {k.importada ? `Carnê do sistema anterior · nº ${k.vendaNumero}` : `Compra nº ${k.vendaNumero}`}
            {k.criadaEm && !k.importada && <span className="font-normal text-tinta-3"> · {quando(k.criadaEm)}</span>}
          </span>
          <span className="text-xs text-tinta-3">
            {k.unidade} · {plural(k.parcelas.length, 'parcela', 'parcelas')}
            {k.pago > 0 ? ` · pagou ${brl(k.pago)}` : ''}
          </span>
        </span>
        {aberto ? (
          <span className="flex flex-col items-end">
            <span className="numero text-sm font-bold text-tinta">{brl(k.aberto)} em aberto</span>
            {k.vencido > 0 && <span className="numero text-xs font-semibold text-critico">{brl(k.vencido)} vencido</span>}
          </span>
        ) : (
          <Situacao nivel="bom">quitada</Situacao>
        )}
      </header>
      <ul className="flex flex-col divide-y divide-borda-suave text-sm">
        {k.parcelas.map((x) => {
          const ultimo = x.pagamentos.at(-1)
          return (
            <li key={x.id} className="grid grid-cols-[3.25rem_1fr_auto] items-start gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="numero pt-0.5 font-semibold text-tinta-2">
                {x.numero}/{x.de}
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-tinta">
                  vence {diaCurto(x.vencimento)}
                  {x.situacao === 'quitada' ? (
                    <span className="text-bom">
                      {' '}
                      · paga{ultimo || x.quitadaEm ? ` em ${quando(ultimo?.quando ?? x.quitadaEm!)}` : ''}
                    </span>
                  ) : x.situacao === 'vencida' ? (
                    <span className="font-semibold text-critico"> · {plural(x.diasAtraso, 'dia', 'dias')} de atraso</span>
                  ) : (
                    <span className="text-tinta-3"> · em dia</span>
                  )}
                </span>
                {/* Cada pagamento que abateu esta parcela: o dia, quanto, e o
                    recibo para reimprimir — é a prova do "eu paguei essa!". */}
                {x.pagamentos.length > 0 && (
                  <span className="flex flex-wrap gap-x-3 text-xs text-tinta-3">
                    {x.pagamentos.map((g, i) => (
                      <span key={i}>
                        {g.externo ? 'pago fora' : 'pagou'} {brl(g.valor)} em {quando(g.quando)}
                        {g.reciboId && (
                          <>
                            {' · '}
                            <a
                              href={`/${slug}/crediario/recibo/${g.reciboId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="font-semibold text-marca underline-offset-2 hover:underline"
                            >
                              recibo {g.recibo}
                            </a>
                          </>
                        )}
                      </span>
                    ))}
                  </span>
                )}
              </span>
              <span className="flex flex-col items-end">
                <span className={cx('numero font-semibold', x.situacao === 'quitada' ? 'text-tinta-3' : x.situacao === 'vencida' ? 'text-critico' : 'text-tinta')}>
                  {x.situacao === 'quitada' ? brl(x.valor) : brl(x.resta)}
                </span>
                {x.situacao !== 'quitada' && x.pago > 0 && <span className="numero text-[11px] text-tinta-3">de {brl(x.valor)}</span>}
                {x.atrasoHoje > 0 && <span className="numero text-[11px] text-critico">+ {brl(x.atrasoHoje)} atraso</span>}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────
// HISTÓRICO
// ─────────────────────────────────────────────────────────────

type Filtro = 'tudo' | 'compra' | 'pagamento'

function Historico({ slug, ficha }: { slug: string; ficha: FichaNoBalcao }) {
  const [filtro, setFiltro] = useState<Filtro>('tudo')
  const [loja, setLoja] = useState<string>('')
  const [busca, setBusca] = useState('')
  const lojas = useMemo(() => [...new Set(ficha.historico.map((e) => e.unidade))].sort(), [ficha.historico])
  const termo = busca.trim().toLowerCase()
  const eventos = ficha.historico.filter(
    (e) =>
      (filtro === 'tudo' || e.tipo === filtro) &&
      (!loja || e.unidade === loja) &&
      (!termo || `${e.titulo} ${e.detalhe}`.toLowerCase().includes(termo)),
  )
  const fichaChip = (valor: Filtro, rotulo: string) => (
    <button
      key={valor}
      type="button"
      aria-pressed={filtro === valor}
      onClick={() => setFiltro(valor)}
      className={cx(
        'min-h-10 rounded-full border px-4 text-sm font-semibold',
        filtro === valor ? 'border-marca/40 bg-marca-suave text-marca' : 'border-borda text-tinta-2 hover:bg-superficie-2',
      )}
    >
      {rotulo}
    </button>
  )

  if (ficha.historico.length === 0) return <p className="text-sm text-tinta-2">Nada ainda: nem compra, nem pagamento.</p>

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {fichaChip('tudo', 'Tudo')}
        {fichaChip('compra', 'Compras')}
        {ficha.veCrediario && fichaChip('pagamento', 'Pagamentos')}
        {lojas.length > 1 && (
          <select
            value={loja}
            onChange={(e) => setLoja(e.target.value)}
            aria-label="Loja"
            className="min-h-10 rounded-full border border-borda bg-superficie px-3 text-sm text-tinta"
          >
            <option value="">todas as lojas</option>
            {lojas.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        )}
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Procurar peça…"
          aria-label="Procurar no histórico"
          className="min-h-10 min-w-0 flex-1 rounded-full border border-borda bg-superficie px-4 text-sm text-tinta placeholder:text-tinta-3"
        />
      </div>
      {eventos.length === 0 ? (
        <p className="text-sm text-tinta-2">Nada com esses filtros.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-borda-suave rounded-xl border border-borda bg-superficie text-sm">
          {eventos.map((e) => (
            <LinhaDoHistorico key={e.id} e={e} slug={slug} />
          ))}
        </ul>
      )}
      {ficha.historico.length >= 120 && <p className="text-xs text-tinta-3">Mostrando os 120 mais recentes.</p>}
    </div>
  )
}

function LinhaDoHistorico({ e, slug }: { e: EventoNaFicha; slug: string }) {
  const href = e.tipo === 'compra' ? `/${slug}/vendas/${e.vendaId}` : e.reciboId ? `/${slug}/crediario/recibo/${e.reciboId}` : null
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2.5">
      <span className="flex min-w-0 flex-col">
        <span className="flex flex-wrap items-center gap-x-2 text-tinta">
          <Situacao nivel={e.tipo === 'compra' ? 'neutro' : 'bom'}>{e.tipo === 'compra' ? 'compra' : 'pagamento'}</Situacao>
          {/* Abre em outra aba: a venda montada no balcão fica onde está. */}
          {href ? (
            <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold text-marca underline-offset-2 hover:underline">
              {e.titulo}
            </a>
          ) : (
            <span className="font-semibold">{e.titulo}</span>
          )}
        </span>
        <span className="line-clamp-2 text-xs text-tinta-3">
          {quando(e.quando)} · {e.unidade}
          {e.detalhe ? ` · ${e.detalhe}` : ''}
        </span>
      </span>
      <span className={cx('numero shrink-0 font-semibold', e.tipo === 'pagamento' ? 'text-bom' : 'text-tinta')}>{brl(e.valor)}</span>
    </li>
  )
}
