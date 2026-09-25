'use client'

// Abrir e fechar o caixa.
//
// O fechamento mostra o esperado ANTES de a pessoa digitar o contado — e essa
// ordem é decisão, não acaso. Se o sistema mostra o número primeiro, quem está
// com pressa digita aquele número e a conferência vira teatro. Aqui ela conta
// a gaveta, digita, e só então o sistema diz se bateu.

import { useState, useTransition } from 'react'
import { Botao, Campo, Aviso, cx } from '@/ui/base'
import { abrir, fechar, movimentar } from './acoes'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function AbrirCaixa({
  slug,
  unidadeId,
  unidadeNome,
}: {
  slug: string
  unidadeId: string
  unidadeNome: string
}) {
  const [saldo, setSaldo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()

  function abrirAgora() {
    comecar(async () => {
      setErro(null)
      const r = await abrir(slug, unidadeId, Number(saldo) || 0)
      if (!r.ok) setErro(`Já existe um caixa aberto aqui, por ${r.abertoPor}.`)
    })
  }

  // No lugar da tela de venda, e não em cima dela: com o caixa fechado não há
  // venda para mostrar, e um cartão no meio da tela diz isso sem precisar de
  // aviso vermelho. Os valores prontos são os trocos de abertura mais comuns
  // — no tablet, digitar "100,00" com o dedo é o que ninguém quer às 8h.
  return (
    <div className="flex min-h-[60dvh] items-center justify-center py-6">
      <div className="realce-alto flex w-full max-w-md flex-col gap-5 rounded-2xl border border-borda bg-superficie p-6 sm:p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <span aria-hidden className="flex size-14 items-center justify-center rounded-2xl bg-marca-suave text-marca">
            <svg viewBox="0 0 24 24" className="size-7" fill="none">
              <rect x="3" y="10" width="18" height="10" rx="2" stroke="currentColor" strokeWidth="1.7" />
              <path d="M7 10V6.5A1.5 1.5 0 018.5 5h7A1.5 1.5 0 0117 6.5V10M10 15h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </span>
          <h2 className="text-2xl font-extrabold">Abrir o caixa</h2>
          <p className="text-sm text-tinta-2">
            {unidadeNome} — sem caixa aberto não dá para vender. É assim que o dinheiro do dia
            tem dono e hora.
          </p>
        </div>

        {erro && <Aviso nivel="critico">{erro}</Aviso>}

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            abrirAgora()
          }}
        >
          <Campo
            rotulo="Quanto tem na gaveta agora"
            name="saldo"
            type="number"
            step={0.01}
            min={0}
            inputMode="decimal"
            autoFocus
            value={saldo}
            onChange={(e) => setSaldo(e.target.value)}
            placeholder="0,00"
            dica="O troco que ficou de ontem. Se começou zerado, deixe 0."
            className="numero h-14 rounded-xl text-2xl font-bold"
          />

          <div role="group" aria-label="Valores comuns" className="grid grid-cols-4 gap-2">
            {[0, 50, 100, 200].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSaldo(String(n))}
                aria-pressed={saldo !== '' && Number(saldo) === n}
                className={cx(
                  'numero min-h-11 rounded-xl border text-sm font-semibold transition-colors',
                  saldo !== '' && Number(saldo) === n
                    ? 'border-marca bg-marca-suave text-tinta'
                    : 'border-borda bg-superficie text-tinta-2 hover:bg-superficie-2',
                )}
              >
                {n === 0 ? 'Zerado' : brl(n).replace(',00', '')}
              </button>
            ))}
          </div>

          <Botao type="submit" tom="confirmar" largo carregando={indo} className="min-h-14 rounded-xl text-base">
            {indo ? 'Abrindo...' : 'Abrir caixa e começar a vender'}
          </Botao>
        </form>
      </div>
    </div>
  )
}

