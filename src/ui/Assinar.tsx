'use client'

// As duas peças de toda exceção que se assina: os motivos prontos (um toque
// preenche o motivo) e o campo do PIN de quem faz.
//
// O campo do PIN NÃO aparece de saída: quem decide se a exceção pede
// assinatura é o servidor (a chave da empresa, ou a exceção que pede sempre).
// A tela manda sem PIN; se a resposta vier com `precisaPin`, o campo aparece
// e a pessoa confirma. Assim nenhuma tela precisa saber da chave — e a chave
// desligada não muda nada no balcão.
//
// O número fica só neste campo, vai numa chamada e some: não é guardado no
// aparelho, nem volta preenchido.

import { cx } from './base'
import { EXCECOES, type Excecao } from '@/servidor/excecoes'

export function MotivosProntos({
  excecao,
  atual,
  aoEscolher,
  className,
}: {
  excecao: Excecao
  atual?: string
  aoEscolher: (motivo: string) => void
  className?: string
}) {
  const motivos = EXCECOES[excecao].motivos
  if (motivos.length === 0) return null
  return (
    <div className={cx('flex flex-wrap gap-1.5', className)} role="group" aria-label="Motivos prontos">
      {motivos.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => aoEscolher(m)}
          aria-pressed={atual === m}
          className={cx(
            'rounded-full border px-2.5 py-1 text-xs font-medium',
            atual === m ? 'border-marca bg-marca text-marca-tinta' : 'border-borda text-tinta-2 hover:bg-superficie-2',
          )}
        >
          {m}
        </button>
      ))}
    </div>
  )
}

export function CampoDoPin({
  slug,
  valor,
  aoMudar,
  aoEnviar,
  name,
  rotulo = 'Seu PIN',
  foco = true,
}: {
  slug: string
  valor?: string
  aoMudar?: (pin: string) => void
  /** Enter no campo. */
  aoEnviar?: () => void
  /** Em formulário (FormData): o nome do campo. */
  name?: string
  rotulo?: string
  /** Pega o foco ao aparecer (o padrão: ele aparece quando o servidor pede). */
  foco?: boolean
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-tinta">{rotulo}</span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoFocus={foco}
        maxLength={6}
        name={name}
        // Com `aoMudar`, controlado; sem ele (formulário com FormData), solto.
        value={aoMudar ? (valor ?? '') : undefined}
        onChange={aoMudar ? (e) => aoMudar(e.target.value.replace(/\D/g, '').slice(0, 6)) : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && aoEnviar) {
            e.preventDefault()
            aoEnviar()
          }
        }}
        className="numero h-11 w-40 rounded-norte border-2 border-borda bg-superficie px-3 text-center text-xl font-bold tracking-[0.4em] text-tinta focus:border-marca focus:outline-none"
      />
      <span className="text-xs text-tinta-3">
        É a sua assinatura: fica no livro que foi você. Ainda não tem?{' '}
        <a href={`/${slug}/conta`} target="_blank" rel="noopener" className="font-medium text-marca underline-offset-2 hover:underline">
          Crie em Minha conta
        </a>
        .
      </span>
    </label>
  )
}
