'use client'

import { useActionState, useState } from 'react'
import { Botao, Aviso, cx } from '@/ui/base'
import { novaSenhaAcao, pedirLinkAcao, type EstadoNovaSenha, type EstadoPedido } from './acoes'

// Os mesmos campos altos da tela de entrar: esta tela também abre no tablet
// do balcão, e a pessoa que esqueceu a senha já está com pressa.
const CAMPO =
  'h-12 w-full rounded-xl border border-borda bg-superficie px-4 text-[15px] text-tinta ' +
  'placeholder:text-tinta-3 transition-shadow ' +
  'focus:border-marca focus:ring-4 focus:ring-marca/15 focus:outline-none'

/** Pedir o link: só o e-mail. */
export function PedirLink({ slug, empresa }: { slug: string; empresa: string }) {
  const [estado, agir, pendente] = useActionState<EstadoPedido, FormData>(pedirLinkAcao.bind(null, slug), {})

  // Depois do envio, a MESMA frase para todo e-mail — é ela que impede a tela
  // de virar um jeito de descobrir quem trabalha na empresa.
  if (estado.enviado) {
    return (
      <div className="flex flex-col gap-4">
        <Aviso nivel="bom">
          Se <b>{estado.email}</b> tem uma conta ativa em {empresa}, o link para escolher a senha nova chega em
          alguns minutos.
        </Aviso>
        <ul className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-tinta-2">
          <li>O link vale por 30 minutos e serve uma vez. Pediu de novo? Vale só o último.</li>
          <li>Não chegou? Confira o spam e as promoções.</li>
          <li>
            Continua sem chegar? Peça para quem administra a empresa gerar um link na tela <b>Equipe</b>.
          </li>
        </ul>
      </div>
    )
  }

  return (
    <form action={agir} className="flex flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="pedir-email" className="text-sm font-semibold text-tinta">
          E-mail
        </label>
        <input
          id="pedir-email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          defaultValue={estado.email}
          required
          autoFocus
          placeholder="voce@empresa.com.br"
          className={CAMPO}
        />
      </div>
      <Botao type="submit" largo carregando={pendente} className="h-12 rounded-xl text-[15px]">
        {pendente ? 'Enviando…' : 'Mandar o link'}
      </Botao>
    </form>
  )
}

/** Escolher a senha nova, com o link na mão. */
export function NovaSenha({ slug, token }: { slug: string; token: string }) {
  const [estado, agir, pendente] = useActionState<EstadoNovaSenha, FormData>(novaSenhaAcao.bind(null, slug, token), {})
  const [ver, setVer] = useState(false)

  return (
    <form action={agir} className="flex flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="nova-senha" className="text-sm font-semibold text-tinta">
          Senha nova
        </label>
        <div className="relative">
          <input
            id="nova-senha"
            name="senha"
            type={ver ? 'text' : 'password'}
            autoComplete="new-password"
            minLength={8}
            required
            autoFocus
            aria-describedby="nova-senha-dica"
            className={cx(CAMPO, 'pr-20')}
          />
          <button
            type="button"
            onClick={() => setVer((v) => !v)}
            aria-pressed={ver}
            aria-controls="nova-senha"
            className="absolute inset-y-0 right-1.5 my-1.5 rounded-lg px-2.5 text-xs font-semibold text-tinta-2 hover:bg-superficie-2 hover:text-tinta"
          >
            {ver ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
        <p id="nova-senha-dica" className="text-xs text-tinta-3">
          Pelo menos 8 caracteres. Não use a mesma de outro lugar.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="nova-repetida" className="text-sm font-semibold text-tinta">
          Repita a senha nova
        </label>
        <input
          id="nova-repetida"
          name="repetida"
          type={ver ? 'text' : 'password'}
          autoComplete="new-password"
          minLength={8}
          required
          className={CAMPO}
        />
      </div>

      <Botao type="submit" largo carregando={pendente} className="mt-1 h-12 rounded-xl text-[15px]">
        {pendente ? 'Salvando…' : 'Salvar a senha nova'}
      </Botao>
      <p className="text-xs leading-relaxed text-tinta-3">
        Ao salvar, todos os aparelhos que estavam dentro da sua conta saem — inclusive algum que você não
        reconheça.
      </p>
    </form>
  )
}
