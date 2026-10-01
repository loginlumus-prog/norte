'use client'

// Abrir e fechar o caixa.
//
// O fechamento NÃO mostra o esperado antes de a pessoa digitar o contado — e
// essa ordem é decisão, não acaso. Se o sistema mostra o número primeiro, quem
// está com pressa digita aquele número e a conferência vira teatro. Aqui ela
// conta a gaveta, digita, fecha, e só então o sistema mostra a conta inteira
// e diz se bateu. (Antes a tela prometia isso e mostrava o "Deveria ter" logo
// em cima do campo.) Pela mesma razão, a linha do dinheiro vendido fica para
// depois: com ela e a abertura, o esperado sai de cabeça.

import { useState, useTransition } from 'react'
import { Botao, Campo, Aviso, cx } from '@/ui/base'
import { abrir, fechar, movimentar } from './acoes'
import type { Fechamento, NaMaquininha } from '@/servidor/caixa'
import { plural } from '@/ui/texto'
import { usePalavras } from './palavras'

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** O nome da forma como a pessoa fala — "CREDITO" é o nome do banco, não o dela. */
const FORMA: Record<string, string> = {
  DINHEIRO: 'Dinheiro', PIX: 'Pix', DEBITO: 'Débito', CREDITO: 'Crédito', CREDIARIO: 'Crediário',
  VALE: 'Vale de troca', TRANSFERENCIA: 'Transferência',
}

