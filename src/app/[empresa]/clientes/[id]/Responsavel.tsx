'use client'

// O responsável pelo aluno: quem paga e quem a escola contata.
//
// Guarda o mínimo — nome, parentesco e contato; CPF só se a escola dá recibo
// para o imposto de renda. E o aceite do AVISO DA MENSALIDADE no WhatsApp é
// dele, com como ele respondeu: é a prova (LGPD, art. 8º, § 2º). Salvar a
// ficha por outro motivo não aceita de novo; trocar o telefone zera o aceite
// (o aceite era do número antigo).

import { useActionState, useState } from 'react'
import { Aviso, Botao, Campo, Selecao } from '@/ui/base'
import { semApagar } from '@/ui/formulario'
import { salvarResponsavelAcao, type EstadoResponsavel } from './acoesEscola'

export type ResponsavelNaTela = {
  nome: string
  parentesco: string
  telefone: string
  email: string
  documento: string
  avisos: 'SIM' | 'NAO' | 'NAO_PERGUNTADO'
  /** "Aceitou em 12/09/2026, no balcão. Anotado por Ana." */
  resumoAviso: string | null
}

export function Responsavel({
  slug,
  alunoId,
  inicial,
  escola,
  origens,
  palavra,
}: {
  slug: string
  alunoId: string
  inicial: ResponsavelNaTela | null
  escola: string
  origens: { valor: string; titulo: string }[]
  palavra: string
}) {
  const [aberto, setAberto] = useState(!inicial)
  const acao = salvarResponsavelAcao.bind(null, slug, alunoId)
  const [estado, agir, pendente] = useActionState<EstadoResponsavel, FormData>(acao, {})
  const [aviso, setAviso] = useState<string>('')

  if (!aberto) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Botao tom="secundario" onClick={() => setAberto(true)} className="py-1 text-xs">
          Editar responsável
        </Botao>
        {estado.ok && <span className="text-xs font-medium text-bom">{estado.ok}</span>}
      </div>
    )
  }

  return (
    <form action={agir} onSubmit={semApagar(agir)} className="flex flex-col gap-3">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {estado.ok && <Aviso nivel="bom">{estado.ok}</Aviso>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Nome do responsável" name="nome" required defaultValue={inicial?.nome} placeholder="Maria Souza" />
        <Campo rotulo="Parentesco" name="parentesco" defaultValue={inicial?.parentesco} placeholder={`mãe, pai, avó, o próprio ${palavra}`} />
        <Campo rotulo="WhatsApp" name="telefone" type="tel" inputMode="tel" defaultValue={inicial?.telefone} placeholder="(71) 99999-0000" />
        <Campo rotulo="E-mail" name="email" type="email" defaultValue={inicial?.email} />
        <Campo rotulo="CPF (opcional)" name="documento" inputMode="numeric" defaultValue={inicial?.documento} dica="Só se a escola dá recibo para o imposto de renda." />
      </div>

      <fieldset className="flex flex-col gap-2 rounded-norte border border-borda p-3">
        <legend className="px-1 text-sm font-semibold text-tinta">Aviso da mensalidade no WhatsApp</legend>
        <p className="text-xs text-tinta-2">
          “Pode receber no WhatsApp o aviso da mensalidade da {escola} (valor e vencimento)? Para sair é só responder PARAR.”
        </p>
        {inicial?.resumoAviso && <p className="text-xs text-tinta-3">{inicial.resumoAviso}</p>}
        <div className="flex flex-wrap gap-2 text-sm">
          {[
            { v: '', t: inicial ? 'Não mudar' : 'Não perguntei' },
            { v: 'SIM', t: 'Aceita' },
            { v: 'NAO', t: 'Não aceita' },
          ].map((o) => (
            <label key={o.v} className="flex items-center gap-1.5 rounded-norte border border-borda px-2.5 py-1.5 has-checked:border-marca has-checked:bg-marca-suave">
              <input type="radio" name="avisos" value={o.v} checked={aviso === o.v} onChange={() => setAviso(o.v)} className="accent-[var(--marca)]" />
              {o.t}
            </label>
          ))}
        </div>
        {aviso && <Selecao rotulo="Como respondeu" name="avisosOrigem" defaultValue="balcao" opcoes={origens} />}
        <p className="text-[11px] text-tinta-3">A mensagem vai só para este número, nunca para o {palavra}. E só sai se a escola ligar o aviso em Configurações.</p>
      </fieldset>

      <div className="flex justify-end gap-2">
        {inicial && (
          <Botao type="button" tom="discreto" onClick={() => setAberto(false)}>
            Fechar
          </Botao>
        )}
        <Botao type="submit" carregando={pendente}>
          {pendente ? 'Salvando...' : 'Salvar responsável'}
        </Botao>
      </div>
    </form>
  )
}
