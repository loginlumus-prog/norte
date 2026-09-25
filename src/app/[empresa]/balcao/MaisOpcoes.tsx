'use client'

// "Mais opções": o que o balcão faz, mas nem toda venda precisa.
//
// Cliente, vendedor, desconto, item avulso e observação ficam aqui, atrás de
// um botão — escondidos, nunca removidos. Na sorveteria, nove em cada dez
// vendas não usam nenhum; com os cinco à vista, a tela de venda vira
// formulário, e a moça do caixa passa a ler em vez de vender.
//
// Esconder tem um risco: esquecer que um desconto está valendo. Por isso o
// botão diz QUANTAS opções estão em uso, e o pedido mostra cada uma numa
// etiqueta, com o ✕ para desfazer sem abrir nada.
//
// O vale-troca não mora aqui: ele é FORMA DE PAGAR, e fica junto das outras
// formas, no passo 1.

import { useEffect } from 'react'
import { Botao, cx } from '@/ui/base'
import type { Vendedor } from '@/servidor/equipe'
import { EscolherCliente } from './Cliente'
import { Folha } from './Folha'
import type { Venda } from './useVenda'

/** Quantas opções estão valendo nesta venda — o número do botão. */
export function opcoesEmUso(v: Venda, usuarioId: string) {
  return [!!v.cliente, v.desconto > 0, v.vendedorId !== usuarioId, v.observacoes.trim() !== ''].filter(Boolean).length
}

