'use client'

// Estornar o recibo lançado errado — a cliente errada, o valor com um zero a
// mais. Fica na tela do recibo (nunca no papel) e só para quem pode cancelar
// venda na loja dele. Pede o motivo e o PIN de quem estorna: é dinheiro saindo
// do registro. O servidor confere tudo de novo (ver `estornarRecibo`).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, cx } from '@/ui/base'
import { IconeDaAcao, classeDaAcao } from '@/ui/premium'
import { estornarReciboAcao } from '../../acoes'

export function Estornar({ slug, reciboId, clienteId, codigo }: { slug: string; reciboId: string; clienteId: string; codigo: string }) {
  const [aberto, setAberto] = useState(false)
  const [motivo, setMotivo] = useState('')
  const [pin, setPin] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        title="Lançado errado? Estornar este recibo"
        className={cx(classeDaAcao({ jeito: 'pilula', tom: 'perigo' }), 'self-start')}
      >
        <IconeDaAcao icone="devolver" tamanho={15} />
        Estornar este recibo
      </button>
    )
  }

  function estornar() {
    setErro(null)
    comecar(async () => {
      const r = await estornarReciboAcao(slug, { reciboId, clienteId, motivo, pin: pin || null })
      if (!r.ok) {
        setErro(r.erro)
        return
      }
      router.push(`/${slug}/crediario?cliente=${clienteId}`)
    })
  }

  return (
    <div className="flex flex-col gap-3 rounded-norte border border-critico-borda bg-superficie p-3">
      <p className="text-sm font-bold text-tinta">Estornar o recibo {codigo}</p>
      <p className="text-[13px] text-tinta-2">
        As parcelas voltam a ser o que eram antes dele, e ele sai do caixa e dos relatórios. O que entrou em dinheiro sai da
        conta da gaveta: devolva à cliente ou receba de novo, certo. Só o recibo mais novo de cada parcela, com o turno dele
        ainda aberto.
      </p>
      {erro && <Aviso nivel="critico">{erro}</Aviso>}
      <Campo rotulo="Por que estornar" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} placeholder="ex.: lançado na cliente errada" />
      <Campo
        rotulo="Seu PIN"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
      />
      <div className="flex gap-2">
        <Botao tom="perigo" onClick={estornar} carregando={indo} disabled={motivo.trim().length < 3}>
          Estornar
        </Botao>
        <Botao tom="discreto" onClick={() => setAberto(false)} disabled={indo}>
          Voltar
        </Botao>
      </div>
    </div>
  )
}
