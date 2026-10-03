'use client'

// As perguntas que a venda faz antes de fechar, nas duas caras do balcão:
// "quem vendeu?" (o PIN de quem vendeu, em toda venda, quando a empresa pede),
// "quem autoriza?" (o PIN da gerente) e "vende assim mesmo?" (a peça que o
// sistema diz que acabou).
//
// ── o PIN ────────────────────────────────────────────────────
// Abre quando o SERVIDOR diz que a venda passou da regra (desconto acima do
// teto, item avulso) — nunca adivinhado pela tela. A gerente digita o dela
// ali mesmo, a venda segue no nome de quem vendeu e o livro guarda quem
// autorizou. O número fica só neste campo, vai numa chamada e some: não entra
// no que o balcão guarda no aparelho (guardar.ts), nem volta preenchido.

import { useEffect, useRef, useState } from 'react'
import { Aviso, Botao } from '@/ui/base'
import { palavra, plural } from '@/ui/texto'
import { brl, rotuloDoPagamento } from './conta'
import type { Venda } from './useVenda'
import { problemaDoPin } from '@/servidor/pin-regra'

export function PedirPin({ v }: { v: Venda }) {
  const pedido = v.pedidoDePin
  const [pin, setPin] = useState('')
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!pedido) return
    setPin('')
    // Depois de pintar: o foco num campo que ainda não existe se perde.
    const t = setTimeout(() => campo.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [pedido])

  if (!pedido) return null

  function autorizar() {
    const p = pin.replace(/\D/g, '')
    if (p.length < 4) return
    setPin('')
    v.autorizar(p)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-titulo"
        className="flex w-full max-w-sm flex-col gap-4 rounded-2xl border border-borda bg-superficie p-5 shadow-norte-alta"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            v.cancelarAutorizacao()
          }
        }}
      >
        <div className="flex flex-col gap-1">
          <h2 id="pin-titulo" className="text-lg font-bold text-tinta">
            Precisa de autorização
          </h2>
          <p className="text-sm text-tinta-2">{pedido.motivo}</p>
          <p className="text-sm text-tinta-2">
            Quem pode autorizar digita o PIN pessoal aqui. A venda continua no nome de quem vendeu, e fica
            registrado quem autorizou.
          </p>
        </div>

        {pedido.erro && <Aviso nivel="critico">{pedido.erro}</Aviso>}

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold text-tinta">PIN de quem autoriza</span>
          <input
            ref={campo}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                autorizar()
              }
            }}
            aria-describedby="pin-dica"
            className="numero h-14 rounded-xl border-2 border-borda bg-superficie px-4 text-center text-2xl font-bold tracking-[0.5em] text-tinta focus:border-marca focus:outline-none"
          />
          <span id="pin-dica" className="text-xs text-tinta-3">
            De 4 a 6 números. Quem não tem PIN cria o seu em Minha conta.
          </span>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <Botao tom="secundario" onClick={v.cancelarAutorizacao} className="min-h-12 rounded-xl">
            Voltar
          </Botao>
          <Botao
            tom="confirmar"
            onClick={autorizar}
            carregando={v.indo}
            disabled={pin.length < 4}
            className="min-h-12 rounded-xl"
          >
            Autorizar e concluir
          </Botao>
        </div>
      </div>
    </div>
  )
}

/**
 * "O sistema diz que acabou — vende assim mesmo?" Só na loja que vende sem
 * estoque (Configurações): a peça está na mão da cliente, e o sistema é que
 * está errado. Uma pergunta, com os nomes, logo acima do concluir.
 */
export function PerguntaSemEstoque({ v }: { v: Venda }) {
  const itens = v.perguntaSemEstoque
  if (!itens) return null
  return (
    <Aviso nivel="atencao">
      <span className="flex flex-col gap-2">
        <span>
          O sistema diz que acabou: <b className="font-semibold">{itens.join(', ')}</b>. Vende assim mesmo? O
          estoque fica negativo e {palavra(itens.length, 'a peça vai', 'as peças vão')} para a lista
          “Vendido sem estoque — conferir”, em Estoque.
        </span>
        <span className="flex flex-wrap gap-2">
          <Botao tom="confirmar" onClick={v.venderSemEstoque} carregando={v.indo} className="min-h-10 rounded-lg text-sm">
            Vender assim mesmo
          </Botao>
          <Botao tom="secundario" onClick={() => v.setPerguntaSemEstoque(null)} className="min-h-10 rounded-lg text-sm">
            Voltar
          </Botao>
        </span>
      </span>
    </Aviso>
  )
}