export function AbrirCaixa({
  slug,
  unidadeId,
  unidadeNome,
}: {
  slug: string
  unidadeId: string
  unidadeNome: string
}) {
  const p = usePalavras()
  const [saldo, setSaldo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()

  function abrirAgora() {
    comecar(async () => {
      setErro(null)
      const r = await abrir(slug, unidadeId, Number(saldo) || 0)
      if (!r.ok) setErro('erro' in r ? r.erro : `Já existe um caixa aberto aqui, por ${r.abertoPor}.`)
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
            {unidadeNome} — sem caixa aberto não dá para {p.vender}. É assim que o dinheiro do dia
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
            {indo ? 'Abrindo...' : `Abrir caixa e começar a ${p.vender}`}
          </Botao>
        </form>
      </div>
    </div>
  )
}

export function FecharCaixa({
  slug,
  caixaId,
  turno,
}: {
  slug: string
  caixaId: string
  /**
   * O que dá para mostrar ANTES de contar: quantas vendas e o que entrou fora
   * da gaveta — cada maquininha (vendas e crediário juntos) e o que não passa
   * por máquina nenhuma (fiado, vale). O esperado e o dinheiro vendido nem
   * chegam ao navegador — vêm na resposta do fechamento.
   */
  turno: {
    vendas: number
    maquininhas: NaMaquininha[]
    semMaquininha: { forma: string; total: number }[]
  }
}) {
  const p = usePalavras()
  const [contado, setContado] = useState('')
  const [obs, setObs] = useState('')
  const [feito, setFeito] = useState<Fechamento | null>(null)
  const [erroFechar, setErroFechar] = useState<string | null>(null)
  const [indo, comecar] = useTransition()

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

  // Fechado: agora sim, a conta inteira — com o esperado que o servidor
  // contou NA HORA de fechar, que é o que vale.
  if (feito) {
    const zerou = Math.abs(feito.diferenca) < 0.005
    const conferencia = feito.conferencia
    return (
      <div className="flex flex-col gap-4">
        <Aviso nivel={zerou ? 'bom' : 'critico'}>
          {zerou
            ? `Caixa fechado certinho, ${brl(feito.esperado)}.`
            : `Caixa fechado com ${feito.diferenca > 0 ? 'sobra' : 'falta'} de ${brl(Math.abs(feito.diferenca))}.`}{' '}
          {/* O papel que vai no envelope com o dinheiro (caixa/[id]/fechamento). */}
          <a href={`/${slug}/caixa/${caixaId}/fechamento?imprimir=1`} target="_blank" rel="noopener" className="font-semibold underline underline-offset-2">
            Imprimir o fechamento
          </a>
        </Aviso>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-norte border border-borda bg-superficie p-4">
            <h3 className="mb-2 text-sm font-bold">O que passou pela gaveta</h3>
            {linha('Abertura', conferencia.abertura)}
            {linha(`${p.Vendas} em dinheiro`, conferencia.dinheiroVendido)}
            {conferencia.dinheiroRecebido > 0 && linha('Crediário recebido em dinheiro', conferencia.dinheiroRecebido)}
            {conferencia.dinheiroMensalidades > 0 && linha('Mensalidades recebidas em dinheiro', conferencia.dinheiroMensalidades)}
            {linha('Suprimentos', conferencia.suprimentos)}
            {linha('Sangrias', -conferencia.sangrias)}
            {linha('Deveria ter', feito.esperado, true)}
            {linha('Contado', feito.contado)}
            <p className="mt-2 text-xs text-tinta-3">
              Cartão e Pix não entram: não passam pela gaveta. Somá-los faria o caixa faltar
              todo dia o valor das maquininhas.
            </p>
          </div>
          <div className="rounded-norte border border-borda bg-superficie p-4">
            <h3 className="mb-2 text-sm font-bold">
              {plural(conferencia.vendas, p.venda, p.vendas)} no turno
            </h3>
            {/* Por forma E maquininha: "Crédito · Stone" e "Crédito · Cielo"
                são dois extratos diferentes para conferir. */}
            {conferencia.porMaquininha.map((f) =>
              linha(`${FORMA[f.forma] ?? f.forma}${f.maquininha ? ` · ${f.maquininha}` : ''}`, f.total),
            )}
            {linha(`Total ${p.Vendido.toLowerCase()}`, conferencia.vendidoTotal, true)}
            {conferencia.recebidoCrediario > 0 && (
              <>
                {linha('Crediário recebido (todas as formas)', conferencia.recebidoCrediario)}
                {conferencia.recebidoPorForma.map((f) => (
                  <div key={`cred-${f.forma}-${f.maquininha ?? ''}`} className="flex justify-between gap-4 py-0.5 pl-3 text-xs text-tinta-3">
                    <span>
                      {FORMA[f.forma] ?? f.forma}
                      {f.maquininha ? ` · ${f.maquininha}` : ''}
                    </span>
                    <span className="numero">{brl(f.total)}</span>
                  </div>
                ))}
              </>
            )}
            {conferencia.recebidoMensalidades > 0 && linha('Mensalidades recebidas (todas as formas)', conferencia.recebidoMensalidades)}
          </div>
        </div>
        {conferencia.maquininhas.length > 0 && (
          <div className="rounded-norte border border-borda bg-superficie p-4">
            <h3 className="mb-1 text-sm font-bold">Confira cada maquininha</h3>
            <p className="mb-2 text-xs text-tinta-3">
              {p.Vendas} e crediário juntos: é o total que aparece no extrato de cada máquina.
            </p>
            <PorMaquininha grupos={conferencia.maquininhas} />
          </div>
        )}
      </div>
    )
  }

  // Antes de fechar: só o que NÃO passa pela gaveta — é o que a pessoa confere
  // com cada maquininha e o extrato do Pix. O dinheiro, ela conta.
  const foraDaGaveta = turno.maquininhas.length > 0 || turno.semMaquininha.length > 0

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-norte border border-borda bg-superficie p-4">
          <h3 className="mb-2 text-sm font-bold">Conte a gaveta</h3>
          <p className="text-sm text-tinta-2">
            Tire o dinheiro, conte nota por nota e digite o total aqui embaixo. O quanto o sistema
            esperava aparece depois de fechar — se aparecesse antes, a contagem virava copiar o
            número.
          </p>
          <p className="mt-2 text-xs text-tinta-3">
            Só o dinheiro conta. Cartão e Pix não passam pela gaveta: somá-los faria o caixa
            faltar todo dia o valor das maquininhas.
          </p>
        </div>

        <div className="rounded-norte border border-borda bg-superficie p-4">
          <h3 className="mb-2 text-sm font-bold">
            {plural(turno.vendas, p.venda, p.vendas)} no turno
          </h3>
          {foraDaGaveta ? (
            <>
              {turno.maquininhas.length > 0 && (
                <>
                  <p className="mb-1 text-xs text-tinta-3">Para conferir com cada maquininha e o extrato ({p.vendas} e crediário juntos):</p>
                  <PorMaquininha grupos={turno.maquininhas} />
                </>
              )}
              {turno.semMaquininha.map((f) => linha(FORMA[f.forma] ?? f.forma, f.total))}
            </>
          ) : (
            <p className="text-sm text-tinta-3">{p.nenhumaVenda} em cartão, Pix ou outra forma fora da gaveta.</p>
          )}
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
          dica="O esperado aparece depois de fechar. É o que faz a conferência valer."
        />
        <Campo
          rotulo="Observação"
          name="obs"
          value={obs}
          onChange={(e) => setObs(e.target.value)}
          placeholder="Opcional — o que explica a diferença"
        />
        {erroFechar && <Aviso nivel="critico">{erroFechar}</Aviso>}
        <Botao
          tom="confirmar"
          carregando={indo}
          disabled={contado === ''}
          onClick={() =>
            comecar(async () => {
              setErroFechar(null)
              const r = await fechar(slug, caixaId, Number(contado) || 0, obs || undefined)
              // Deu errado: o contado continua no campo, e a frase aparece aqui.
              if (!r.ok) return setErroFechar(r.erro)
              setFeito(r)
            })
          }
        >
          {indo ? 'Fechando...' : 'Fechar o caixa'}
        </Botao>
      </div>
    </div>
  )
}

/**
 * Cada maquininha com o total dela em cima e as formas embaixo. Quando a
 * forma teve crediário junto, a linha diz de onde veio cada parte — é o que
 * explica o extrato ter mais que as vendas do turno.
 */
function PorMaquininha({ grupos }: { grupos: NaMaquininha[] }) {
  // Loja sem maquininha cadastrada: um grupo só, sem nome — não há o que
  // separar, e "sem maquininha marcada" em cima de tudo só confundiria.
  const soSemNome = grupos.length === 1 && grupos[0]!.maquininha === null
  const p = usePalavras()
  return (
    <div className="flex flex-col divide-y divide-borda-suave">
      {grupos.map((g) => (
        <div key={g.maquininha ?? '-'} className="flex flex-col py-1.5">
          {!soSemNome && (
            <div className="flex justify-between gap-4 text-sm font-semibold text-tinta">
              <span>{g.maquininha ?? 'Sem maquininha marcada'}</span>
              <span className="numero">{brl(g.total)}</span>
            </div>
          )}
          {g.formas.map((f) => (
            <div
              key={f.forma}
              className={cx('flex justify-between gap-4', soSemNome ? 'py-1 text-sm text-tinta-2' : 'pl-3 text-xs text-tinta-2')}
            >
              <span>
                {FORMA[f.forma] ?? f.forma}
                {f.crediario > 0 && (
                  <span className="text-tinta-3">
                    {' '}
                    ({f.vendas > 0 ? `${p.vendas} ${brl(f.vendas)} + ` : ''}crediário {brl(f.crediario)})
                  </span>
                )}
              </span>
              <span className="numero">{brl(f.total)}</span>
            </div>
          ))}
        </div>
      ))}
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
              const r = await movimentar(slug, caixaId, tipo, Number(valor), motivo)
              if (r.erro) return setErro(r.erro)
              const v = Number(valor)
              setValor('')
              setMotivo('')
              aoRegistrar?.(tipo, v)
            } catch {
              // Queda de rede: a ação nem chegou a responder.
              setErro('Não deu para registrar. Confira a internet e tente de novo.')
            }
          })
        }
      >
        Registrar
      </Botao>
    </div>
  )
}
