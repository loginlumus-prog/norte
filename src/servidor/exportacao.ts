// Quem baixa planilha, e o rastro que fica.
//
// A planilha é a porta de SAÍDA dos dados: a lista inteira, de uma vez, num
// arquivo que sai do sistema e não volta. É obrigação dos termos (a empresa
// leva os dados dela quando quiser) — e é também o jeito mais rápido de um
// funcionário de saída levar a carteira de clientes para o concorrente.
//
// Duas regras, então:
//
//   1. A lista de CLIENTES (nome, telefone, aniversário, quanto gastou) exige
//      ver cliente E ver relatório. O balcão continua vendo o cliente na
//      tela, um por vez, que é o trabalho dele; baixar os dois mil de uma vez
//      é de quem cuida do negócio (dono, gerente, financeiro).
//   2. Toda planilha baixada vira linha no livro de auditoria: quem, qual,
//      quantas linhas e com que filtros. Os VALORES dos filtros não entram
//      (a busca pode ser o nome de um cliente, e o livro não se apaga);
//      entram só os nomes dos filtros usados.
//
// O livro é gravado DEPOIS de ler e ANTES de responder. Se a linha não
// puder ser gravada, a planilha não sai: exportação sem rastro é justamente
// o que esta regra existe para impedir.

import { comoOrg } from './banco'
import { pode, type Capacidade, type Sessao } from './permissao'

export type Planilha = 'clientes' | 'vendas' | 'produtos' | 'estoque' | 'financeiro' | 'mensalidades'

/** O que cada planilha exige. Todas as capacidades da lista, não uma delas. */
export const EXIGE: Record<Planilha, readonly Capacidade[]> = {
  clientes: ['cliente.ver', 'relatorio.ver'],
  vendas: ['venda.ver'],
  produtos: ['produto.ver'],
  estoque: ['estoque.ver'],
  financeiro: ['financeiro.ver'],
  // A lista de quem deve à escola, com o nome e o telefone do responsável: é
  // a carteira da escola. Pede ver a mensalidade E ler relatório — a
  // secretaria recebe na tela, um por vez; baixar tudo é de quem cuida do
  // negócio (a mesma régua da lista de clientes).
  mensalidades: ['mensalidade.ver', 'relatorio.ver'],
}

export function podeExportar(sessao: Sessao, planilha: Planilha): boolean {
  return EXIGE[planilha].every((c) => pode(sessao, c))
}

export const ROTULO: Record<Planilha, string> = {
  clientes: 'clientes',
  vendas: 'vendas',
  produtos: 'produtos',
  estoque: 'estoque',
  financeiro: 'lançamentos do financeiro',
  mensalidades: 'mensalidades',
}

/** Só os NOMES dos filtros preenchidos — nunca o que foi digitado neles. */
export function filtrosUsados(busca: URLSearchParams): string[] {
  return [...new Set([...busca.entries()].filter(([, v]) => v.trim() !== '').map(([k]) => k.slice(0, 30)))].sort()
}

export async function registrarExportacao(
  sessao: Sessao,
  planilha: Planilha,
  p: { linhas: number; filtros: string[]; unidadeId?: string | null },
): Promise<void> {
  await comoOrg(sessao.orgId, (db) =>
    db.auditoria.create({
      data: {
        orgId: sessao.orgId,
        unidadeId: p.unidadeId ?? null,
        usuarioId: sessao.usuarioId,
        quem: sessao.nome,
        acao: `exportou.${planilha}`,
        alvoTipo: 'planilha',
        alvoNome: ROTULO[planilha],
        depois: { linhas: p.linhas, filtros: p.filtros },
      },
    }),
  )
}
