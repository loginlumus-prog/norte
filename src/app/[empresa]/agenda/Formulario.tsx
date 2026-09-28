'use client'

// Marcar (ou remarcar) um horário.
//
// ── nasce fechado, e abre já preenchido ──────────────────────
// A tela é para ver o dia; marcar é o que se faz com o telefone tocando. O
// formulário fica fechado — e abre sozinho, já com a profissional, o dia e a
// hora, quando a pessoa toca num horário LIVRE da agenda. É o caminho mais
// curto entre "a Bia tem às 15h?" e o horário marcado.
//
// ── cadastro OU nome solto ───────────────────────────────────
// Como na encomenda: dá para achar no cadastro (e o histórico fica ligado) ou
// só escrever o nome e o WhatsApp de quem liga pela primeira vez.
//
// ── o serviço dá a duração ───────────────────────────────────
// Escolher "Manicure" no catálogo preenche a duração dela; a recepção muda se
// aquele atendimento for mais longo. Serviço fora do catálogo se escreve — mas
// só o do catálogo vai pronto para o balcão no "Atender e cobrar".

import { startTransition, useActionState, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Aviso, Botao, Campo, Cartao, Marcar, Selecao } from '@/ui/base'
import { brl } from '@/ui/painel'
import { buscarClientesAgendaAcao, salvarHorarioAcao, type EstadoHorario } from './acoes'

export type HorarioInicial = {
  id: string
  unidadeNome: string
  colaboradorId: string
  clienteId: string | null
  clienteNome: string
  telefone: string | null
  produtoId: string | null
  servico: string
  dia: string
  hora: string
  duracao: number
  observacao: string | null
}

type ClienteAchado = { id: string; nome: string; telefone: string | null }

const telefoneBonito = (t: string | null) => {
  if (!t) return ''
  const d = t.replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return t
}

