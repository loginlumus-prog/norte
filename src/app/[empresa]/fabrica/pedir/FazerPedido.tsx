'use client'

// A loja pede à fábrica.
//
// A lista é o que a loja VENDE, por gaveta, com o que ela tem e o que vendeu
// nos últimos 7 dias — a conta que a gerente faz de cabeça na hora de pedir
// ("vendi 60 de coco na semana, tenho 12: peço 50"). Ela só digita o que
// quer; linha em branco não vai.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, Selecao, cx } from '@/ui/base'
import { CampoDoPin } from '@/ui/Assinar'
import { plural, quantidade } from '@/ui/texto'
import { criarPedidoAcao, type Recado } from '../acoes'
import { LEGIVEL, ler } from '../formato'

export type ItemParaPedir = {
  variacaoId: string
  nome: string
  codigo: string | null
  medida: string
  gaveta: string | null
  saldo: number | null
  vendeu7: number
}

const solto = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function FazerPedido({
  slug,
  lojaId,
  fabricas,
  itens,
}: {
  slug: string
  lojaId: string
  fabricas: { id: string; nome: string }[]
  itens: ItemParaPedir[]
}) {
  const [quero, setQuero] = useState<Record<string, string>>({})
  // Com mais de uma fábrica, a pessoa escolhe — nenhuma vem marcada (antes o
  // pedido sem escolha ia para a fábrica mais antiga).
  const [fabrica, setFabrica] = useState(fabricas.length === 1 ? fabricas[0]!.id : '')
  const [pedePin, setPedePin] = useState(false)
  const [pin, setPin] = useState('')
  const [observacao, setObservacao] = useState('')
  const [busca, setBusca] = useState('')
  const [recado, setRecado] = useState<Recado | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  const preenchidos = itens.filter((i) => (quero[i.variacaoId] ?? '').trim())
  const t = solto(busca.trim())
  const visiveis = t ? itens.filter((i) => solto(i.nome).includes(t) || solto(i.codigo ?? '').includes(t) || solto(i.gaveta ?? '').includes(t)) : itens
  const gavetas = [...new Set(visiveis.map((i) => i.gaveta ?? 'Sem gaveta'))]

  function pedir() {
    const linhas = preenchidos.map((i) => ({ variacaoId: i.variacaoId, quantidade: ler(quero[i.variacaoId] ?? '') ?? 0 }))
    if (linhas.some((l) => Number.isNaN(l.quantidade))) return setRecado({ erro: LEGIVEL })
    setRecado(null)
    comecar(async () => {
      const r = await criarPedidoAcao(slug, { lojaId, fabricaId: fabrica || null, itens: linhas, observacao, pin: pin || null })
      setPin('')
      if (r.precisaPin) setPedePin(true)
      setRecado(r)
      if (r.ok) {
        setPedePin(false)
        setQuero({})
        setObservacao('')
        router.refresh()
      }
    })
  }

  if (itens.length === 0) {
    return (
      <p className="text-sm text-tinta-3">
        Esta loja não tem produto à venda marcado. O que ela vende se escolhe na ficha do produto, em &ldquo;Vendido em&rdquo;.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Campo rotulo="Procurar" name="procurar" value={busca} onChange={(ev) => setBusca(ev.currentTarget.value)} placeholder="Nome, código ou gaveta" autoComplete="off" />
        {fabricas.length > 1 && (
          <Selecao
            rotulo="Pedir para"
            name="fabrica"
            value={fabrica}
            onChange={(ev) => setFabrica(ev.currentTarget.value)}
            opcoes={[{ valor: '', titulo: 'Escolha a fábrica' }, ...fabricas.map((f) => ({ valor: f.id, titulo: f.nome }))]}
          />
        )}
      </div>

      {gavetas.map((g) => (
        <section key={g} className="flex flex-col gap-1">
          <h3 className="text-sm font-bold text-tinta">{g}</h3>
          <ul className="flex flex-col divide-y divide-borda-suave rounded-norte border border-borda bg-superficie">
            {visiveis
              .filter((i) => (i.gaveta ?? 'Sem gaveta') === g)
              .map((i) => {
                const pouco = i.saldo !== null && i.vendeu7 > 0 && i.saldo < i.vendeu7 / 2
                return (
                  <li key={i.variacaoId} className="grid grid-cols-[minmax(0,1fr)_6.5rem] items-center gap-3 px-3 py-2">
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm text-tinta">{i.nome}</span>
                      <span className="text-xs text-tinta-3">
                        {i.codigo && <span className="font-mono">{i.codigo} · </span>}
                        <span className={cx(pouco && 'font-semibold text-atencao')}>
                          tem {i.saldo === null ? 'nada lançado' : quantidade(i.saldo, i.medida)}
                        </span>{' '}
                        · vendeu {quantidade(i.vendeu7, i.medida)} em 7 dias
                      </span>
                    </span>
                    <input
                      inputMode="decimal"
                      value={quero[i.variacaoId] ?? ''}
                      placeholder="0"
                      onChange={(ev) => {
                        const v = ev.currentTarget.value
                        setQuero((m) => ({ ...m, [i.variacaoId]: v }))
                      }}
                      aria-label={`Quanto pedir de ${i.nome}`}
                      className={cx(
                        'numero w-full rounded-norte border bg-superficie px-2 py-1.5 text-right text-sm text-tinta placeholder:text-tinta-3',
                        (quero[i.variacaoId] ?? '').trim() ? 'border-marca' : 'border-borda',
                      )}
                    />
                  </li>
                )
              })}
          </ul>
        </section>
      ))}
      {visiveis.length === 0 && <p className="text-sm text-tinta-3">Nada com esse nome nesta loja.</p>}

      <Campo rotulo="Recado para a fábrica (opcional)" name="observacao" value={observacao} onChange={(ev) => setObservacao(ev.currentTarget.value)} placeholder="Precisa chegar antes do sábado" />
      {/* O botão gruda no pé da tela: a lista é comprida, e ele não pode
          ficar lá embaixo, depois de 80 sabores. Só ele — o recado fica fora,
          senão no celular a faixa grudada come meia tela. */}
      <div className="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-borda bg-fundo py-3">
        {pedePin && (
          <div className="max-w-xs">
            <CampoDoPin slug={slug} valor={pin} aoMudar={setPin} aoEnviar={pedir} />
          </div>
        )}
        {recado?.erro && <Aviso nivel="critico">{recado.erro}</Aviso>}
        {recado?.ok && <Aviso nivel="bom">{recado.ok}</Aviso>}
        {/* O botão à esquerda: o canto direito de baixo é do "Ajuda" flutuante. */}
        <div className="flex items-center gap-3">
          <Botao carregando={indo} disabled={preenchidos.length === 0 || !fabrica} onClick={pedir}>
            Fazer o pedido
          </Botao>
          <span className="text-sm text-tinta-2">{preenchidos.length > 0 ? plural(preenchidos.length, 'item', 'itens') : 'Digite quanto quer de cada um.'}</span>
        </div>
      </div>
    </div>
  )
}