export function MaisOpcoes({
  v,
  aberta,
  aoFechar,
  slug,
  usuarioId,
  vendedores,
  podeAvulso,
  pedidoCliente,
  focarVendedor,
}: {
  v: Venda
  aberta: boolean
  aoFechar: () => void
  slug: string
  usuarioId: string
  vendedores: Vendedor[] | null
  podeAvulso: boolean
  /** Alt+N ou crediário sem cliente: a busca de cliente já abre pronta. */
  pedidoCliente: number
  /** Alt+F: o foco vai direto no vendedor. */
  focarVendedor: boolean
}) {
  // O item avulso abre fechado, toda vez: é exceção, não campo.
  const fecharAvulso = v.avulso.setAberto
  useEffect(() => {
    if (!aberta) fecharAvulso(false)
  }, [aberta, fecharAvulso])

  // Lançou o avulso, a folha fecha: o item aparece no pedido, que é onde a
  // pessoa vai conferir. Mesma validação do lançamento, para o Enter não
  // fechar a folha sem ter lançado nada.
  function lancarAvulso() {
    const preco = Number(v.avulso.preco.replace(',', '.'))
    if (!v.avulso.nome.trim() || v.avulso.preco.trim() === '' || !(preco >= 0)) return
    v.avulso.lancar()
    aoFechar()
  }

  const secao = 'flex flex-col gap-2 border-b border-borda-suave pb-5 last:border-0 last:pb-0'
  const titulo = 'text-sm font-semibold tracking-wide text-tinta-2 uppercase'
  const campo =
    'h-12 w-full rounded-xl border border-borda bg-superficie px-3 text-base text-tinta placeholder:text-tinta-3 focus:border-marca focus:outline-none'

  return (
    <Folha
      aberta={aberta}
      aoFechar={aoFechar}
      titulo="Mais opções"
      subtitulo="Cliente, vendedor, desconto, item avulso e observação."
      rodape={
        <Botao largo onClick={aoFechar} className="min-h-12 rounded-xl text-base">
          Pronto
        </Botao>
      }
    >
      <div className="flex flex-col gap-5">
        <section className={secao}>
          <h3 className={titulo}>
            Cliente <kbd className="ml-1 rounded border border-borda bg-superficie-2 px-1 font-mono text-[10px] text-tinta-3 normal-case">Alt N</kbd>
          </h3>
          <div className="rounded-xl border border-borda bg-superficie px-3 py-2.5 [&_button]:min-h-9 [&_input]:h-11 [&_input]:text-base">
            <EscolherCliente slug={slug} escolhido={v.cliente} aoEscolher={v.setCliente} pedido={pedidoCliente} />
          </div>
        </section>

        {vendedores && (
          <section className={secao}>
            <label htmlFor="vendedor-simples" className={titulo}>
              Quem vendeu <kbd className="ml-1 rounded border border-borda bg-superficie-2 px-1 font-mono text-[10px] text-tinta-3 normal-case">Alt F</kbd>
            </label>
            <select
              id="vendedor-simples"
              ref={v.vendedorRef}
              data-foco-inicial={focarVendedor ? '' : undefined}
              value={v.vendedorId}
              onChange={(e) => v.setVendedorId(e.target.value)}
              className={cx(campo, 'font-semibold')}
            >
              {!vendedores.some((x) => x.id === usuarioId) && <option value={usuarioId}>Eu</option>}
              {vendedores.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome}
                  {x.id === usuarioId ? ' (eu)' : ''}
                </option>
              ))}
            </select>
          </section>
        )}

        <section className={secao}>
          <label htmlFor="desconto-simples" className={titulo}>
            Desconto na venda
          </label>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-tinta-3">R$</span>
            <input
              id="desconto-simples"
              type="number"
              min={0}
              step={0.01}
              inputMode="decimal"
              value={v.desconto || ''}
              onChange={(e) => v.setDesconto(Number(e.target.value) || 0)}
              placeholder="0,00"
              className={cx(campo, 'numero max-w-40 text-lg font-bold')}
            />
            {v.desconto > 0 && (
              <button type="button" onClick={() => v.setDesconto(0)} className="px-2 text-sm font-semibold text-tinta-3 hover:text-critico">
                tirar
              </button>
            )}
          </div>
          <p className="text-xs text-tinta-3">Acima do teto da loja, a venda não fecha: chame quem pode autorizar.</p>
        </section>

        {podeAvulso && (
          <section className={secao}>
            <h3 className={titulo}>Item avulso</h3>
            {!v.avulso.aberto ? (
              <button
                type="button"
                onClick={() => v.avulso.setAberto(true)}
                className="min-h-12 self-start rounded-xl border border-dashed border-borda px-4 text-sm font-semibold text-tinta hover:bg-superficie-2"
              >
                + Lançar item fora do cadastro
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <input
                  autoFocus
                  value={v.avulso.nome}
                  onChange={(e) => v.avulso.setNome(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && lancarAvulso()}
                  placeholder="O que é — conserto, taxa de entrega…"
                  aria-label="Descrição do item avulso"
                  className={campo}
                />
                <div className="flex gap-2">
                  <input
                    value={v.avulso.preco}
                    onChange={(e) => v.avulso.setPreco(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && lancarAvulso()}
                    inputMode="decimal"
                    placeholder="Preço"
                    aria-label="Preço do item avulso"
                    className={cx(campo, 'numero max-w-36')}
                  />
                  <Botao
                    tom="secundario"
                    onClick={lancarAvulso}
                    disabled={!v.avulso.nome.trim() || v.avulso.preco.trim() === ''}
                    className="h-12 flex-1 rounded-xl"
                  >
                    Lançar no pedido
                  </Botao>
                </div>
                <p className="text-xs text-tinta-3">
                  Não mexe em estoque e fica marcado no livro. Se a peça existe, cadastre.
                </p>
              </div>
            )}
          </section>
        )}

        <section className={secao}>
          <label htmlFor="obs-simples" className={titulo}>
            Observação
          </label>
          <textarea
            id="obs-simples"
            value={v.observacoes}
            onChange={(e) => v.setObservacoes(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Entregar às 15h, sem cobertura, retira a mãe…"
            className="w-full rounded-xl border border-borda bg-superficie px-3 py-2.5 text-base text-tinta placeholder:text-tinta-3 focus:border-marca focus:outline-none"
          />
        </section>
      </div>
    </Folha>
  )
}
