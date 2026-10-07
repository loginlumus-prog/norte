'use client'

// A ficha da turma: o nome, o curso, o turno, os dias e o horário, quem dá
// aula, quantos cabem, o período e a mensalidade PADRÃO — a que a matrícula
// nova recebe. Mudar a mensalidade aqui não muda quem já está matriculado: o
// contrato de cada um é o dele (ver escola.ts).

import { useActionState, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Aviso, Botao, Campo, Cartao, Marcar, Selecao } from '@/ui/base'
import { semApagar } from '@/ui/formulario'
import { BotaoDaLinha, DicaDaAcao, IconeDaAcao, classeDaAcao } from '@/ui/premium'
import { salvarTurmaAcao, type EstadoEscola } from './acoes'
import { professoresDaUnidadeEscolhida, type ProfessorNaTela } from './professores'

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export type TurmaInicial = {
  id: string
  unidadeId: string
  nome: string
  curso: string | null
  turno: string | null
  professorId: string | null
  dias: number[]
  horaInicio: string | null
  horaFim: string | null
  capacidade: number | null
  inicio: string | null
  fim: string | null
  mensalidade: number
  diaVencimento: number
  ativa: boolean
}

const reaisDoCampo = (v: number) => v.toFixed(2).replace('.', ',')

export function TurmaForm({
  slug,
  lojas,
  professores,
  inicial,
  voltarPara,
}: {
  slug: string
  lojas: { id: string; nome: string }[]
  /** De todas as unidades do formulário; a lista mostra os da unidade escolhida. */
  professores: ProfessorNaTela[]
  inicial?: TurmaInicial
  /** Na edição, o "fechar" volta para cá. */
  voltarPara?: string
}) {
  const editando = !!inicial
  const [aberto, setAberto] = useState(editando)
  const acao = salvarTurmaAcao.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoEscola, FormData>(acao, {})
  const formRef = useRef<HTMLFormElement>(null)
  const [unidade, setUnidade] = useState(inicial?.unidadeId ?? lojas[0]?.id ?? '')
  const daUnidade = professoresDaUnidadeEscolhida(professores, unidade)

  useEffect(() => {
    if (estado.ok && !editando) {
      formRef.current?.reset()
      setAberto(false)
    }
  }, [estado.vez, estado.ok, editando])

  if (!aberto) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Botao onClick={() => setAberto(true)}>+ Nova turma</Botao>
        {estado.ok && (
          <span className="text-sm font-medium text-bom">
            {estado.ok}{' '}
            {estado.id && (
              <Link href={`/${slug}/turmas/${estado.id}`} className="underline underline-offset-2">
                Abrir a turma
              </Link>
            )}
          </span>
        )}
      </div>
    )
  }

  return (
    <Cartao
      caixa
      titulo={editando ? `Turma ${inicial!.nome}` : 'Nova turma'}
      acao={
        editando && voltarPara ? (
          <BotaoDaLinha href={voltarPara} icone="fechar" rotulo="Fechar" />
        ) : (
          <button type="button" onClick={() => setAberto(false)} className={classeDaAcao()} aria-label="Fechar">
            <IconeDaAcao icone="fechar" />
            <DicaDaAcao>Fechar</DicaDaAcao>
          </button>
        )
      }
    >
      <form ref={formRef} action={agir} onSubmit={semApagar(agir)} className="flex flex-col gap-4">
        {inicial && <input type="hidden" name="id" value={inicial.id} />}
        {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
        {estado.ok && editando && <Aviso nivel="bom">{estado.ok}</Aviso>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome da turma" name="nome" required defaultValue={inicial?.nome} placeholder="1º ano A · Inglês terça e quinta" />
          <Campo rotulo="Curso ou série" name="curso" defaultValue={inicial?.curso ?? undefined} placeholder="Inglês básico, 1º ano, Ballet infantil" />
          {lojas.length > 1 ? (
            <Selecao
              rotulo="Unidade"
              name="unidadeId"
              value={unidade}
              onChange={(e) => setUnidade(e.target.value)}
              opcoes={lojas.map((l) => ({ valor: l.id, titulo: l.nome }))}
            />
          ) : (
            <input type="hidden" name="unidadeId" value={inicial?.unidadeId ?? lojas[0]?.id ?? ''} />
          )}
          <Selecao
            rotulo="Turno"
            name="turno"
            defaultValue={inicial?.turno ?? ''}
            opcoes={[
              { valor: '', titulo: '—' },
              { valor: 'manha', titulo: 'Manhã' },
              { valor: 'tarde', titulo: 'Tarde' },
              { valor: 'noite', titulo: 'Noite' },
              { valor: 'integral', titulo: 'Integral' },
            ]}
          />
          {/* A chave troca com a unidade: a escolha feita para a Sede não fica
              presa ao trocar para a outra unidade, onde aquela pessoa não dá aula. */}
          <Selecao
            key={unidade}
            rotulo="Quem dá aula"
            name="professorId"
            defaultValue={daUnidade.some((p) => p.id === inicial?.professorId) ? (inicial?.professorId ?? '') : ''}
            opcoes={[{ valor: '', titulo: 'Ainda não definido' }, ...daUnidade.map((p) => ({ valor: p.id, titulo: p.cargo ? `${p.nome} (${p.cargo})` : p.nome }))]}
            dica="A lista de Funcionários. A pessoa não precisa ter login."
          />
          <Campo
            rotulo="Capacidade"
            name="capacidade"
            inputMode="numeric"
            defaultValue={inicial?.capacidade ?? undefined}
            placeholder="Sem limite"
            dica="Quantos alunos cabem. Vazio = sem limite."
          />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-semibold text-tinta">Dias de aula</legend>
          <div className="flex flex-wrap gap-2">
            {DIAS.map((d, i) => (
              <label key={d} className="flex items-center gap-1.5 rounded-norte border border-borda bg-superficie px-2.5 py-1.5 text-sm has-checked:border-marca has-checked:bg-marca-suave">
                <input type="checkbox" name={`dia_${i}`} defaultChecked={inicial?.dias.includes(i)} className="accent-[var(--marca)]" />
                {d}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-4">
          <Campo rotulo="Começa às" name="horaInicio" type="time" defaultValue={inicial?.horaInicio ?? undefined} />
          <Campo rotulo="Termina às" name="horaFim" type="time" defaultValue={inicial?.horaFim ?? undefined} />
          <Campo rotulo="Início do período" name="inicio" type="date" defaultValue={inicial?.inicio ?? undefined} />
          <Campo rotulo="Fim do período" name="fim" type="date" defaultValue={inicial?.fim ?? undefined} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Mensalidade padrão (R$)"
            name="mensalidade"
            inputMode="decimal"
            required
            defaultValue={inicial ? reaisDoCampo(inicial.mensalidade) : undefined}
            placeholder="450,00"
            dica={editando ? 'Vale para quem se matricular daqui em diante. Quem já estuda continua com o valor dele.' : 'É o valor que a matrícula nova recebe.'}
          />
          <Campo
            rotulo="Dia do vencimento"
            name="diaVencimento"
            inputMode="numeric"
            required
            defaultValue={inicial?.diaVencimento ?? 10}
            dica="De 1 a 28 — o 29, 30 e 31 não existem em todo mês."
          />
        </div>

        {editando && (
          <Marcar
            name="ativa"
            defaultChecked={inicial!.ativa}
            titulo="Turma em andamento"
            resumo="Desmarque quando a turma acabar. Ela sai da lista e não recebe matrícula; os alunos e as mensalidades continuam guardados."
          />
        )}

        <div className="flex justify-end">
          <Botao type="submit" carregando={pendente}>
            {pendente ? 'Salvando...' : editando ? 'Salvar turma' : 'Criar turma'}
          </Botao>
        </div>
      </form>
    </Cartao>
  )
}