// ─────────────────────────────────────────────────────────────
// "QUEM VENDEU?" — o PIN no fim de toda venda
// ─────────────────────────────────────────────────────────────
//
// A última pergunta antes de gravar (ver "ASSINAR A VENDA" em
// servidor/autorizacao.ts): confirma a venda — nada é gravado antes, e o
// toque sem querer em "Concluir" para aqui — e diz em nome de quem ela fica.
// Mostra o que está sendo confirmado (o total, os itens, a forma), grande.
//
// Rápida de propósito, porque roda em TODA venda:
// - o foco já vem no campo; Enter manda; Esc volta ao pedido, intocado;
// - quatro números mandam sozinhos (com uma pausa curta, para quem tem PIN
//   de seis continuar digitando); seis mandam na hora;
// - no tablet o teclado da tela não sobe (`inputMode="none"`): o teclado
//   numérico grande é o desta janela; no computador, o teclado de verdade;
// - nada fica guardado: o número vive nesta janela e na chamada da venda.

/** A pausa depois do 4º número antes de mandar sozinho. Digitou o 5º, espera o resto. */
const PAUSA_DO_PIN_MS = 600

/**
 * A janela do PIN no fim da venda. Quem ainda não tem PIN não confirma sem
 * ele: a janela vira a criação do PIN, ali mesmo (`CriarPinNaVenda`).
 */
export function AssinarVenda({ v }: { v: Venda; slug?: string }) {
  if (v.assinando && v.assinatura && !v.assinatura.tenhoPin) return <CriarPinNaVenda v={v} />
  return <ConfirmarComPin v={v} />
}

