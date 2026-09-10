'use client'

import { useActionState } from 'react'
import { Botao, Campo, Aviso } from '@/ui/base'
import { entrarAcao, type EstadoEntrada } from './acoes'

export function Formulario({ empresa }: { empresa: string }) {
  const [estado, agir, pendente] = useActionState<EstadoEntrada, FormData>(entrarAcao, {})

  return (
    <form action={agir} className="flex flex-col gap-4">
      <input type="hidden" name="empresa" value={empresa} />

      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}

      {/* ── a casa está cheia ──
          A senha estava certa. Isto não é erro da pessoa, e a tela não pode
          tratar como se fosse: em vez de uma frase de recusa, ela mostra o
          retrato de quem está dentro e há quanto cada um parou.

          O último parágrafo é o mais importante: a vaga se solta sozinha.
          Sem ele, a pessoa acha que precisa da ajuda de alguém para trabalhar
          — e liga para você. */}
      {estado.semVaga && (
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-norte border border-atencao-borda bg-atencao-fundo px-4 py-3.5"
        >
          <div className="flex flex-col gap-1">
            <p className="text-sm font-bold text-tinta">
              A senha está certa, mas o plano está cheio agora.
            </p>
            <p className="text-[13px] leading-relaxed text-tinta-2">
              {estado.semVaga.length === 1
                ? 'Uma pessoa está usando o sistema:'
                : `${estado.semVaga.length} pessoas estão usando o sistema:`}
            </p>
          </div>

          <ul className="flex flex-col gap-1">
            {estado.semVaga.map((o) => (
              <li
                key={o.nome}
                className="flex items-baseline justify-between gap-3 border-t border-atencao-borda/60 pt-1.5 text-[13px]"
              >
                <span className="font-semibold text-tinta">{o.nome}</span>
                {/* "sem mexer", e não "parado/parada": o nome de alguém não
                    diz o gênero dessa pessoa, e a tela não tem por que
                    adivinhar para dizer uma coisa que cabe sem gênero
                    nenhum. */}
                <span className="numero shrink-0 text-tinta-2">
                  {o.paradaMin < 1 ? 'mexendo agora' : `sem mexer há ${o.paradaMin} min`}
                </span>
              </li>
            ))}
          </ul>

          <p className="text-[13px] leading-relaxed text-tinta-2">
            Peça para alguém sair — ou espere: <b>a vaga se solta sozinha</b> quando a pessoa
            fica 10 minutos sem mexer, e aí é só entrar de novo.
          </p>
        </div>
      )}

      <Campo
        rotulo="E-mail"
        name="email"
        type="email"
        autoComplete="username"
        defaultValue={estado.email}
        required
        autoFocus
      />
      <Campo rotulo="Senha" name="senha" type="password" autoComplete="current-password" required />

      <Botao type="submit" largo carregando={pendente}>
        {pendente ? 'Entrando...' : 'Entrar'}
      </Botao>
    </form>
  )
}
