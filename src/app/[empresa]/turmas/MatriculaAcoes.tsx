'use client'

// O que se faz com a matrícula de um aluno, na própria linha da turma.
//
// Trancar, cancelar e concluir pedem o MOTIVO antes — ele fica na história do
// aluno e no livro. Reativar pergunta antes (o "Confirmar" de sempre). "Valor
// e bolsa" é de quem gere a escola, e acerta as mensalidades em aberto.

import { useActionState, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo } from '@/ui/base'
import { Confirmar } from '@/ui/Confirmar'
import { semApagar } from '@/ui/formulario'
import { editarMatriculaAcao, mudarMatriculaAcao, type EstadoEscola } from './acoes'

type Saida = 'TRANCADA' | 'CANCELADA' | 'CONCLUIDA'

const VERBO: Record<Saida, { botao: string; pergunta: string; sim: string; dica: string }> = {
  TRANCADA: { botao: 'Trancar', pergunta: 'Por que trancou?', sim: 'Trancar', dica: 'Viagem, saúde, pausa. Volta com "Reativar".' },
  CANCELADA: { botao: 'Cancelar', pergunta: 'Por que saiu?', sim: 'Cancelar matrícula', dica: 'Mudou de cidade, desistiu. Não volta: quem volta faz matrícula nova.' },
  CONCLUIDA: { botao: 'Concluir', pergunta: 'Terminou como?', sim: 'Concluir', dica: 'Fim do curso, formatura.' },
}

export function MatriculaAcoes({
  slug,
  matriculaId,
  situacao,
  podeMatricular,
  podeGerir,
  valor,
  diaVencimento,
  descontoPct,
  descontoValor,
  descontoMotivo,
}: {
  slug: string
  matriculaId: string
  situacao: 'ATIVA' | 'TRANCADA' | 'CANCELADA' | 'CONCLUIDA'
  podeMatricular: boolean
  podeGerir: boolean
  valor: number
  diaVencimento: number
  descontoPct: number
  descontoValor: number
  descontoMotivo: string | null
}) {
  const [saida, setSaida] = useState<Saida | null>(null)
  const [motivo, setMotivo] = useState('')
  const [valores, setValores] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()
  const acaoValor = editarMatriculaAcao.bind(null, slug)
  const [estadoValor, agirValor, pendenteValor] = useActionState<EstadoEscola, FormData>(acaoValor, {})

  const encerrada = situacao === 'CANCELADA' || situacao === 'CONCLUIDA'
  if (encerrada) return null

  const mudar = (para: string, m: string) =>
    comecar(async () => {
      setErro(null)
      const r = await mudarMatriculaAcao(slug, matriculaId, para, m)
      if (r.erro) setErro(r.erro)
      else {
        setOk(r.ok ?? 'Pronto.')
        setSaida(null)
        setMotivo('')
        router.refresh()
      }
    })

  if (saida) {
    const v = VERBO[saida]
    return (
      <div className="flex min-w-[16rem] flex-col gap-2 rounded-norte border border-borda bg-superficie-2 p-2 text-xs">
        {erro && <Aviso nivel="critico">{erro}</Aviso>}
        <Campo rotulo={v.pergunta} name="motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} dica={v.dica} autoFocus />
        <div className="flex gap-2">
          <Botao tom="perigo" className="py-1 text-xs" carregando={indo} disabled={motivo.trim().length < 3} onClick={() => mudar(saida, motivo)}>
            {v.sim}
          </Botao>
          <Botao tom="discreto" className="py-1 text-xs" onClick={() => setSaida(null)}>
            Voltar
          </Botao>
        </div>
      </div>
    )
  }

  if (valores) {
    return (
      <form action={agirValor} onSubmit={semApagar(agirValor)} className="flex min-w-[18rem] flex-col gap-2 rounded-norte border border-borda bg-superficie-2 p-2 text-xs">
        <input type="hidden" name="id" value={matriculaId} />
        {estadoValor.erro && <Aviso nivel="critico">{estadoValor.erro}</Aviso>}
        {estadoValor.ok && <Aviso nivel="bom">{estadoValor.ok}</Aviso>}
        <div className="grid grid-cols-2 gap-2">
          <Campo rotulo="Mensalidade (R$)" name="valor" inputMode="decimal" defaultValue={valor.toFixed(2).replace('.', ',')} />
          <Campo rotulo="Vence dia" name="diaVencimento" inputMode="numeric" defaultValue={diaVencimento} />
          <Campo rotulo="Bolsa (%)" name="descontoPct" inputMode="decimal" defaultValue={descontoPct ? String(descontoPct).replace('.', ',') : ''} placeholder="0" />
          <Campo rotulo="Desconto (R$)" name="descontoValor" inputMode="decimal" defaultValue={descontoValor ? descontoValor.toFixed(2).replace('.', ',') : ''} placeholder="0,00" />
        </div>
        <Campo rotulo="Motivo do desconto" name="descontoMotivo" defaultValue={descontoMotivo ?? ''} placeholder="irmão, bolsa de mérito, funcionário" />
        <p className="text-[11px] text-tinta-3">As mensalidades em aberto, deste mês em diante, mudam junto. O que já foi pago fica como está.</p>
        <div className="flex gap-2">
          <Botao type="submit" className="py-1 text-xs" carregando={pendenteValor}>
            Salvar
          </Botao>
          <Botao type="button" tom="discreto" className="py-1 text-xs" onClick={() => setValores(false)}>
            Fechar
          </Botao>
        </div>
      </form>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-1">
        {podeGerir && (
          <Botao tom="secundario" className="py-1 text-xs" onClick={() => setValores(true)}>
            Valor e bolsa
          </Botao>
        )}
        {podeMatricular && situacao === 'TRANCADA' && (
          <Confirmar pergunta="Reativar a matrícula?" sim="Reativar" tomSim="confirmar" className="py-1 text-xs" aoConfirmar={() => mudar('ATIVA', '')}>
            Reativar
          </Confirmar>
        )}
        {podeMatricular &&
          (situacao === 'ATIVA' ? (['TRANCADA', 'CANCELADA', 'CONCLUIDA'] as Saida[]) : (['CANCELADA'] as Saida[])).map((s) => (
            <Botao key={s} tom="discreto" className="py-1 text-xs" onClick={() => setSaida(s)}>
              {VERBO[s].botao}
            </Botao>
          ))}
      </div>
      {erro && <span className="text-xs text-critico">{erro}</span>}
      {ok && <span className="text-xs text-bom">{ok}</span>}
    </div>
  )
}
