'use client'

// A ficha de quem trabalha: nome, cargo, loja, se atende com hora marcada, a
// jornada combinada e — quando a pessoa entra no sistema — a conta dela.
//
// A jornada é em HORAS por dia da semana ("8", "4,5", vazio = folga), porque é
// assim que o contrato é falado. O servidor guarda em minutos.

import { useActionState, useEffect, useRef, useState } from 'react'
import { Aviso, Botao, Campo, Cartao, Marcar, Selecao } from '@/ui/base'
import { semApagar } from '@/ui/formulario'
import { BotaoDaLinha, DicaDaAcao, IconeDaAcao, classeDaAcao } from '@/ui/premium'
import { salvarColaboradorAcao, type EstadoFicha } from './acoes'

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export type FichaInicial = {
  id: string
  nome: string
  cargo: string | null
  telefone: string | null
  unidadeId: string | null
  usuarioId: string | null
  atende: boolean
  jornadaMin: number[]
  ativo: boolean
}

const horasDoCampo = (min: number | undefined) => (min ? String(Math.round((min / 60) * 100) / 100).replace('.', ',') : '')

export function Ficha({
  slug,
  lojas,
  contas,
  podeSemLoja,
  pontoLigado,
  agendaLigada,
  inicial,
  voltarPara,
}: {
  slug: string
  lojas: { id: string; nome: string }[]
  /** Contas da equipe sem ficha (e a desta ficha), para ligar. */
  contas: { id: string; nome: string }[]
  /** Pode cadastrar quem circula entre as lojas (responde por todas). */
  podeSemLoja: boolean
  pontoLigado: boolean
  agendaLigada: boolean
  inicial?: FichaInicial
  voltarPara: string
}) {
  const editando = !!inicial
  const [aberto, setAberto] = useState(editando)
  const acao = salvarColaboradorAcao.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoFicha, FormData>(acao, {})
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    if (estado.ok && !editando) {
      formRef.current?.reset()
      setAberto(false)
    }
  }, [estado.vez, estado.ok, editando])

  if (!aberto) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Botao onClick={() => setAberto(true)}>+ Cadastrar quem trabalha</Botao>
        {estado.ok && <span className="text-sm font-medium text-bom">{estado.ok}</span>}
      </div>
    )
  }

  const opcoesLoja = [
    ...(podeSemLoja ? [{ valor: '', titulo: 'Todas as lojas (circula entre elas)' }] : []),
    ...lojas.map((l) => ({ valor: l.id, titulo: l.nome })),
  ]

  return (
    <Cartao
      caixa
      titulo={editando ? `Ficha de ${inicial!.nome}` : 'Quem trabalha aqui'}
      acao={
        editando ? (
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome" name="nome" required defaultValue={inicial?.nome} placeholder="Bia Santos" />
          <Campo rotulo="Cargo" name="cargo" defaultValue={inicial?.cargo ?? undefined} placeholder="O que a pessoa faz aqui" />
          <Campo rotulo="Telefone" name="telefone" type="tel" inputMode="tel" defaultValue={inicial?.telefone ?? undefined} placeholder="(71) 99999-0000" />
          {opcoesLoja.length > 1 ? (
            <Selecao rotulo="Loja" name="unidadeId" defaultValue={inicial?.unidadeId ?? (podeSemLoja ? '' : lojas[0]?.id)} opcoes={opcoesLoja} />
          ) : (
            <input type="hidden" name="unidadeId" value={opcoesLoja[0]?.valor ?? ''} />
          )}
        </div>

        <Selecao
          rotulo="Conta no sistema"
          name="usuarioId"
          defaultValue={inicial?.usuarioId ?? ''}
          opcoes={[{ valor: '', titulo: 'Não entra no sistema' }, ...contas.map((c) => ({ valor: c.id, titulo: c.nome }))]}
          dica="Com a conta ligada, a pessoa bate o próprio ponto. Sem conta, quem bate é o gestor — e a folha diz isso."
        />

        {agendaLigada && (
          <Marcar
            name="atende"
            defaultChecked={inicial?.atende ?? false}
            titulo="Atende com horário marcado"
            resumo="Vira uma coluna na Agenda, com os horários livres dela."
          />
        )}

        {pontoLigado && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold text-tinta">Jornada combinada (horas por dia)</legend>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {DIAS.map((d, i) => (
                <Campo
                  key={d}
                  rotulo={d}
                  name={`jornada_${i}`}
                  inputMode="decimal"
                  defaultValue={horasDoCampo(inicial?.jornadaMin[i])}
                  placeholder="—"
                />
              ))}
            </div>
            <p className="text-xs text-tinta-3">Vazio é folga. Sem jornada, a folha mostra só as horas trabalhadas — sem extra e sem falta.</p>
          </fieldset>
        )}
        {!pontoLigado && inicial && inicial.jornadaMin.map((m, i) => <input key={i} type="hidden" name={`jornada_${i}`} value={horasDoCampo(m)} />)}

        {editando && (
          <Marcar
            name="ativo"
            defaultChecked={inicial!.ativo}
            titulo="Trabalha aqui"
            resumo="Desmarque quando a pessoa sair. A ficha, o ponto e a agenda dela continuam guardados."
          />
        )}

        <div className="flex justify-end">
          <Botao type="submit" carregando={pendente}>
            {pendente ? 'Salvando...' : editando ? 'Salvar ficha' : 'Cadastrar'}
          </Botao>
        </div>
      </form>
    </Cartao>
  )
}
