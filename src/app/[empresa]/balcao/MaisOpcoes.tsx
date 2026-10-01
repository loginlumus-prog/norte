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
import { AlertaDeDivida } from '../crediario/AlertaDeDivida'
import { BotaoReceber } from '../crediario/BotaoReceber'
import { Folha } from './Folha'
import { usePalavras } from './palavras'
import type { Venda } from './useVenda'
import { DINHEIRO_ILEGIVEL, lerDinheiro } from '@/servidor/dinheiro'

/** Quantas opções estão valendo nesta venda — o número do botão. */
export function opcoesEmUso(v: Venda, usuarioId: string) {
  return [!!v.cliente, v.desconto > 0, v.acrescimo > 0, v.vendedorId !== usuarioId, v.observacoes.trim() !== ''].filter(Boolean).length
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
  precisaPin = false,
  unidadeId,
  crediario = null,
}: {
  /** Quem opera não passa do teto sozinha: desconto e avulso pedem o PIN de quem pode. */
  precisaPin?: boolean
  v: Venda
  aberta: boolean
  aoFechar: () => void
  slug: string
  unidadeId: string
  /**
   * O crediário da loja (nulo = módulo desligado) e se quem opera recebe
   * parcela. Com ele, escolher a cliente que deve mostra o "ela já deve" ali
   * mesmo, e sem cliente fica o atalho de quem veio só pagar.
   */
  crediario?: { receber?: boolean } | null
  usuarioId: string
  vendedores: Vendedor[] | null
  podeAvulso: boolean
  /** Alt+N ou crediário sem cliente: a busca de cliente já abre pronta. */
  pedidoCliente: number
  /** Alt+F: o foco vai direto no vendedor. */
  focarVendedor: boolean
}) {
  const p = usePalavras()
  // O item avulso abre fechado, toda vez: é exceção, não campo.
  const fecharAvulso = v.avulso.setAberto
  useEffect(() => {
    if (!aberta) fecharAvulso(false)
  }, [aberta, fecharAvulso])

  // Lançou o avulso, a folha fecha: o item aparece no pedido, que é onde a
  // pessoa vai conferir. Mesma validação do lançamento, para o Enter não
  // fechar a folha sem ter lançado nada.
  const precoAvulso = lerDinheiro(v.avulso.preco)
  const precoIlegivel = v.avulso.preco.trim() !== '' && precoAvulso === null
  function lancarAvulso() {
    if (!v.avulso.nome.trim() || precoAvulso === null) return
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
      subtitulo={`${p.Pessoa}, ${p.Vendedor.toLowerCase()}, desconto, acréscimo, item avulso e observação.`}
      rodape={
        <Botao largo onClick={aoFechar} className="min-h-12 rounded-xl text-base">
          Pronto
        </Botao>
      }
    >
      <div className="flex flex-col gap-5">
        <section className={secao}>
          <h3 className={titulo}>
            {p.Pessoa} <kbd className="ml-1 rounded border border-borda bg-superficie-2 px-1 font-mono text-[10px] text-tinta-3 normal-case">Alt N</kbd>
          </h3>
          <div className="rounded-xl border border-borda bg-superficie px-3 py-2.5 [&_button]:min-h-9 [&_input]:h-11 [&_input]:text-base">
            <EscolherCliente slug={slug} escolhido={v.cliente} aoEscolher={v.setCliente} pedido={pedidoCliente} />
          </div>
          {/* Crediário: "ela já deve R$ X — vai pagar agora?" assim que a
              cliente é escolhida, e o "veio só pagar" sem cliente — o mesmo
              do balcão avançado (crediario/AlertaDeDivida.tsx). */}
          {crediario && v.cliente && (
            <AlertaDeDivida slug={slug} unidadeId={unidadeId} clienteId={v.cliente.id} podeReceber={crediario.receber !== false} />
          )}
          {crediario && !v.cliente && crediario.receber !== false && (
            <BotaoReceber slug={slug} unidadeId={unidadeId} tom="secundario" className="min-h-11 self-start rounded-xl text-sm">
              Receber parcela do crediário
            </BotaoReceber>
          )}
        </section>

        {vendedores && (
          <section className={secao}>
            <label htmlFor="vendedor-simples" className={titulo}>
              Quem {p.vendeu.toLowerCase()} <kbd className="ml-1 rounded border border-borda bg-superficie-2 px-1 font-mono text-[10px] text-tinta-3 normal-case">Alt F</kbd>
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
            Desconto {p.naVenda}
          </label>
          {/* Um campo só, com R$ ou %: dois campos davam desconto dobrado. */}
          <div className="flex items-center gap-2">
            <div role="group" aria-label="Desconto em reais ou em porcento" className="flex shrink-0 overflow-hidden rounded-xl border border-borda">
              {([false, true] as const).map((pct) => (
                <button
                  key={String(pct)}
                  type="button"
                  aria-pressed={v.descontoEmPct === pct}
                  onClick={() => v.setDescontoEmPct(pct)}
                  className={cx(
                    'h-12 w-12 text-base font-bold',
                    v.descontoEmPct === pct ? 'bg-marca text-marca-tinta' : 'bg-superficie text-tinta-2 hover:bg-superficie-2',
                  )}
                >
                  {pct ? '%' : 'R$'}
                </button>
              ))}
            </div>
            <input
              id="desconto-simples"
              type="number"
              min={0}
              max={v.descontoEmPct ? 100 : undefined}
              step={v.descontoEmPct ? 0.5 : 0.01}
              inputMode="decimal"
              value={v.desconto || ''}
              onChange={(e) => v.setDesconto(Number(e.target.value) || 0)}
              placeholder={v.descontoEmPct ? '0' : '0,00'}
              className={cx(campo, 'numero max-w-40 text-lg font-bold')}
            />
            {v.desconto > 0 && (
              <button type="button" onClick={() => v.setDesconto(0)} className="px-2 text-sm font-semibold text-tinta-3 hover:text-critico">
                tirar
              </button>
            )}
          </div>
          {v.descontoEmPct && v.conta.descontoCent > 0 && (
            <p className="numero text-sm text-tinta-2">− {(v.conta.descontoCent / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
          )}
          <p className="text-xs text-tinta-3">
            {precisaPin
              ? `Acima do teto da loja, ${p.aVenda} pede o PIN de quem pode autorizar.`
              : 'Acima do teto da loja fica registrado no seu nome.'}
          </p>
        </section>

        <section className={secao}>
          <label htmlFor="acrescimo-simples" className={titulo}>
            Acréscimo
          </label>
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-tinta-3">R$</span>
            <input
              id="acrescimo-simples"
              type="number"
              min={0}
              step={0.01}
              inputMode="decimal"
              value={v.acrescimo || ''}
              onChange={(e) => v.setAcrescimo(Number(e.target.value) || 0)}
              placeholder="0,00"
              className={cx(campo, 'numero max-w-40 text-lg font-bold')}
            />
            {v.acrescimo > 0 && (
              <button type="button" onClick={() => v.setAcrescimo(0)} className="px-2 text-sm font-semibold text-tinta-3 hover:text-critico">
                tirar
              </button>
            )}
          </div>
          <p className="text-xs text-tinta-3">A peça saiu da promoção e a etiqueta ficou com o preço velho: some a diferença aqui.</p>
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
                    aria-invalid={precoIlegivel || undefined}
                    className={cx(campo, 'numero max-w-36', precoIlegivel && 'border-critico')}
                  />
                  <Botao
                    tom="secundario"
                    onClick={lancarAvulso}
                    disabled={!v.avulso.nome.trim() || precoAvulso === null}
                    className="h-12 flex-1 rounded-xl"
                  >
                    Lançar no pedido
                  </Botao>
                </div>
                {precoIlegivel && <p className="text-xs font-medium text-critico">{DINHEIRO_ILEGIVEL}</p>}
                <p className="text-xs text-tinta-3">
                  Não mexe em estoque e fica marcado no livro. Se a peça existe, cadastre.
                  {precisaPin && ' Ao concluir, pede o PIN de quem pode autorizar.'}
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
