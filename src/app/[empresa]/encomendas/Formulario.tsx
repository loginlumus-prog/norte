'use client'

// Anotar (ou mudar) uma encomenda.
//
// ── o formulário nasce fechado ───────────────────────────────
// A tela é para ver o que sai hoje; anotar é o que se faz de vez em quando,
// com o cliente no telefone. Formulário aberto o tempo todo empurra a lista
// para baixo da dobra — e a lista é o que não pode ser esquecido.
//
// ── cliente do cadastro OU nome solto ────────────────────────
// Metade das encomendas de balcão é de quem nunca foi cadastrado, e ninguém
// vai cadastrar a tia do bolo com o telefone tocando. Então dá para buscar no
// cadastro (e o histórico fica ligado) ou só escrever o nome e o WhatsApp.
//
// ── data E hora ──────────────────────────────────────────────
// "Sábado" não basta: sábado às 9h e sábado às 17h são duas manhãs de trabalho
// diferentes. A hora é a do relógio da loja; o servidor converte.

import { startTransition, useActionState, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Aviso, Botao, Campo, Cartao, Marcar, Selecao } from '@/ui/base'
import { brl } from '@/ui/painel'
import { buscarClientesAcao, salvarEncomendaAcao, type EstadoEncomenda } from './acoes'

export type EncomendaInicial = {
  id: string
  clienteId: string | null
  clienteNome: string
  telefone: string | null
  descricao: string
  valor: number
  sinal: number
  dia: string
  hora: string
  entrega: boolean
  endereco: string | null
  observacao: string | null
  unidadeNome: string
}

type ClienteAchado = { id: string; nome: string; telefone: string | null }

const telefoneBonito = (t: string | null) => {
  if (!t) return ''
  const d = t.replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return t
}

const numeroParaCampo = (n: number) => (n ? n.toFixed(2).replace('.', ',') : '')

/** "1.234,56" → 1234.56, só para a conta ao vivo da tela. O servidor refaz tudo. */
const lerDinheiro = (t: string) => {
  const s = t.trim()
  if (!s) return 0
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
  return Number.isFinite(n) ? n : 0
}