function ConfirmarComPin({ v }: { v: Venda }) {
  const pedido = v.assinando
  const [pin, setPin] = useState('')
  const campo = useRef<HTMLInputElement>(null)
  // Tela de toque: o teclado desta janela, sem o do sistema por cima.
  const [toque, setToque] = useState(false)
  // Sem internet: o PIN vai junto quando a venda subir (ver useVenda, `pinsDaFila`).
  const [semRede, setSemRede] = useState(false)

  useEffect(() => {
    if (!pedido) return
    setPin('')
    setToque(window.matchMedia?.('(pointer: coarse)').matches ?? false)
    setSemRede(navigator.onLine === false)
    const t = setTimeout(() => campo.current?.focus(), 30)
    return () => clearTimeout(t)
  }, [pedido])

  const indo = v.indo
  const mandar = (p: string) => {
    if (p.length < 4 || indo) return
    setPin('')
    v.assinar(p)
  }

  // Quatro números: manda depois de uma pausa curta. Seis: na hora.
  useEffect(() => {
    if (!pedido || indo) return
    if (pin.length >= 6) {
      mandar(pin)
      return
    }
    if (pin.length < 4) return
    const t = setTimeout(() => mandar(pin), PAUSA_DO_PIN_MS)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, pedido, indo])

  if (!pedido || !v.assinatura) return null
  const { meuNome } = v.assinatura
  const primeiro = meuNome.trim().split(/\s+/)[0] || meuNome
  const formas = rotuloDoPagamento(v.pagos)
  const itens = v.itensNaVenda

  const tecla = (d: string) => setPin((x) => (x + d).replace(/\D/g, '').slice(0, 6))
  const apagar = () => setPin((x) => x.slice(0, -1))

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="assinar-titulo"
        aria-describedby="assinar-resumo"
        className="flex max-h-[96dvh] w-full max-w-sm flex-col gap-3 overflow-y-auto rounded-2xl border border-borda bg-superficie p-5 shadow-norte-alta"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            v.cancelarAssinatura()
          }
        }}
      >
        <div className="flex flex-col items-center gap-0.5 text-center">
          <h2 id="assinar-titulo" className="text-sm font-semibold text-tinta-2">
            Confirme com o seu PIN para registrar
          </h2>
          <p className="numero text-4xl font-extrabold tracking-tight text-titulo">{brl(v.conta.aPagarCent / 100)}</p>
          <p id="assinar-resumo" className="text-sm text-tinta-2">
            {plural(itens, 'item', 'itens')}
            {formas ? ` · ${formas}` : ''}
          </p>
        </div>

        {pedido.erro && <Aviso nivel="critico">{pedido.erro}</Aviso>}

        <label className="flex flex-col gap-1">
          <span className="sr-only">PIN de quem vendeu</span>
          <input
            ref={campo}
            type="password"
            inputMode={toque ? 'none' : 'numeric'}
            autoComplete="off"
            maxLength={6}
            value={pin}
            disabled={indo}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                mandar(pin)
              }
            }}
            aria-describedby="assinar-dica"
            className="numero h-14 rounded-xl border-2 border-borda bg-superficie px-4 text-center text-3xl font-bold tracking-[0.6em] text-tinta focus:border-marca focus:outline-none"
          />
          <span id="assinar-dica" className="text-center text-xs text-tinta-3">
            O PIN de {primeiro}. Aparelho dividido? Quem vendeu digita o próprio — a venda fica no nome dela.
          </span>
        </label>

        {/* O teclado da janela: alvos grandes, para o dedo. O foco fica no
            campo (o toque nos botões não o rouba), então o teclado de verdade
            continua valendo junto. */}
        <TecladoDoPin
          indo={indo}
          vazio={pin.length === 0}
          onTecla={tecla}
          onApagar={apagar}
          onOk={() => mandar(pin)}
          okDesligado={pin.length < 4}
        />

        {semRede && (
          <p className="text-center text-xs text-tinta-3">
            Sem internet: o PIN é conferido quando a venda subir. Se não conferir, ela fica no nome de {primeiro}, marcada
            para conferir.
          </p>
        )}

        {pedido.travado && (
          <Botao tom="secundario" onClick={v.registrarTravado} carregando={indo} className="min-h-11 rounded-xl text-sm">
            Registrar no nome de {primeiro} (fica marcada para conferir)
          </Botao>
        )}

        <Botao tom="discreto" onClick={v.cancelarAssinatura} disabled={indo} className="min-h-11 rounded-xl">
          Voltar ao pedido
        </Botao>
      </div>
    </div>
  )
}

/** O teclado grande da janela do PIN, igual na confirmação e na criação. */
function TecladoDoPin({
  indo,
  vazio,
  onTecla,
  onApagar,
  onOk,
  okDesligado,
  rotuloOk = 'OK',
}: {
  indo: boolean
  vazio: boolean
  onTecla: (d: string) => void
  onApagar: () => void
  onOk: () => void
  okDesligado: boolean
  rotuloOk?: string
}) {
  return (
    <div className="grid grid-cols-3 gap-2" aria-label="Teclado do PIN">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <button
          key={d}
          type="button"
          tabIndex={-1}
          disabled={indo}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onTecla(d)}
          className="numero h-14 rounded-xl border border-borda bg-superficie-2 text-2xl font-bold text-tinta active:bg-borda disabled:opacity-50"
        >
          {d}
        </button>
      ))}
      <button
        type="button"
        tabIndex={-1}
        disabled={indo || vazio}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onApagar}
        aria-label="Apagar um número"
        className="h-14 rounded-xl border border-borda bg-superficie text-lg font-semibold text-tinta-2 disabled:opacity-40"
      >
        ⌫
      </button>
      <button
        type="button"
        tabIndex={-1}
        disabled={indo}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onTecla('0')}
        className="numero h-14 rounded-xl border border-borda bg-superficie-2 text-2xl font-bold text-tinta active:bg-borda disabled:opacity-50"
      >
        0
      </button>
      <Botao
        tom="confirmar"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onOk}
        carregando={indo}
        disabled={okDesligado}
        className="h-14 rounded-xl text-base"
      >
        {rotuloOk}
      </Botao>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// "CRIE O SEU PIN" — quem ainda não tem, na hora de registrar
