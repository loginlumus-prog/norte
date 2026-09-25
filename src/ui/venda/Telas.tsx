// As seis telas desenhadas das abas "O sistema por dentro".
//
// ── cada uma é a cara da tela de verdade ─────────────────────
// Não é ilustração: é a tela do sistema resumida ao que cabe numa vitrine —
// os mesmos rótulos, as mesmas situações, os mesmos botões, na mesma ordem.
// "Fechar venda F10", "↓ Sangria", "pedir até", "Esperando você", "Custou de
// IA": quem entrar no sistema depois reconhece a tela que viu aqui. O
// texto de cada rótulo foi conferido contra o manual (`servidor/guia.ts`).
//
// Os números são de exemplo, de loja nenhuma, e as pessoas não existem.
//
// ── servidor, e não cliente ──────────────────────────────────
// Elas não têm estado: são desenhadas no servidor e entregues prontas ao
// componente das abas, que só decide qual aparece. O HTML das seis vai na
// página — o buscador lê as seis, e trocar de aba não espera nada.
//
// ── no celular ───────────────────────────────────────────────
// Cada tela tem uma coluna principal e uma lateral. Abaixo de `sm` a lateral
// desce para baixo da principal, e colunas de tabela que só repetem o que a
// pílula já diz somem — o que fica é o nome e a situação, que são o assunto.

import { Estrelas } from '../Estrelas'
import { Avatar, Barra, Janela, Pilula, Rotulo, reais, type Tom } from './Pecas'

/* ═══════════════════════════════════════════════════════════
   Balcão
   ═══════════════════════════════════════════════════════════ */

const ITENS_BALCAO = [
  { nome: 'Camiseta canelada', grade: 'Preto · G', q: 2, un: 59.9 },
  { nome: 'Calça wide leg', grade: 'Bege · 38', q: 1, un: 149.9 },
  { nome: 'Meia cano alto', grade: 'Branco · U', q: 1, un: 19.9 },
]

export function TelaBalcao() {
  const total = ITENS_BALCAO.reduce((s, i) => s + i.q * i.un, 0)
  const recebido = 300
  return (
    <Janela caminho="loja-centro / balcão">
      {/* A barra do caixa: aberto, por quem, e os três botões dele. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-borda-suave bg-bom-fundo/60 px-4 py-2 text-[11.5px]">
        <span className="flex items-center gap-1.5 font-semibold text-bom">
          <i className="size-1.5 rounded-full bg-bom-vivo" /> Caixa aberto
        </span>
        <span className="text-tinta-2">Marina · desde 8h02</span>
        <span className="ml-auto flex gap-1.5">
          <span className="rounded-md border border-borda bg-superficie px-2 py-0.5 font-semibold text-tinta-2">
            ↓ Sangria
          </span>
          <span className="hidden rounded-md border border-borda bg-superficie px-2 py-0.5 font-semibold text-tinta-2 sm:inline">
            ↑ Suprimento
          </span>
          <span className="rounded-md border border-borda bg-superficie px-2 py-0.5 font-semibold text-tinta-2">
            Fechar caixa
          </span>
        </span>
      </div>

      <div className="grid sm:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex gap-2">
            <span className="numero grid h-9 w-12 place-items-center rounded-lg border border-borda text-[12px] font-semibold text-tinta-2">
              ×1
            </span>
            <span className="flex h-9 min-w-0 flex-1 items-center rounded-lg border-2 border-marca bg-superficie px-3 text-[12.5px] text-tinta-3">
              <span className="truncate">Bipe a etiqueta ou digite o nome…</span>
            </span>
          </div>
          <ul className="flex flex-col">
            {ITENS_BALCAO.map((i) => (
              <li
                key={i.nome}
                className="flex items-center justify-between gap-3 border-t border-borda-suave py-2 first:border-t-0"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-[13px] font-semibold text-tinta">{i.nome}</span>
                  <span className="text-[11px] text-tinta-3">
                    {i.grade} · {i.q} × {reais(i.un)}
                  </span>
                </span>
                <span className="numero text-[13px] font-semibold text-tinta">{reais(i.q * i.un)}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 rounded-lg bg-superficie-2 px-3 py-2 text-[12px]">
            <Avatar iniciais="AS" tom="bom" />
            <span className="min-w-0 flex-1 truncate text-tinta-2">
              <b className="text-tinta">Ana Souza</b> · 14 compras · 320 pontos
            </span>
          </div>
        </div>

        {/* O pagamento, sempre visível ao lado. */}
        <div className="flex flex-col gap-3 border-t border-borda-suave bg-fundo p-4 sm:border-t-0 sm:border-l">
          <div className="flex items-baseline justify-between">
            <Rotulo>Total</Rotulo>
            <span className="numero font-display text-2xl font-bold text-titulo">{reais(total)}</span>
          </div>
          <div className="grid grid-cols-2 gap-1.5 text-[12px] font-semibold">
            {['Dinheiro', 'Pix', 'Débito', 'Crédito'].map((f) => (
              <span
                key={f}
                className={
                  'rounded-lg border px-2 py-1.5 text-center ' +
                  (f === 'Dinheiro'
                    ? 'border-marca bg-marca-suave text-marca'
                    : 'border-borda bg-superficie text-tinta-2')
                }
              >
                {f}
              </span>
            ))}
          </div>
          <div className="flex items-center justify-between text-[12px] text-tinta-2">
            Recebido
            <span className="numero font-semibold text-tinta">{reais(recebido)}</span>
          </div>
          <div className="flex items-baseline justify-between rounded-lg bg-bom-fundo px-3 py-2">
            <span className="text-[12px] font-semibold text-bom">Troco</span>
            <span className="numero font-display text-2xl font-bold text-bom">
              {reais(recebido - total)}
            </span>
          </div>
          <span className="rounded-lg bg-marca py-2 text-center text-[13px] font-semibold text-marca-tinta">
            Fechar venda · F10
          </span>
        </div>
      </div>
    </Janela>
  )
}

