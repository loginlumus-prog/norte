'use client'

// "Chegou": quanto chegou de cada item (já vem preenchido com o que falta),
// o custo desta compra e, se a pessoa puder, a conta a pagar do fornecedor.
//
// A CHAVE é sorteada quando o formulário abre e vai junto no envio. O clique
// duplo, ou a rede que manda o mesmo POST de novo, bate na mesma chave, e o
// servidor responde "já estava registrado" sem dar entrada outra vez.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, Cartao, Marcar, Selecao } from '@/ui/base'
import { Confirmar } from '@/ui/Confirmar'
import { brl } from '@/ui/painel'
import { classeDaAcao, DicaDaAcao, IconeDaAcao } from '@/ui/premium'
import { mudarPedidoAcao, receberPedidoAcao } from '../acoes'

type Item = { id: string; descricao: string; medida: string; falta: number; custoUnit: number | null }

const paraNumero = (t: string) => {
  const s = t.trim()
  if (!s) return 0
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s)
}
const doNumero = (n: number | null, casas = 2) => (n == null ? '' : n.toFixed(casas).replace('.', ',').replace(/,0+$/, casas === 2 ? ',00' : ''))
const novaChave = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

export function Receber({
  slug,
  pedidoId,
  itens,
  categorias,
  hoje,
}: {
  slug: string
  pedidoId: string
  itens: Item[]
  /** Vazio quando a pessoa não lança no financeiro (ou não há categoria): a conta não aparece. */
  categorias: { id: string; nome: string }[]
  hoje: string
}) {
  const [aberto, setAberto] = useState(false)
  const [chave, setChave] = useState(novaChave)
  const [qtd, setQtd] = useState<Record<string, string>>(() => Object.fromEntries(itens.map((i) => [i.id, doNumero(i.falta, 3)])))
  const [custo, setCusto] = useState<Record<string, string>>(() => Object.fromEntries(itens.map((i) => [i.id, doNumero(i.custoUnit)])))
  const [lancar, setLancar] = useState(categorias.length > 0)
  const [categoria, setCategoria] = useState(
    () => (categorias.find((c) => /mercadoria|compra|insumo|material/i.test(c.nome)) ?? categorias[0])?.id ?? '',
  )
  const [vencimento, setVencimento] = useState(hoje)
  const [pago, setPago] = useState(false)
  const [recado, setRecado] = useState<{ ok?: string; erro?: string; avisos?: string[] } | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  if (!aberto) {
    return (
      <div className="flex flex-col gap-2">
        <Botao tom="confirmar" onClick={() => setAberto(true)} className="w-fit">
          Chegou — dar entrada
        </Botao>
        {recado?.ok && <Aviso nivel="bom">{[recado.ok, ...(recado.avisos ?? [])].join(' ')}</Aviso>}
      </div>
    )
  }

  const total = itens.reduce((s, i) => s + paraNumero(qtd[i.id] ?? '') * paraNumero(custo[i.id] ?? ''), 0)

  function enviar() {
    setRecado(null)
    comecar(async () => {
      const r = await receberPedidoAcao(slug, pedidoId, {
        chave,
        itens: itens.map((i) => ({
          itemId: i.id,
          quantidade: paraNumero(qtd[i.id] ?? ''),
          custoUnit: (custo[i.id] ?? '').trim() ? paraNumero(custo[i.id]!) : null,
        })),
        conta: lancar && categoria ? { categoriaId: categoria, vencimento, jaPago: pago } : null,
      })
      setRecado(r)
      if (r.ok) {
        // Recebimento novo, chave nova: a próxima parte que chegar é outra.
        setChave(novaChave())
        setAberto(false)
        router.refresh()
      }
    })
  }

  return (
    <Cartao
      caixa
      titulo="O que chegou"
      acao={
        <button type="button" onClick={() => setAberto(false)} className={classeDaAcao()} aria-label="Fechar o recebimento">
          <IconeDaAcao icone="fechar" />
          <DicaDaAcao>Fechar</DicaDaAcao>
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        {recado?.erro && <Aviso nivel="critico">{recado.erro}</Aviso>}
        <ul className="flex flex-col divide-y divide-borda-suave rounded-norte border border-borda">
          {itens.map((i) => (
            <li key={i.id} className="grid grid-cols-1 items-end gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-sm font-medium text-tinta">{i.descricao}</span>
                <span className="text-xs text-tinta-3">
                  faltava {i.falta.toLocaleString('pt-BR')} {i.medida.toLowerCase()}
                </span>
              </span>
              <Campo
                rotulo="Chegou"
                name={`chegou-${i.id}`}
                inputMode="decimal"
                value={qtd[i.id] ?? ''}
                onChange={(ev) => {
                  const v = ev.currentTarget.value
                  setQtd((m) => ({ ...m, [i.id]: v }))
                }}
              />
              <Campo
                rotulo="Custo unit."
                name={`custo-${i.id}`}
                inputMode="decimal"
                placeholder="0,00"
                value={custo[i.id] ?? ''}
                onChange={(ev) => {
                  const v = ev.currentTarget.value
                  setCusto((m) => ({ ...m, [i.id]: v }))
                }}
              />
            </li>
          ))}
        </ul>
        <p className="text-sm text-tinta-2">
          Valor desta entrega: <b className="numero text-tinta">{brl(total)}</b>. O custo informado passa a ser o custo do produto
          (quem pode mexer em preço).
        </p>

        {categorias.length > 0 && (
          <fieldset className="flex flex-col gap-3">
            <Marcar name="lancar" checked={lancar} onChange={(ev) => setLancar(ev.currentTarget.checked)} titulo="Lançar a conta a pagar do fornecedor" resumo="Vai para o Financeiro com o valor desta entrega." />
            {lancar && (
              <div className="grid gap-4 sm:grid-cols-3">
                <Selecao rotulo="Categoria" name="categoria" value={categoria} onChange={(ev) => setCategoria(ev.currentTarget.value)} opcoes={categorias.map((c) => ({ valor: c.id, titulo: c.nome }))} />
                <Campo rotulo="Vencimento" name="vencimento" type="date" value={vencimento} onChange={(ev) => setVencimento(ev.currentTarget.value)} />
                <Marcar name="pago" checked={pago} onChange={(ev) => setPago(ev.currentTarget.checked)} titulo="Já foi pago" />
              </div>
            )}
          </fieldset>
        )}

        <div className="flex justify-end">
          <Botao tom="confirmar" carregando={indo} onClick={enviar}>
            {indo ? 'Dando entrada...' : 'Dar entrada no estoque'}
          </Botao>
        </div>
      </div>
    </Cartao>
  )
}

export function AcoesDoPedido({
  slug,
  pedidoId,
  situacao,
}: {
  slug: string
  pedidoId: string
  situacao: 'RASCUNHO' | 'ENVIADO' | 'PARCIAL' | 'RECEBIDO' | 'CANCELADO'
}) {
  const [motivo, setMotivo] = useState('')
  const [cancelando, setCancelando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()
  const agir = (m: Parameters<typeof mudarPedidoAcao>[2]) =>
    comecar(async () => {
      const r = await mudarPedidoAcao(slug, pedidoId, m)
      if (r.erro) setErro(r.erro)
      else {
        setCancelando(false)
        router.refresh()
      }
    })

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {situacao === 'RASCUNHO' && (
          <Botao tom="secundario" carregando={indo} onClick={() => agir({ acao: 'enviar' })}>
            Mandei o pedido ao fornecedor
          </Botao>
        )}
        {situacao === 'PARCIAL' && (
          <Confirmar tom="secundario" tomSim="principal" pergunta="O resto não vem mais?" sim="Sim, encerrar" aoConfirmar={() => mudarPedidoAcao(slug, pedidoId, { acao: 'encerrar' })}>
            Dar por encerrado
          </Confirmar>
        )}
        {(situacao === 'RASCUNHO' || situacao === 'ENVIADO') && !cancelando && (
          <Botao tom="discreto" onClick={() => setCancelando(true)}>
            Cancelar pedido
          </Botao>
        )}
      </div>
      {cancelando && (
        <div className="flex flex-wrap items-end gap-2">
          <Campo rotulo="Por que cancelar?" name="motivo" value={motivo} onChange={(ev) => setMotivo(ev.currentTarget.value)} placeholder="O fornecedor não tem" />
          <Botao tom="perigo" carregando={indo} disabled={motivo.trim().length < 3} onClick={() => agir({ acao: 'cancelar', motivo })}>
            Cancelar pedido
          </Botao>
          <Botao tom="discreto" onClick={() => setCancelando(false)}>
            Voltar
          </Botao>
        </div>
      )}
      {erro && <Aviso nivel="critico">{erro}</Aviso>}
    </div>
  )
}