export function Formulario({
  slug,
  lojas,
  lojaAtual,
  hoje,
  podeBuscarCliente,
  simples,
  inicial,
  voltarPara,
}: {
  slug: string
  /** As lojas onde a pessoa pode anotar. */
  lojas: { id: string; nome: string }[]
  lojaAtual: string | null
  /** "2026-09-24" no relógio da loja: o dia que o campo abre. */
  hoje: string
  podeBuscarCliente: boolean
  simples: boolean
  /** Editando: a encomenda como está. */
  inicial?: EncomendaInicial
  /** Para onde "cancelar edição" leva. */
  voltarPara: string
}) {
  const editando = !!inicial
  const [aberto, setAberto] = useState(editando)
  const acao = salvarEncomendaAcao.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoEncomenda, FormData>(acao, {})

  const [cliente, setCliente] = useState<ClienteAchado | null>(
    inicial?.clienteId ? { id: inicial.clienteId, nome: inicial.clienteNome, telefone: inicial.telefone } : null,
  )
  const [termo, setTermo] = useState('')
  const [achados, setAchados] = useState<ClienteAchado[]>([])
  const [telefone, setTelefone] = useState(telefoneBonito(inicial?.telefone ?? null))
  const [entrega, setEntrega] = useState(inicial?.entrega ?? false)
  const [valor, setValor] = useState(numeroParaCampo(inicial?.valor ?? 0))
  const [sinal, setSinal] = useState(numeroParaCampo(inicial?.sinal ?? 0))
  const formRef = useRef<HTMLFormElement>(null)

  // Deu certo ao anotar: limpa e fecha. O `vez` muda a cada envio, então o
  // efeito roda uma vez por resposta — não a cada tecla.
  useEffect(() => {
    if (estado.ok && !editando) {
      formRef.current?.reset()
      setCliente(null)
      setTelefone('')
      setEntrega(false)
      setValor('')
      setSinal('')
      setAberto(false)
    }
  }, [estado.vez, estado.ok, editando])

  // Espera a digitação parar: buscar a cada tecla faz o banco trabalhar seis
  // vezes para uma resposta só.
  useEffect(() => {
    if (!podeBuscarCliente || cliente || termo.trim().length < 2) {
      setAchados([])
      return
    }
    const t = setTimeout(() => {
      buscarClientesAcao(slug, termo).then(setAchados).catch(() => setAchados([]))
    }, 250)
    return () => clearTimeout(t)
  }, [termo, cliente, slug, podeBuscarCliente])

  if (!aberto) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Botao onClick={() => setAberto(true)} className={simples ? 'px-5 py-3 text-base' : undefined}>
          + Nova encomenda
        </Botao>
        {estado.ok && <span className="text-sm font-medium text-bom">{estado.ok}</span>}
      </div>
    )
  }

  const valorN = lerDinheiro(valor)
  const sinalN = lerDinheiro(sinal)
  const falta = Math.max(valorN - sinalN, 0)

  return (
    <Cartao
      caixa
      titulo={editando ? `Mudar a encomenda de ${inicial!.clienteNome}` : 'Nova encomenda'}
      acao={
        editando ? (
          <Link href={voltarPara} className="text-xs text-tinta-3 hover:text-tinta">
            cancelar
          </Link>
        ) : (
          <button type="button" onClick={() => setAberto(false)} className="text-xs text-tinta-3 hover:text-tinta">
            fechar
          </button>
        )
      }
    >
      {/* onSubmit, e não action={...}: com `action`, o React limpa o
          formulário depois de cada envio — inclusive quando o servidor
          devolve erro, e aí a pessoa perderia tudo que digitou por causa de
          um telefone sem DDD. */}
      <form
        ref={formRef}
        onSubmit={(ev) => {
          ev.preventDefault()
          const dados = new FormData(ev.currentTarget)
          startTransition(() => agir(dados))
        }}
        className="flex flex-col gap-4"
      >
        {inicial && <input type="hidden" name="id" value={inicial.id} />}
        {cliente && <input type="hidden" name="clienteId" value={cliente.id} />}
        {cliente && <input type="hidden" name="clienteNome" value={cliente.nome} />}

        {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}

        {!editando &&
          (lojas.length > 1 ? (
            <Selecao
              rotulo="Loja"
              name="unidadeId"
              defaultValue={lojaAtual ?? lojas[0]?.id}
              opcoes={lojas.map((l) => ({ valor: l.id, titulo: l.nome }))}
              dica="A loja que faz e entrega. O sinal entra no caixa dela."
            />
          ) : (
            <input type="hidden" name="unidadeId" value={lojas[0]?.id ?? ''} />
          ))}
        {editando && lojas.length > 1 && (
          <p className="text-xs text-tinta-3">Loja: {inicial!.unidadeNome}. Para mudar de loja, cancele e anote na outra.</p>
        )}

        {/* ── para quem ── */}
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold text-tinta">Para quem</legend>
          {cliente ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-norte border border-marca/40 bg-marca-suave px-3 py-2">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold text-tinta">{cliente.nome}</span>
                <span className="text-xs text-tinta-2">do cadastro de clientes</span>
              </span>
              <Botao type="button" tom="discreto" className="px-2 py-1 text-xs" onClick={() => setCliente(null)}>
                trocar
              </Botao>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="relative flex flex-col">
                <Campo
                  rotulo="Nome"
                  name="clienteNome"
                  defaultValue={inicial && !inicial.clienteId ? inicial.clienteNome : undefined}
                  onChange={(ev) => setTermo(ev.currentTarget.value)}
                  autoComplete="off"
                  placeholder="Maria Souza"
                  dica={podeBuscarCliente ? 'Digite para achar no cadastro, ou deixe só o nome.' : undefined}
                />
                {achados.length > 0 && (
                  <ul
                    role="listbox"
                    aria-label="Clientes do cadastro"
                    className="realce absolute top-full right-0 left-0 z-20 mt-1 flex max-h-64 flex-col overflow-y-auto rounded-norte border border-borda bg-superficie py-1"
                  >
                    {achados.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={false}
                          onClick={() => {
                            setCliente(c)
                            setAchados([])
                            if (!telefone && c.telefone) setTelefone(telefoneBonito(c.telefone))
                          }}
                          className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-superficie-2"
                        >
                          <span className="text-sm font-medium text-tinta">{c.nome}</span>
                          {c.telefone && <span className="text-xs text-tinta-3">{telefoneBonito(c.telefone)}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Campo
                rotulo="WhatsApp"
                name="telefone"
                type="tel"
                inputMode="tel"
                value={telefone}
                onChange={(ev) => setTelefone(ev.currentTarget.value)}
                placeholder="(71) 99999-0000"
                dica="Opcional. Com ele, a lista abre a conversa num toque."
              />
            </div>
          )}
          {cliente && (
            <Campo
              rotulo="WhatsApp"
              name="telefone"
              type="tel"
              inputMode="tel"
              value={telefone}
              onChange={(ev) => setTelefone(ev.currentTarget.value)}
              placeholder="(71) 99999-0000"
            />
          )}
        </fieldset>

        {/* ── o quê ── */}
        <Campo
          rotulo="O que é"
          name="descricao"
          required
          defaultValue={inicial?.descricao}
          placeholder="Bolo de chocolate 2 kg, escrito Parabéns Ana"
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <Campo
            rotulo="Valor"
            name="valor"
            inputMode="decimal"
            value={valor}
            onChange={(ev) => setValor(ev.currentTarget.value)}
            placeholder="0,00"
          />
          <Campo
            rotulo="Sinal"
            name="sinal"
            inputMode="decimal"
            value={sinal}
            onChange={(ev) => setSinal(ev.currentTarget.value)}
            placeholder="0,00"
            dica={editando ? 'Mudou? A diferença entra no financeiro hoje.' : 'Opcional. Entra no financeiro hoje, como receita.'}
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-tinta">Falta pagar</span>
            <span className="numero rounded-norte bg-superficie-2 px-3 py-2 text-sm font-semibold text-tinta">
              {brl(falta)}
            </span>
            {sinalN > valorN && <span className="text-xs font-medium text-critico">O sinal passou do valor.</span>}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Dia" name="dia" type="date" required defaultValue={inicial?.dia ?? hoje} />
          <Campo rotulo="Hora" name="hora" type="time" required defaultValue={inicial?.hora ?? '14:00'} />
        </div>

        {/* ── retirada ou entrega ── */}
        <fieldset className="grid gap-2 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-semibold text-tinta">Como sai</legend>
          <Marcar
            type="radio"
            name="entrega"
            value="0"
            checked={!entrega}
            onChange={() => setEntrega(false)}
            titulo="Retirada na loja"
            resumo="O cliente vem buscar."
          />
          <Marcar
            type="radio"
            name="entrega"
            value="1"
            checked={entrega}
            onChange={() => setEntrega(true)}
            titulo="Entrega"
            resumo="A loja leva até o cliente."
          />
        </fieldset>
        {entrega && (
          <Campo
            rotulo="Endereço da entrega"
            name="endereco"
            required
            defaultValue={inicial?.endereco ?? undefined}
            placeholder="Rua, número, bairro e um ponto de referência"
          />
        )}

        <Campo
          rotulo="Observação"
          name="observacao"
          defaultValue={inicial?.observacao ?? undefined}
          placeholder="Sem lactose, vela número 7, deixar na portaria"
        />

        {estado.pedeConfirmacao && (
          <Marcar
            name="confirmarPassado"
            titulo="A data já passou, é isso mesmo"
            resumo="Marque só se a encomenda foi combinada antes e está sendo anotada agora."
          />
        )}

        <div className="flex justify-end">
          <Botao type="submit" carregando={pendente} className={simples ? 'px-5 py-3 text-base' : undefined}>
            {pendente ? 'Salvando...' : editando ? 'Salvar mudanças' : 'Anotar encomenda'}
          </Botao>
        </div>
      </form>
    </Cartao>
  )
}
