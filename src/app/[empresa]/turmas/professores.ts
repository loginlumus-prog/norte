// Quem pode dar aula na unidade escolhida no formulário da turma.
//
// Puro, e fora do formulário, porque o formulário roda no navegador e a
// escola de duas unidades precisava disto testado: antes a lista vinha só da
// PRIMEIRA unidade, e quem criava a turma da unidade Norte via os professores
// da Sede — escolhia um, e o servidor recusava ("trabalha em outra unidade").

export type ProfessorNaTela = { id: string; nome: string; cargo: string | null; unidadeId: string | null }

/**
 * A ficha sem unidade serve em todas (o professor que roda as unidades); a
 * com unidade, só na dela — a mesma régua de `conferirProfessor` (escola.ts).
 */
export function professoresDaUnidadeEscolhida<T extends Pick<ProfessorNaTela, 'unidadeId'>>(lista: readonly T[], unidadeId: string | null | undefined): T[] {
  if (!unidadeId) return []
  return lista.filter((p) => p.unidadeId === null || p.unidadeId === unidadeId)
}
