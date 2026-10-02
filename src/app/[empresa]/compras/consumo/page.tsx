import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { semAcesso } from '@/servidor/sem-acesso'
import { moduloLigado } from '@/servidor/modulos'
import { pode } from '@/servidor/permissao'
import { escolherUnidade } from '@/servidor/unidade'
import { consumosRecentes } from '@/servidor/compras'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { Cartao, Vazio } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'
import { quantidade } from '@/ui/texto'
import { Consumo } from './Consumo'

export const metadata: Metadata = { title: 'Material usado' }

// Material usado: o esmalte, a luva, o algodão que se gasta atendendo.
//
// Sai do estoque como CONSUMO — não é venda (não entra no faturamento) e não
// é perda (não é sumiço). Quem atende anota; o saldo fica certo sem balanço,
// e o que acabou aparece no estoque a tempo de pedir de novo. Abaixo, o que
// foi anotado nos últimos 30 dias, com quem anotou.

const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d)

export default async function MaterialUsado({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string }>
}) {
  const { empresa: slug } = await params
  const { unidade } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'estoque.consumir' })
  if (!moduloLigado(empresa, 'compras')) semAcesso(slug, 'modulo-compras')
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema
  const onde = await escolherUnidade(sessao, empresa, unidade, 'estoque.consumir')
  const lojas = onde.opcoes.filter((u) => (onde.unidadeId ? u.id === onde.unidadeId : true)).filter((u) => pode(sessao, 'estoque.consumir', u.id))
  const recentes = await consumosRecentes(sessao, onde.ids)

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/compras/consumo`}
      tema={tema}
      titulo="Material usado"
      acao={onde.mostrarSeletor ? <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} /> : undefined}
    >
      {lojas.length > 0 && <Consumo slug={slug} lojas={lojas.map((u) => ({ id: u.id, nome: u.nome }))} lojaAtual={onde.unidadeId} />}

      <Cartao titulo="Anotado nos últimos 30 dias">
        {recentes.length === 0 ? (
          <Vazio>Nada anotado ainda. O que se gasta atendendo, anote aqui — o estoque agradece no fim do mês.</Vazio>
        ) : (
          <ul className="flex flex-col divide-y divide-borda-suave">
            {recentes.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium text-tinta">{m.descricao}</span>
                  <span className="text-xs text-tinta-3">
                    {quando(m.criadoEm)} · {m.quem}
                    {onde.opcoes.length > 1 && ` · ${m.unidade}`}
                    {m.motivo && m.motivo !== 'Consumo interno' && ` · ${m.motivo}`}
                  </span>
                </span>
                <span className="numero font-semibold text-tinta">{quantidade(m.quantidade, m.medida)}</span>
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </Estrutura>
  )
}