// ─────────────────────────────────────────────────────────────
//
// O PIN assina a venda: sem ele, nada grava. Quem ainda não criou o dele não
// é mandado para Minha conta (a cliente espera no balcão): cria aqui, em dois
// passos curtos — o PIN e o PIN de novo. Quem PODE autorizar exceção (dono,
// gerente…) ganha um terceiro, uma vez na vida: a senha de entrar (a mesma de
// Minha conta: a tela esquecida aberta não vira "criei um PIN na conta da
// gerente e me autorizei 40%"). O PIN de quem só vende assina só as vendas dela. Ao final, UMA chamada grava o PIN e a
// venda juntos (ver `assinatura.criarPin` em servidor/venda.ts): nada fica
// pela metade. Esc volta ao pedido, intocado.
//
// O PIN fraco (0000, 1234) é recusado aqui mesmo, na hora; o PIN já usado por
// alguém da loja só o servidor sabe, e a frase não diz de quem.

type Etapa = 'pin' | 'repetir' | 'senha'

function CriarPinNaVenda({ v }: { v: Venda }) {
  const pedido = v.assinando
  const [etapa, setEtapa] = useState<Etapa>('pin')
  const [pin, setPin] = useState('')
  const [repetido, setRepetido] = useState('')
  const [senha, setSenha] = useState('')
  const [erroLocal, setErroLocal] = useState<string | null>(null)
  const [toque, setToque] = useState(false)
  const [semRede, setSemRede] = useState(false)
  const campo = useRef<HTMLInputElement>(null)
  const campoSenha = useRef<HTMLInputElement>(null)

  // A recusa do servidor leva ao passo certo: o PIN (já usado por alguém) ou
  // a senha de entrar (não confere). Janela que acabou de abrir: do começo.
  useEffect(() => {
    if (!pedido) return
    setErroLocal(null)
    if (pedido.refazer === 'senha') {
      setSenha('')
      setEtapa('senha')
    } else {
      setPin('')
      setRepetido('')
      setSenha('')
      setEtapa('pin')
    }
    setToque(window.matchMedia?.('(pointer: coarse)').matches ?? false)
    setSemRede(navigator.onLine === false)
  }, [pedido])

  // Depois de pintar: o foco num campo que ainda não existe se perde.
  useEffect(() => {
    if (!pedido || semRede) return
    const t = setTimeout(() => (etapa === 'senha' ? campoSenha : campo).current?.focus(), 30)
    return () => clearTimeout(t)
  }, [pedido, etapa, semRede])

  if (!pedido || !v.assinatura) return null
  const indo = v.indo
  const primeiro = v.assinatura.meuNome.trim().split(/\s+/)[0] || v.assinatura.meuNome
  const formas = rotuloDoPagamento(v.pagos)
  const itens = v.itensNaVenda

  const valor = etapa === 'repetir' ? repetido : pin
  const mudar = (f: (x: string) => string) => {
    setErroLocal(null)
    const limpo = (x: string) => f(x).replace(/\D/g, '').slice(0, 6)
    if (etapa === 'repetir') setRepetido(limpo)
    else setPin(limpo)
  }

  function avancar() {
    if (indo) return
    if (etapa === 'pin') {
      const problema = problemaDoPin(pin)
      if (problema) {
        setPin('')
        setErroLocal(problema)
        return
      }
      setEtapa('repetir')
    } else if (etapa === 'repetir') {
      if (repetido !== pin) {
        setPin('')
        setRepetido('')
        setEtapa('pin')
        setErroLocal('Os dois PINs não são iguais. Digite o PIN de novo, com calma.')
        return
      }
      // Quem só vende cria com o PIN e pronto; quem autoriza exceção confirma a senha, uma vez.
      if (v.assinatura?.pedeSenhaParaCriar) setEtapa('senha')
      else v.criarPinEVender(pin, '')
    }
  }

  function criar() {
    if (indo || !senha) return
    const s = senha
    setSenha('')
    v.criarPinEVender(pin, s)
  }

  const erro = erroLocal ?? pedido.erro
  const titulo = etapa === 'pin' ? 'Crie o seu PIN para registrar vendas' : etapa === 'repetir' ? 'Repita o PIN' : 'Só mais um passo'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="criar-pin-titulo"
        className="flex max-h-[96dvh] w-full max-w-sm flex-col gap-3 overflow-y-auto rounded-2xl border border-borda bg-superficie p-5 shadow-norte-alta"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            v.cancelarAssinatura()
          }
        }}
      >
        <div className="flex flex-col items-center gap-0.5 text-center">
          <h2 id="criar-pin-titulo" className="text-lg font-bold text-tinta">
            {titulo}
          </h2>
          <p className="text-sm text-tinta-2">
            {etapa === 'senha'
              ? `${primeiro}, digite a sua senha de entrar para confirmar que é você. É só esta vez.`
              : 'O PIN assina cada venda com o seu nome.'}
          </p>
          <p className="numero mt-1 text-2xl font-extrabold tracking-tight text-titulo">{brl(v.conta.aPagarCent / 100)}</p>
          <p className="text-xs text-tinta-3">
            {plural(itens, 'item', 'itens')}
            {formas ? ` · ${formas}` : ''}
          </p>
        </div>

        {erro && <Aviso nivel="critico">{erro}</Aviso>}

        {semRede ? (
          <>
            <Aviso nivel="atencao">
              Sem internet não dá para criar o PIN agora. A venda fica guardada neste aparelho, no nome de {primeiro},
              marcada para conferir — e sobe sozinha quando a conexão voltar.
            </Aviso>
            <Botao tom="confirmar" onClick={v.registrarSemInternet} carregando={indo} className="min-h-12 rounded-xl">
              Registrar sem internet
            </Botao>
          </>
        ) : etapa === 'senha' ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-tinta">Sua senha de entrar</span>
              <input
                ref={campoSenha}
                type="password"
                autoComplete="current-password"
                value={senha}
                disabled={indo}
                onChange={(e) => setSenha(e.target.value.slice(0, 200))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    criar()
                  }
                }}
                className="h-14 rounded-xl border-2 border-borda bg-superficie px-4 text-lg text-tinta focus:border-marca focus:outline-none"
              />
            </label>
            <Botao tom="confirmar" onClick={criar} carregando={indo} disabled={!senha} className="min-h-12 rounded-xl">
              Criar o PIN e registrar a venda
            </Botao>
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1">
              <span className="sr-only">{etapa === 'pin' ? 'Escolha o seu PIN' : 'Repita o PIN'}</span>
              <input
                ref={campo}
                type="password"
                inputMode={toque ? 'none' : 'numeric'}
                autoComplete="off"
                maxLength={6}
                value={valor}
                disabled={indo}
                onChange={(e) => mudar(() => e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (valor.length >= 4) avancar()
                  }
                }}
                aria-describedby="criar-pin-dica"
                className="numero h-14 rounded-xl border-2 border-borda bg-superficie px-4 text-center text-3xl font-bold tracking-[0.6em] text-tinta focus:border-marca focus:outline-none"
              />
              <span id="criar-pin-dica" className="text-center text-xs text-tinta-3">
                {etapa === 'pin'
                  ? 'De 4 a 6 números. Nada de 1234 nem 0000 — é o primeiro que alguém chuta.'
                  : 'Digite o mesmo PIN de novo.'}
              </span>
            </label>
            <TecladoDoPin
              indo={indo}
              vazio={valor.length === 0}
              onTecla={(d) => mudar((x) => x + d)}
              onApagar={() => mudar((x) => x.slice(0, -1))}
              onOk={avancar}
              okDesligado={valor.length < 4}
              rotuloOk={etapa === 'pin' ? 'Seguir' : v.assinatura.pedeSenhaParaCriar ? 'Seguir' : 'Criar e registrar'}
            />
          </>
        )}

        <Botao tom="discreto" onClick={v.cancelarAssinatura} disabled={indo} className="min-h-11 rounded-xl">
          Voltar ao pedido
        </Botao>
      </div>
    </div>
  )
}