export function FecharCaixa({
  slug,
  caixaId,
  conferencia,
}: {
  slug: string
  caixaId: string
  conferencia: {
    abertura: number
    dinheiroVendido: number
    dinheiroRecebido: number
    recebidoCrediario: number
    suprimentos: number
    sangrias: number
    esperado: number
    vendidoTotal: number
    porForma: { forma: string; total: number }[]
    vendas: number
  }
}) {
  const [contado, setContado] = useState('')
  const [obs, setObs] = useState('')
  const [feito, setFeito] = useState<{ diferenca: number; esperado: number } | null>(null)
  const [indo, comecar] = useTransition()

  if (feito) {
    const zerou = Math.abs(feito.diferenca) < 0.005
    return (
      <Aviso nivel={zerou ? 'bom' : 'critico'}>
        {zerou
          ? `Caixa fechado certinho, ${brl(feito.esperado)}.`
          : `Caixa fechado com ${feito.diferenca > 0 ? 'sobra' : 'falta'} de ${brl(Math.abs(feito.diferenca))}.`}
      </Aviso>
    )
  }

  // A chave é obrigatória porque este helper também é usado dentro de .map().
  // Sem ela o React reclama e, pior, pode reaproveitar a linha errada quando a
  // lista muda de tamanho.
  const linha = (r: string, v: number, forte?: boolean) => (
    <div
      key={r}
      className={cx(
        'flex justify-between gap-4 py-1.5 text-sm',
        forte ? 'border-t border-borda pt-2 font-bold text-tinta' : 'text-tinta-2',
      )}
    >
      <span>{r}</span>
      <span className="numero">{brl(v)}</span>
    </div>
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-norte border border-borda bg-superficie p-4">
          <h3 className="mb-2 text-sm font-bold">O que passou pela gaveta</h3>
          {linha('Abertura', conferencia.abertura)}
          {linha('Vendas em dinheiro', conferencia.dinheiroVendido)}
          {conferencia.dinheiroRecebido > 0 && linha('Crediário recebido em dinheiro', conferencia.dinheiroRecebido)}
          {linha('Suprimentos', conferencia.suprimentos)}
          {linha('Sangrias', -conferencia.sangrias)}
          {linha('Deveria ter', conferencia.esperado, true)}
          <p className="mt-2 text-xs text-tinta-3">
            Cartão e Pix não entram: não passam pela gaveta. Some-los faria o caixa faltar
            todo dia o valor das maquininhas.
          </p>
        </div>

        <div className="rounded-norte border border-borda bg-superficie p-4">
          <h3 className="mb-2 text-sm font-bold">
            {conferencia.vendas} venda{conferencia.vendas === 1 ? '' : 's'} no turno
          </h3>
          {conferencia.porForma.map((f) => linha(f.forma, f.total))}
          {linha('Total vendido', conferencia.vendidoTotal, true)}
          {conferencia.recebidoCrediario > 0 && linha('Crediário recebido (todas as formas)', conferencia.recebidoCrediario)}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-norte border border-borda bg-superficie p-4">
        <Campo
          rotulo="Quanto você contou na gaveta"
          name="contado"
          type="number"
          step={0.01}
          min={0}
          value={contado}
          onChange={(e) => setContado(e.target.value)}
          placeholder="0,00"
          dica="Conte antes de olhar o valor esperado. É o que faz a conferência valer."
        />
        <Campo
          rotulo="Observação"
          name="obs"
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          placeholder="Opcional — o que explica a diferença"
        />
        <Botao
          tom="confirmar"
          carregando={indo}
          disabled={contado === ''}
          onClick={() =>
            comecar(async () => {
              const r = await fechar(slug, caixaId, Number(contado) || 0, obs || undefined)
              setFeito({ diferenca: r.diferenca, esperado: r.esperado })
            })
          }
        >
          {indo ? 'Fechando...' : 'Fechar o caixa'}
        </Botao>
      </div>
    </div>
  )
}

export function Movimento({
  slug,
  caixaId,
  tipoInicial = 'SANGRIA',
  aoRegistrar,
}: {
  slug: string
  caixaId: string
  /** Com qual dos dois o painel abre — o botão da barra já disse qual. */
  tipoInicial?: 'SANGRIA' | 'SUPRIMENTO'
  /** Chamado depois de gravar, para quem abriu o painel poder fechá-lo. */
  aoRegistrar?: (tipo: 'SANGRIA' | 'SUPRIMENTO', valor: number) => void
}) {
  const [tipo, setTipo] = useState<'SANGRIA' | 'SUPRIMENTO'>(tipoInicial)
  const [valor, setValor] = useState('')
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()

  return (
    <div className="flex flex-col gap-3 rounded-norte border border-borda bg-superficie p-4">
      <h3 className="text-sm font-bold">Tirar ou pôr dinheiro</h3>
      {erro && <Aviso nivel="critico">{erro}</Aviso>}

      <div className="flex gap-1.5">
        {(['SANGRIA', 'SUPRIMENTO'] as const).map((t) => (
          <Botao
            key={t}
            tom={tipo === t ? 'principal' : 'secundario'}
            onClick={() => setTipo(t)}
            className="flex-1 py-1.5 text-xs"
          >
            {t === 'SANGRIA' ? 'Sangria (tirar)' : 'Suprimento (pôr)'}
          </Botao>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
        <Campo
          rotulo="Valor"
          name="valor"
          type="number"
          step={0.01}
          min={0}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="0,00"
        />
        <Campo
          rotulo="Motivo"
          name="motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          placeholder="Pagamento do entregador, troco do banco..."
          dica="Obrigatório. Dinheiro saindo sem motivo é o começo de toda confusão."
        />
      </div>

      <Botao
        disabled={!valor || !motivo.trim()}
        carregando={indo}
        onClick={() =>
          comecar(async () => {
            setErro(null)
            try {
              await movimentar(slug, caixaId, tipo, Number(valor), motivo)
              const v = Number(valor)
              setValor('')
              setMotivo('')
              aoRegistrar?.(tipo, v)
            } catch (e) {
              setErro(e instanceof Error ? e.message : 'Não deu para registrar.')
            }
          })
        }
      >
        Registrar
      </Botao>
    </div>
  )
}