export function Formulario({
  slug,
  lojas,
  lojaAtual,
  profissionais,
  servicos,
  hoje,
  podeBuscarCliente,
  palavras,
  inicial,
  preenchido,
  voltarPara,
}: {
  slug: string
  lojas: { id: string; nome: string }[]
  lojaAtual: string | null
  profissionais: { id: string; nome: string }[]
  servicos: { id: string; nome: string; duracaoMin: number | null; preco: number }[]
  hoje: string
  podeBuscarCliente: boolean
  /** "Cliente"/"Paciente"/"Aluno", e o aviso do campo de observação. */
  palavras: { Pessoa: string; pessoas: string; avisoObservacao: string | null }
  /** Remarcando: o horário como está. */
  inicial?: HorarioInicial
  /** Tocou num horário livre: já vem com quem, o dia e a hora. */
  preenchido?: { colaboradorId: string; dia: string; hora: string } | null
  voltarPara: string
}) {
  const editando = !!inicial
  const [aberto, setAberto] = useState(editando || !!preenchido)
  const acao = salvarHorarioAcao.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoHorario, FormData>(acao, {})
  const formRef = useRef<HTMLFormElement>(null)

  const [cliente, setCliente] = useState<ClienteAchado | null>(
    inicial?.clienteId ? { id: inicial.clienteId, nome: inicial.clienteNome, telefone: inicial.telefone } : null,
  )
  const [termo, setTermo] = useState('')
  const [achados, setAchados] = useState<ClienteAchado[]>([])
  const [telefone, setTelefone] = useState(telefoneBonito(inicial?.telefone ?? null))
  const [produtoId, setProdutoId] = useState(inicial?.produtoId ?? '')
  const [duracao, setDuracao] = useState(String(inicial?.duracao ?? servicos[0]?.duracaoMin ?? 30))

  useEffect(() => {
    if (estado.ok && !editando) {
      formRef.current?.reset()
      setCliente(null)
      setTelefone('')
      setProdutoId('')
      setAberto(false)
    }
  }, [estado.vez, estado.ok, editando])

  useEffect(() => {
    if (!podeBuscarCliente || cliente || termo.trim().length < 2) {
      setAchados([])
      return
    }
    const t = setTimeout(() => {
      buscarClientesAgendaAcao(slug, termo).then(setAchados).catch(() => setAchados([]))
    }, 250)
    return () => clearTimeout(t)
  }, [termo, cliente, slug, podeBuscarCliente])

  if (!aberto) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Botao onClick={() => setAberto(true)} disabled={profissionais.length === 0}>
          + Novo horário
        </Botao>
        {estado.ok && <span className="text-sm font-medium text-bom">{estado.ok}</span>}
      </div>
    )
  }

  const servicoEscolhido = servicos.find((s) => s.id === produtoId) ?? null

  return (
    <Cartao
      caixa
      titulo={editando ? `Remarcar ${inicial!.clienteNome}` : 'Novo horário'}
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
      {/* onSubmit, e não action: o React limparia o formulário também quando
          o servidor devolve erro (ver ui/formulario.ts). */}
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
            />
          ) : (
            <input type="hidden" name="unidadeId" value={lojas[0]?.id ?? ''} />
          ))}
        {editando && <input type="hidden" name="unidadeId" value={lojaAtual ?? ''} />}

        <div className="grid gap-4 sm:grid-cols-2">
          <Selecao
            rotulo="Quem atende"
            name="colaboradorId"
            defaultValue={inicial?.colaboradorId ?? preenchido?.colaboradorId ?? profissionais[0]?.id}
            opcoes={profissionais.map((p) => ({ valor: p.id, titulo: p.nome }))}
          />
          {servicos.length > 0 ? (
            <Selecao
              rotulo="Serviço"
              name="produtoId"
              value={produtoId}
              onChange={(ev) => {
                const id = ev.currentTarget.value
                setProdutoId(id)
                const s = servicos.find((x) => x.id === id)
                if (s?.duracaoMin) setDuracao(String(s.duracaoMin))
              }}
              opcoes={[
                { valor: '', titulo: 'Outro (escrever)' },
                ...servicos.map((s) => ({ valor: s.id, titulo: `${s.nome}${s.preco > 0 ? ` — ${brl(s.preco)}` : ''}` })),
              ]}
            />
          ) : (
            <input type="hidden" name="produtoId" value="" />
          )}
        </div>
        {!servicoEscolhido && (
          <Campo
            rotulo={servicos.length > 0 ? 'Qual serviço' : 'Serviço'}
            name="servico"
            required
            defaultValue={inicial && !inicial.produtoId ? inicial.servico : undefined}
            placeholder="Corte e escova"
            dica={
              servicos.length > 0
                ? 'Fora do catálogo: no "Atender e cobrar" você lança o valor no balcão.'
                : 'Cadastre os serviços em Produtos (marcando "é serviço") para a duração e o preço virem sozinhos.'
            }
          />
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Dia" name="dia" type="date" required defaultValue={inicial?.dia ?? preenchido?.dia ?? hoje} />
          <Campo rotulo="Hora" name="hora" type="time" required step={300} defaultValue={inicial?.hora ?? preenchido?.hora ?? '09:00'} />
          <Campo
            rotulo="Duração (min)"
            name="duracao"
            inputMode="numeric"
            value={duracao}
            onChange={(ev) => setDuracao(ev.currentTarget.value.replace(/\D/g, '').slice(0, 3))}
          />
        </div>

        {/* ── para quem ── */}
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold text-tinta">{palavras.Pessoa}</legend>
          {cliente ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-norte border border-marca/40 bg-marca-suave px-3 py-2">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-semibold text-tinta">{cliente.nome}</span>
                <span className="text-xs text-tinta-2">do cadastro de {palavras.pessoas}</span>
              </span>
              <Botao type="button" tom="discreto" className="px-2 py-1 text-xs" onClick={() => setCliente(null)}>
                trocar
              </Botao>
            </div>
          ) : (
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
                  aria-label={`Cadastro de ${palavras.pessoas}`}
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
          )}
          <Campo
            rotulo="WhatsApp"
            name="telefone"
            type="tel"
            inputMode="tel"
            value={telefone}
            onChange={(ev) => setTelefone(ev.currentTarget.value)}
            placeholder="(71) 99999-0000"
            dica="Opcional. Com ele, a agenda abre a conversa num toque."
          />
        </fieldset>

        <Campo
          rotulo="Observação"
          name="observacao"
          defaultValue={inicial?.observacao ?? undefined}
          maxLength={500}
          placeholder={palavras.avisoObservacao ? 'Chega 10 minutos antes' : 'Prefere a cadeira da janela'}
          dica={palavras.avisoObservacao ?? 'Só combinados do atendimento.'}
        />
        {palavras.avisoObservacao && (
          <p className="-mt-2 text-xs font-medium text-atencao">
            O Norte não guarda prontuário. Informação de saúde fica com o profissional, no sistema próprio dele.
          </p>
        )}

        {estado.pedeConfirmacao && (
          <Marcar
            name="confirmar"
            titulo="É isso mesmo"
            resumo="Marque para salvar o horário assim — fora do funcionamento da loja ou num horário que já passou."
          />
        )}

        <div className="flex justify-end">
          <Botao type="submit" carregando={pendente}>
            {pendente ? 'Salvando...' : editando ? 'Salvar horário' : 'Marcar horário'}
          </Botao>
        </div>
      </form>
    </Cartao>
  )
}
