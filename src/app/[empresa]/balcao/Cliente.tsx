'use client'

// Quem está comprando.
//
// ── por que fica no balcão, e não numa tela separada ─────────
// O histórico do cliente só existe se alguém ligar a venda à pessoa, e a única
// hora em que isso é possível é AGORA, com ela na frente. Se para cadastrar for
// preciso sair da tela, com fila esperando, ninguém cadastra: fecha a venda
// anônima e segue. Por isso a busca e o cadastro moram aqui dentro, e o
// cadastro pede só nome e telefone.
//
// ── por que mostra o histórico junto ─────────────────────────
// "Marta, 18 compras, R$ 1.580" muda a conversa no balcão de um jeito que
// "Marta" sozinho não muda. E "sumiu há 90 dias" é a deixa para perguntar o
// que aconteceu. Nome sem número é agenda.
//
// ── e por que dá para vender sem escolher ninguém ────────────
// A maior parte das vendas de balcão é anônima e vai continuar sendo. Campo
// obrigatório aqui faria a vendedora digitar "Cliente" para se livrar dele —
// e um cadastro sujo é pior que cadastro nenhum.

import { useEffect, useRef, useState, useTransition } from 'react'
import { Botao, Situacao } from '@/ui/base'
import { brl } from '@/ui/painel'
import { procurarClientes, cadastrarNoBalcao, type ClienteNoBalcao } from './acoes'

const telefoneBonito = (t: string | null) => {
  if (!t) return ''
  const d = t.replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return t
}

export function EscolherCliente({
  slug,
  escolhido,
  aoEscolher,
  pedido = 0,
}: {
  slug: string
  escolhido: ClienteNoBalcao | null
  aoEscolher: (c: ClienteNoBalcao | null) => void
  /**
   * Um contador que o balcão incrementa quando alguém aperta Alt+N: cada
   * mudança abre a busca. É o jeito de um atalho de teclado de fora chegar
   * num componente que guarda o próprio estado de aberto.
   */
  pedido?: number
}) {
  const [aberto, setAberto] = useState(false)
  const [termo, setTermo] = useState('')
  const [achados, setAchados] = useState<ClienteNoBalcao[]>([])
  const [novoTel, setNovoTel] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const campo = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (aberto) campo.current?.focus()
  }, [aberto])

  useEffect(() => {
    if (pedido > 0) setAberto(true)
  }, [pedido])

  // Espera a digitação parar: buscar a cada tecla faz o banco trabalhar seis
  // vezes para uma resposta só, e a lista pisca embaixo do dedo de quem digita.
  useEffect(() => {
    if (!aberto) return
    const t = setTimeout(() => {
      procurarClientes(slug, termo).then(setAchados)
    }, 250)
    return () => clearTimeout(t)
  }, [termo, aberto, slug])

  function fechar() {
    setAberto(false)
    setTermo('')
    setAchados([])
    setNovoTel('')
    setErro(null)
  }

  function cadastrar() {
    const nome = termo.trim()
    if (!nome) return
    comecar(async () => {
      const r = await cadastrarNoBalcao(slug, nome, novoTel)
      if (r.ok) {
        aoEscolher(r.cliente)
        fechar()
      } else {
        setErro(r.erro)
      }
    })
  }

  if (escolhido) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-semibold text-tinta">{escolhido.nome}</span>
          <button
            type="button"
            onClick={() => aoEscolher(null)}
            className="shrink-0 text-xs text-tinta-3 underline-offset-2 hover:text-tinta hover:underline"
          >
            trocar
          </button>
        </div>
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-tinta-3">
          <span>
            {escolhido.compras === 0
              ? 'primeira compra aqui'
              : `${escolhido.compras} compra(s) · ${brl(escolhido.gastou)}`}
            {escolhido.diasSemVir !== null && escolhido.diasSemVir >= 60 && (
              <span className="text-atencao"> · sumiu há {escolhido.diasSemVir} dias</span>
            )}
          </span>
          {/* EM DIA e ATRASADO não podem ter a mesma cara: é a informação
              que decide se a loja vende fiado de novo para esta pessoa. */}
          {escolhido.devendo > 0 &&
            (escolhido.vencido > 0 ? (
              <Situacao nivel="critico">deve {brl(escolhido.devendo)} · atrasado</Situacao>
            ) : (
              <Situacao nivel="atencao">deve {brl(escolhido.devendo)} · em dia</Situacao>
            ))}
        </span>
      </div>
    )
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="text-left text-sm text-tinta-3 underline-offset-2 hover:text-tinta hover:underline"
      >
        + Quem está comprando?
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={campo}
        value={termo}
        onChange={(e) => {
          setTermo(e.target.value)
          setErro(null)
        }}
        placeholder="Nome, telefone ou CPF"
        aria-label="Procurar cliente"
        className="rounded border border-borda bg-superficie px-2 py-1.5 text-sm text-tinta placeholder:text-tinta-3"
      />

      {achados.length > 0 && (
        <ul className="flex max-h-52 flex-col overflow-y-auto">
          {achados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => {
                  aoEscolher(c)
                  fechar()
                }}
                className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-superficie-2"
              >
                <span className="text-sm text-tinta">{c.nome}</span>
                <span className="text-xs text-tinta-3">
                  {telefoneBonito(c.telefone) || 'sem telefone'}
                  {c.compras > 0 && ` · ${c.compras} compra(s) · ${brl(c.gastou)}`}
                  {c.devendo > 0 && (
                    <span className={c.vencido > 0 ? 'font-semibold text-critico' : 'text-atencao'}>
                      {' '}· deve {brl(c.devendo)}{c.vencido > 0 ? ' (atrasado)' : ''}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Aparece assim que há nome digitado e nenhum resultado igual: é o
          momento exato em que a vendedora descobre que a pessoa não tem
          cadastro, e é aqui que ela tem que conseguir resolver. */}
      {termo.trim().length >= 2 && achados.length === 0 && (
        <div className="flex flex-col gap-2 rounded border border-borda-suave p-2">
          <span className="text-xs text-tinta-2">
            Ninguém com esse nome. Cadastrar <strong>{termo.trim()}</strong>?
          </span>
          <input
            value={novoTel}
            onChange={(e) => setNovoTel(e.target.value)}
            inputMode="tel"
            placeholder="WhatsApp (opcional)"
            aria-label="WhatsApp do novo cliente"
            className="rounded border border-borda bg-superficie px-2 py-1.5 text-sm text-tinta placeholder:text-tinta-3"
          />
          {erro && <span className="text-xs text-critico">{erro}</span>}
          <Botao tom="confirmar" largo onClick={cadastrar} carregando={indo} className="py-1.5 text-xs">
            Cadastrar e usar
          </Botao>
        </div>
      )}

      <button
        type="button"
        onClick={fechar}
        className="self-start text-xs text-tinta-3 underline-offset-2 hover:text-tinta hover:underline"
      >
        vender sem cliente
      </button>
    </div>
  )
}