/* ═══════════════════════════════════════════════════════════
   Estoque
   ═══════════════════════════════════════════════════════════ */

const VAI_FALTAR: {
  nome: string
  tem: number
  dura: number
  prazo: number
  pedir: string
  situacao: [Tom, string]
}[] = [
  { nome: 'Sandália rasteira · 36', tem: 0, dura: 0, prazo: 10, pedir: 'já faltou', situacao: ['critico', 'Já faltou'] },
  { nome: 'Camiseta canelada · Preto · G', tem: 2, dura: 2, prazo: 7, pedir: 'hoje', situacao: ['critico', 'Pedir agora'] },
  { nome: 'Tênis casual · 38', tem: 6, dura: 9, prazo: 7, pedir: '26 set', situacao: ['atencao', 'Atenção'] },
  { nome: 'Calça wide leg · Bege · 38', tem: 14, dura: 31, prazo: 12, pedir: '12 out', situacao: ['bom', 'Ok'] },
]

export function TelaEstoque() {
  return (
    <Janela caminho="loja-centro / estoque">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-borda-suave px-4 py-2.5 text-[12px] font-semibold">
        <span className="rounded-md bg-tinta px-2.5 py-1 text-superficie">Loja Centro</span>
        <span className="rounded-md px-2.5 py-1 text-tinta-3">Loja Shopping</span>
        <span className="rounded-md px-2.5 py-1 text-tinta-3">Depósito</span>
        <span className="ml-auto rounded-md bg-marca px-2.5 py-1 text-marca-tinta">+ Dar entrada</span>
      </div>

      <div className="grid sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="p-4">
          <div className="flex items-baseline justify-between">
            <Rotulo>Vai faltar</Rotulo>
            <span className="text-[11px] text-tinta-3">ritmo dos últimos 30 dias</span>
          </div>
          <table className="mt-2 w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] font-bold tracking-[0.08em] text-tinta-3 uppercase">
                <th className="pb-1.5 font-bold">Item</th>
                <th className="hidden pb-1.5 text-right font-bold sm:table-cell">Dura</th>
                <th className="hidden pb-1.5 text-right font-bold md:table-cell">Prazo</th>
                <th className="pb-1.5 text-right font-bold">Pedir até</th>
              </tr>
            </thead>
            <tbody>
              {VAI_FALTAR.map((v) => (
                <tr key={v.nome} className="border-t border-borda-suave">
                  <td className="py-2 pr-2">
                    <span className="block truncate font-semibold text-tinta">{v.nome}</span>
                    <Pilula tom={v.situacao[0]} className="mt-0.5 !text-[10px]">
                      {v.situacao[1]}
                    </Pilula>
                  </td>
                  <td className="numero hidden py-2 text-right text-tinta-2 sm:table-cell">
                    {v.tem === 0 ? '—' : `${v.dura} dias`}
                  </td>
                  <td className="numero hidden py-2 text-right text-tinta-2 md:table-cell">
                    {v.prazo} dias
                  </td>
                  <td className="numero py-2 text-right font-semibold text-tinta">{v.pedir}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-borda-suave bg-fundo p-4 sm:border-t-0 sm:border-l">
          <Rotulo>Transferir</Rotulo>
          <div className="rounded-lg border border-borda bg-superficie p-3 text-[12px]">
            <p className="font-semibold text-tinta">Tênis casual · 38</p>
            <div className="mt-2 flex items-center gap-2 text-tinta-2">
              <span className="numero rounded-md bg-superficie-2 px-2 py-0.5 font-semibold text-tinta">4 pares</span>
              <span>Centro</span>
              <span className="text-tinta-3">→</span>
              <span>Shopping</span>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-tinta-3">
              Sai daqui e entra lá na mesma operação.
            </p>
          </div>
          <Rotulo>Últimos movimentos</Rotulo>
          <ul className="flex flex-col gap-1.5 text-[11.5px]">
            {[
              ['Entrada', '+24', 'bom'],
              ['Venda', '−2', 'neutro'],
              ['Balanço', '−1', 'atencao'],
            ].map(([t, q, tom]) => (
              <li key={t} className="flex items-center justify-between">
                <span className="text-tinta-2">{t}</span>
                <Pilula tom={tom as Tom} className="numero">
                  {q}
                </Pilula>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Janela>
  )
}

/* ═══════════════════════════════════════════════════════════
   Financeiro
   ═══════════════════════════════════════════════════════════ */

const DRE: [string, number, 'soma' | 'tira' | 'total'][] = [
  ['Vendas do mês', 84230, 'soma'],
  ['Taxas de cartão e Pix', -2106, 'tira'],
  ['Custo da mercadoria', -41280, 'tira'],
  ['Despesas do mês', -24910, 'tira'],
  ['Resultado', 15934, 'total'],
]

export function TelaFinanceiro() {
  return (
    <Janela caminho="loja-centro / financeiro">
      <div className="grid sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="p-4">
          <div className="flex items-baseline justify-between">
            <Rotulo>Resultado de agosto (DRE)</Rotulo>
            <span className="text-[11px] text-tinta-3">← agosto →</span>
          </div>
          <ul className="mt-2 flex flex-col">
            {DRE.map(([t, v, tipo]) => (
              <li
                key={t}
                className={
                  'flex items-baseline justify-between py-1.5 text-[12.5px] ' +
                  (tipo === 'total'
                    ? 'mt-1 border-t-2 border-tinta/15 pt-2 font-bold'
                    : 'border-t border-borda-suave first:border-t-0')
                }
              >
                <span className={tipo === 'tira' ? 'pl-3 text-tinta-2' : 'text-tinta'}>
                  {tipo === 'tira' ? '(−) ' : ''}
                  {t}
                </span>
                <span
                  className={
                    'numero ' +
                    (tipo === 'total' ? 'font-display text-lg text-bom' : tipo === 'tira' ? 'text-tinta-2' : 'font-semibold text-tinta')
                  }
                >
                  {reais(Math.abs(v), 0)}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-tinta-3">
            Sobrou 18,9% do que vendeu. Compra de mercadoria não entra: vira custo quando a peça vende.
          </p>
        </div>

        <div className="flex flex-col gap-3 border-t border-borda-suave bg-fundo p-4 sm:border-t-0 sm:border-l">
          <div className="flex items-baseline justify-between">
            <Rotulo>Fechamento do mês</Rotulo>
            <span className="numero text-[11px] font-semibold text-tinta-2">3 de 5 prontas</span>
          </div>
          <Barra valor={60} tom="bom" />
          <ul className="flex flex-col gap-1.5 text-[12px]">
            {/* As linhas são as da tela de verdade, na ordem dela: caixas,
                gaveta, contas, taxa, fiado. O resultado é a sexta, e mora
                no DRE ao lado. */}
            {[
              ['Nenhum caixa aberto', true],
              ['Gaveta: R$ 12 de diferença no mês', true],
              ['Taxa da maquininha no cálculo', true],
              ['Contas vencidas em aberto: 1', false],
              ['Fiado: 3 parcelas vencidas', false],
            ].map(([t, ok]) => (
              <li key={t as string} className="flex items-center gap-2">
                <span
                  className={
                    'grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-bold ' +
                    (ok ? 'bg-bom-vivo text-white' : 'border border-borda bg-superficie')
                  }
                >
                  {ok ? '✓' : ''}
                </span>
                <span className={ok ? 'text-tinta-3 line-through decoration-tinta-3/40' : 'text-tinta'}>
                  {t as string}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-1 flex items-center justify-between rounded-lg border border-critico-borda bg-critico-fundo px-3 py-2 text-[12px]">
            <span className="font-semibold text-critico">Aluguel · venceu ontem</span>
            <span className="numero font-semibold text-critico">{reais(3200, 0)}</span>
          </div>
        </div>
      </div>
    </Janela>
  )
}

/* ═══════════════════════════════════════════════════════════
   Equipe e tarefas
   ═══════════════════════════════════════════════════════════ */

const TAREFAS: { nome: string; quem: string; situacao: [Tom, string]; prazo: string; tempo: [number, number] }[] = [
  { nome: 'Conferir troco e abrir o caixa', quem: 'MC', situacao: ['bom', 'Feito'], prazo: '24 set', tempo: [0, 22] },
  { nome: 'Montar a vitrine de primavera', quem: 'JP', situacao: ['atencao', 'Em andamento'], prazo: '26 set', tempo: [12, 64] },
  { nome: 'Ligar para o fornecedor de sandálias', quem: 'RA', situacao: ['critico', 'Parado'], prazo: '25 set', tempo: [28, 52] },
  { nome: 'Etiquetar a mercadoria que chegou', quem: 'CS', situacao: ['neutro', 'A fazer'], prazo: '29 set', tempo: [44, 86] },
]

const DESEMPENHO: { nome: string; iniciais: string; estrelas: number; meta: number }[] = [
  { nome: 'Marina', iniciais: 'MC', estrelas: 4.5, meta: 104 },
  { nome: 'João', iniciais: 'JP', estrelas: 3.5, meta: 81 },
  { nome: 'Rafaela', iniciais: 'RA', estrelas: 3, meta: 72 },
]

export function TelaEquipe() {
  return (
    <Janela caminho="loja-centro / tarefas">
      <div className="grid sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="p-4">
          <div className="flex items-baseline justify-between">
            <p className="text-[13px] font-bold text-marca">Esta semana</p>
            <span className="text-[11px] text-tinta-3">Quadro da Loja Centro</span>
          </div>
          <ul className="mt-2 flex flex-col">
            {TAREFAS.map((t) => (
              <li
                key={t.nome}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 border-t border-borda-suave py-2 pl-2.5 shadow-[inset_3px_0_0_var(--marca)] md:grid-cols-[minmax(0,1fr)_1.5rem_6.5rem_5rem]"
              >
                <span className="truncate text-[12.5px] font-medium text-tinta">{t.nome}</span>
                <Avatar iniciais={t.quem} className="hidden md:grid" />
                <Pilula tom={t.situacao[0]} className="justify-self-start">
                  {t.situacao[1]}
                </Pilula>
                <span aria-hidden className="relative hidden h-1.5 rounded-full bg-superficie-2 md:block">
                  <span
                    className="absolute inset-y-0 rounded-full bg-marca"
                    style={{ left: `${t.tempo[0]}%`, width: `${t.tempo[1] - t.tempo[0]}%` }}
                  />
                </span>
                <span className="numero col-span-2 text-[11px] text-tinta-3 md:hidden">
                  {t.quem} · prazo {t.prazo}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-3 border-t border-borda-suave bg-fundo p-4 sm:border-t-0 sm:border-l">
          <div className="flex items-baseline justify-between">
            <Rotulo>Desempenho de setembro</Rotulo>
          </div>
          <ul className="flex flex-col gap-2.5">
            {DESEMPENHO.map((d) => (
              <li key={d.nome} className="flex flex-col gap-1.5 rounded-lg bg-superficie p-2.5 shadow-norte">
                <span className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[12.5px] font-semibold text-tinta">
                    <Avatar iniciais={d.iniciais} />
                    {d.nome}
                  </span>
                  <Estrelas valor={d.estrelas} tamanho="sm" />
                </span>
                <span className="flex items-center gap-2 text-[10.5px] text-tinta-3">
                  meta
                  <Barra valor={Math.min(100, d.meta)} tom={d.meta >= 100 ? 'bom' : 'marca'} className="flex-1" />
                  <span className="numero font-semibold text-tinta-2">{d.meta}%</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Janela>
  )
}

/* ═══════════════════════════════════════════════════════════
   Assistente
   ═══════════════════════════════════════════════════════════ */

export function TelaAssistente() {
  return (
    <Janela caminho="loja-centro / assistente">
      <div className="grid sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center gap-2.5">
            <span className="grid size-9 place-items-center rounded-full bg-bom-vivo text-sm font-bold text-white">
              A
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-[14px] font-bold text-tinta">Aurora</span>
              <span className="text-[11px] text-tinta-3">fala leve, trata o cliente pelo nome</span>
            </span>
            <Pilula tom="bom" className="ml-auto">
              funcionando
            </Pilula>
          </div>

          <Rotulo className="pt-1">Esperando você</Rotulo>
          {[
            // Os dois poderes de agir que já existem hoje (`servidor/poderes.ts`):
            // registrar a compra de mercadoria e lançar uma conta a pagar.
            ['Registrar a compra de 20 un. da Camiseta canelada Preto · G', reais(448)],
            ['Lançar a conta de luz · vence 5 out', reais(312.4)],
          ].map(([t, v]) => (
            <div key={t} className="flex flex-col gap-2 rounded-lg border border-borda bg-superficie p-3">
              <p className="text-[12.5px] leading-snug text-tinta">
                {t} · <b className="numero">{v}</b>
              </p>
              <span className="flex gap-1.5 text-[11.5px] font-semibold">
                <span className="rounded-md border border-borda px-2.5 py-0.5 text-tinta-2">Não</span>
                <span className="rounded-md bg-marca px-2.5 py-0.5 text-marca-tinta">Confirmar</span>
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 border-t border-borda-suave bg-fundo p-4 sm:border-t-0 sm:border-l">
          <Rotulo>Até onde ele vai</Rotulo>
          <dl className="flex flex-col text-[12px]">
            {[
              ['Valor máximo de uma proposta', reais(1000, 0)],
              ['Desconto máximo', '10%'],
              ['Gasto de IA por dia', reais(5)],
              ['Mensagens por dia', '300'],
            ].map(([t, v]) => (
              <div key={t} className="flex items-baseline justify-between gap-2 border-t border-borda-suave py-1.5 first:border-t-0">
                <dt className="text-tinta-2">{t}</dt>
                <dd className="numero font-semibold text-tinta">{v}</dd>
              </div>
            ))}
          </dl>
          {/* Já teve ao lado um "Trouxe de volta · R$ 2.180". A tela de verdade
              ainda não soma nada ali (nenhuma ação dele emite recibo), então o
              que fica é o número que ela mostra de fato: o custo do mês. */}
          <div className="rounded-lg bg-superficie p-2.5 shadow-norte">
            <Rotulo>Custou de IA este mês</Rotulo>
            <p className="numero mt-1 font-display text-lg font-bold text-tinta">{reais(38, 0)}</p>
          </div>
        </div>
      </div>
    </Janela>
  )
}

/* ═══════════════════════════════════════════════════════════
   Análise
   ═══════════════════════════════════════════════════════════ */

const LOJAS: [string, number, string, number, number][] = [
  // loja, vendas, margem, ticket, sem saída
  ['Centro', 84230, '43%', 146, 3120],
  ['Shopping', 97410, '39%', 171, 5840],
  ['Bairro', 41980, '46%', 98, 1260],
]

export function TelaAnalise() {
  const maior = Math.max(...LOJAS.map((l) => l[1]))
  return (
    <Janela caminho="minha-empresa / análise">
      <div className="grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="p-4">
          <div className="flex items-baseline justify-between">
            <Rotulo>As lojas lado a lado</Rotulo>
            <span className="text-[11px] text-tinta-3">últimos 30 dias</span>
          </div>
          <table className="mt-2 w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] tracking-[0.08em] text-tinta-3 uppercase">
                <th className="pb-1.5 font-bold">Loja</th>
                <th className="pb-1.5 text-right font-bold">Vendas</th>
                <th className="hidden pb-1.5 text-right font-bold md:table-cell">Margem</th>
                <th className="hidden pb-1.5 text-right font-bold md:table-cell">Ticket</th>
                <th className="pb-1.5 text-right font-bold">Sem saída</th>
              </tr>
            </thead>
            <tbody>
              {LOJAS.map(([n, v, m, t, s]) => (
                <tr key={n} className="border-t border-borda-suave">
                  <td className="py-2 pr-2">
                    <span className="font-semibold text-tinta">{n}</span>
                    <Barra valor={(v / maior) * 100} className="mt-1 w-full max-w-28" />
                  </td>
                  <td className="numero py-2 text-right text-tinta">{reais(v, 0)}</td>
                  <td className="numero hidden py-2 text-right text-tinta-2 md:table-cell">{m}</td>
                  <td className="numero hidden py-2 text-right text-tinta-2 md:table-cell">{reais(t, 0)}</td>
                  <td className="numero py-2 text-right text-atencao">{reais(s, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-3 border-t border-borda-suave bg-fundo p-4 sm:border-t-0 sm:border-l">
          <Rotulo>Curva ABC</Rotulo>
          {/* A barra única dividida: A é pouca coisa que faz quase tudo; C é
              muita coisa que faz quase nada. É o desenho da curva inteira
              numa linha. */}
          <div className="flex h-7 overflow-hidden rounded-md text-[10.5px] font-bold">
            <span className="grid w-[80%] place-items-center bg-marca text-marca-tinta">A · 80%</span>
            <span className="grid w-[15%] place-items-center bg-marca/45 text-tinta">B</span>
            <span className="grid w-[5%] place-items-center bg-superficie-3 text-tinta-3">C</span>
          </div>
          <p className="text-[11.5px] leading-snug text-tinta-3">
            <b className="text-tinta-2">42 produtos</b> fazem 80% do que entra. <b className="text-tinta-2">186</b> dividem os 5% do fim.
          </p>
          <div className="rounded-lg bg-superficie p-3 shadow-norte">
            <Rotulo>Dinheiro parado</Rotulo>
            <p className="numero mt-1 font-display text-xl font-bold text-atencao">{reais(12480, 0)}</p>
            <p className="text-[11px] text-tinta-3">
              a preço de custo · {reais(4210, 0)} sem vender há 90+ dias
            </p>
          </div>
        </div>
      </div>
    </Janela>
  )
}
