'use client'

// Lançar uma AVARIA: tirar do estoque o que quebrou, amassou, venceu ou
// derreteu. A pessoa diz QUANTAS foram (e não o saldo que sobrou, como no
// "corrigir"): quem está com o picolé amassado na mão sabe quantos são, e não
// precisa contar o freezer inteiro.
//
// É a única coisa que esta tela faz por quem tem só a permissão de avaria: tira
// do estoque, com motivo, e fica no livro. Dar entrada, transferir e corrigir o
// saldo são de quem ajusta o estoque.
//
// O motivo é obrigatório — com os mais comuns em botão, para o caminho mais
// curto ser o certo.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Botao } from '@/ui/base'
import { CampoDoPin, MotivosProntos } from '@/ui/Assinar'
import { classeDaAcao, DicaDaAcao, IconeDaAcao } from '@/ui/premium'
import { avariaAcao } from './acoes'

export function Avaria({
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
  const [quantidade, setQuantidade] = useState('')
  const [motivo, setMotivo] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [pedePin, setPedePin] = useState(false)
  const [pin, setPin] = useState('')
  const [indo, comecar] = useTransition()
  const router = useRouter()

  // Sem nada em estoque não há o que tirar.
  if (saldo <= 0) return null

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        title="Tirar do estoque o que quebrou, amassou ou venceu"
        className={classeDaAcao({ jeito: 'pilula', tom: 'perigo' })}
      >
        <IconeDaAcao icone="excluir" tamanho={15} />
        Avaria
      </button>
    )
  }

  const n = Number(quantidade.replace(',', '.'))
  const valida = Number.isFinite(n) && n > 0

  return (
    <span className="flex w-full flex-wrap items-center justify-end gap-1.5">
      <input
        type="number"
        step="any"
        min="0"
        value={quantidade}
        autoFocus
        onChange={(e) => setQuantidade(e.currentTarget.value)}
        placeholder="Quantas"
        aria-label="Quantas quebraram ou estragaram"
        className="numero w-20 rounded-norte border border-borda bg-superficie px-2 py-1 text-sm text-tinta placeholder:text-tinta-3"
      />
      <input
        value={motivo}
        onChange={(e) => setMotivo(e.currentTarget.value)}
        placeholder="Motivo"
        aria-label="Motivo da avaria"
        className="w-32 rounded-norte border border-borda bg-superficie px-2 py-1 text-sm text-tinta placeholder:text-tinta-3"
      />
      <Botao
        tom="confirmar"
        className="px-2 py-1 text-xs"
        carregando={indo}
        disabled={!valida}
        onClick={() =>
          comecar(async () => {
            setErro(null)
            const r = await avariaAcao(slug, { variacaoId, unidadeId, quantidade: n, motivo, pin: pin || null })
            setPin('')
            if (r.erro) {
              setErro(r.erro)
              if (r.precisaPin) setPedePin(true)
              // Tinha menos do que a tela mostrava (uma venda no meio): mostra o número novo.
              if (r.saldo !== undefined) router.refresh()
              return
            }
            setAberto(false)
            setQuantidade('')
            setMotivo('')
            setPedePin(false)
            router.refresh()
          })
        }
      >
        Lançar avaria
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
        <MotivosProntos excecao="estoque.perda" atual={motivo} aoEscolher={setMotivo} className="justify-end" />
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
