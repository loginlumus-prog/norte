'use client'

// Corrigir o saldo de um item pelo que foi CONTADO na prateleira.
//
// A pessoa digita o que contou, não a diferença. Pedir a diferença obrigaria
// quem está com a peça na mão a fazer a subtração de cabeça — e é exatamente
// aí que o erro entra, porque quem conta está em pé, no meio da loja, com
// pressa.
//
// O MOTIVO É OBRIGATÓRIO. Sem ele, seis meses depois ninguém consegue
// responder por que o saldo mudou, e o histórico deixa de servir para o que
// ele existe: dizer se o estoque some por quebra, por roubo ou por erro de
// digitação no balcão.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Botao, cx } from '@/ui/base'
import { CampoDoPin, MotivosProntos } from '@/ui/Assinar'
import { classeDaAcao, DicaDaAcao, IconeDaAcao } from '@/ui/premium'
import { contar } from './acoes'

export function Corrigir({
  slug,
  variacaoId,
  unidadeId,
  saldo,
}: {
  slug: string
  variacaoId: string
  unidadeId: string
  saldo: number
}) {
  const [aberto, setAberto] = useState(false)
  const [contado, setContado] = useState(String(saldo))
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  // O saldo que a pessoa VIU ao abrir: vai junto, e o servidor recusa se o
  // estoque mudou no meio da contagem (uma venda) — ver `corrigirPeloContado`.
  const [visto, setVisto] = useState(saldo)
  const [pedePin, setPedePin] = useState(false)
  const [pin, setPin] = useState('')
  const [indo, comecar] = useTransition()
  const router = useRouter()

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => {
          setVisto(saldo)
          setContado(String(saldo))
          setAberto(true)
        }}
        title="Corrigir o saldo pelo que foi contado na prateleira"
        className={classeDaAcao({ jeito: 'pilula' })}
      >
        <IconeDaAcao icone="editar" tamanho={15} />
        Corrigir
      </button>
    )
  }

  const diferenca = Number(contado) - visto

  return (
    <span className="flex w-full flex-wrap items-center justify-end gap-1.5">
      <input
        type="number"
        step="any"
        value={contado}
        autoFocus
        onChange={(e) => setContado(e.currentTarget.value)}
        aria-label="Quantas você contou"
        className="numero w-20 rounded-norte border border-borda bg-superficie px-2 py-1 text-sm text-tinta"
      />
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.currentTarget.value)}
        placeholder="Motivo"
        aria-label="Motivo da correção"
        className="w-32 rounded-norte border border-borda bg-superficie px-2 py-1 text-sm text-tinta placeholder:text-tinta-3"
      />
      {/* A diferença aparece calculada: a pessoa digita o que contou e vê o
          que isso significa, sem fazer conta. */}
      {diferenca !== 0 && Number.isFinite(diferenca) && (
        <span
          className={cx(
            'numero text-xs font-semibold',
            diferenca > 0 ? 'text-bom' : 'text-critico',
          )}
        >
          {diferenca > 0 ? '+' : ''}
          {diferenca}
        </span>
      )}
      <Botao
        tom="confirmar"
        className="px-2 py-1 text-xs"
        carregando={indo}
        onClick={() =>
          comecar(async () => {
            setErro(null)
            const r = await contar(slug, variacaoId, unidadeId, Number(contado), motivo, visto, pin || null)
            setPin('')
            if (r.erro) {
              setErro(r.erro)
              if (r.precisaPin) setPedePin(true)
              // O número mudou: a tela passa a mostrar o novo, e a pessoa
              // confere de novo antes de mandar.
              if (r.saldo !== undefined) {
                setVisto(r.saldo)
                router.refresh()
              }
              return
            }
            setAberto(false)
            setMotivo('')
            setPedePin(false)
            router.refresh()
          })
        }
      >
        Corrigir
      </Botao>
      <button
        type="button"
        onClick={() => {
          setAberto(false)
          setErro(null)
        }}
        className={classeDaAcao()}
        aria-label="Cancelar"
      >
        <IconeDaAcao icone="fechar" />
        <DicaDaAcao>Cancelar</DicaDaAcao>
      </button>
      <span className="flex w-full justify-end">
        <MotivosProntos excecao="estoque.ajuste" atual={motivo} aoEscolher={setMotivo} className="justify-end" />
      </span>
      {pedePin && (
        <span className="flex w-full justify-end">
          <CampoDoPin slug={slug} valor={pin} aoMudar={setPin} />
        </span>
      )}
      {erro && <span className="w-full text-right text-xs font-medium text-critico">{erro}</span>}
    </span>
  )
}
