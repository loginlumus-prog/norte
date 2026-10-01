'use client'

// Corrigir a data da venda — a loja lançou no outro sistema e registrou aqui
// no dia seguinte. Muda só o dia do fato; o caixa continua o do turno em que
// o dinheiro entrou (ver venda-data.ts). Mês que já passou pede confirmação.

import { useActionState, useState } from 'react'
import { Aviso, Botao, Campo } from '@/ui/base'
import { CampoDoPin, MotivosProntos } from '@/ui/Assinar'
import { semApagar } from '@/ui/formulario'
import { corrigirDataAcao, type EstadoData } from './acoesData'

export function CorrigirData({ slug, vendaId, dia, hoje }: { slug: string; vendaId: string; dia: string; hoje: string }) {
  const [aberto, setAberto] = useState(false)
  const [novo, setNovo] = useState(dia)
  const [motivo, setMotivo] = useState('')
  const [entendi, setEntendi] = useState(false)
  const [estado, agir, pendente] = useActionState<EstadoData, FormData>(corrigirDataAcao, {})

  if (estado.ok) return <Aviso nivel="bom">{estado.ok}</Aviso>

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="self-start text-sm font-medium text-tinta-2 underline-offset-2 hover:text-marca hover:underline"
      >
        Corrigir a data da venda
      </button>
    )
  }

  return (
    <form action={agir} onSubmit={semApagar(agir)} className="flex max-w-xl flex-col gap-3 rounded-norte border border-borda bg-superficie p-4">
      <input type="hidden" name="empresa" value={slug} />
      <input type="hidden" name="venda" value={vendaId} />
      {estado.avisos?.length && entendi ? <input type="hidden" name="confirmado" value="1" /> : null}

      <div className="flex flex-col gap-1">
        <p className="text-sm font-bold text-tinta">Em que dia foi esta venda?</p>
        <p className="text-[13px] leading-relaxed text-tinta-2">
          Muda só o dia da venda — é por ele que o resultado do mês, as metas e os relatórios contam. O caixa continua o
          do turno em que o dinheiro entrou, e itens, valores e formas não mudam.
        </p>
      </div>

      {estado.erro && !estado.avisos?.length && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.avisos?.length ? (
        <Aviso nivel="atencao">
          <span className="flex flex-col gap-2">
            {estado.avisos.map((a) => (
              <span key={a}>{a}</span>
            ))}
            <label className="flex items-center gap-2 font-semibold">
              <input type="checkbox" checked={entendi} onChange={(e) => setEntendi(e.target.checked)} />
              Entendi, corrigir mesmo assim
            </label>
          </span>
        </Aviso>
      ) : null}

      <Campo rotulo="Dia certo" name="dia" type="date" max={hoje} value={novo} onChange={(e) => { setNovo(e.target.value); setEntendi(false) }} required />
      <MotivosProntos excecao="venda.data" atual={motivo} aoEscolher={setMotivo} />
      <Campo
        rotulo="Motivo"
        name="motivo"
        required
        minLength={3}
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        placeholder="Venda de sábado lançada na segunda"
      />
      {estado.precisaPin && <CampoDoPin slug={slug} name="pin" />}

      <div className="flex gap-2">
        <Botao type="submit" carregando={pendente} disabled={novo === dia || (!!estado.avisos?.length && !entendi)}>
          {pendente ? 'Corrigindo...' : 'Corrigir a data'}
        </Botao>
        <Botao type="button" tom="secundario" onClick={() => setAberto(false)}>
          Deixar como está
        </Botao>
      </div>
    </form>
  )
}
