'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Botao, Aviso, cx } from '@/ui/base'
import { enderecoDoNome } from '@/servidor/enderecos'
import { criarContaAcao, type EstadoCadastro } from './acoes'

// Campos altos, de toque — os mesmos da tela de entrar: é a primeira tela
// do sistema que a pessoa vê, e muita gente se cadastra pelo celular.
const CAMPO =
  'h-12 w-full rounded-xl border border-borda bg-superficie px-4 text-[15px] text-tinta ' +
  'placeholder:text-tinta-3 transition-shadow ' +
  'focus:border-marca focus:ring-4 focus:ring-marca/15 focus:outline-none'

const ROTULO = 'text-sm font-semibold text-tinta'

export function Formulario({
  carimbo,
  ramos,
  dominio,
  comEmail,
}: {
  /** A hora em que a página abriu, assinada (ver autocadastro.ts). */
  carimbo: string
  ramos: { valor: string; titulo: string }[]
  /** "usenorte.com.br" — só para mostrar o endereço que a loja vai ter. */
  dominio: string
  /** O servidor manda e-mail? Muda o que acontece depois do botão. */
  comEmail: boolean
}) {
  const [estado, agir, pendente] = useActionState<EstadoCadastro, FormData>(criarContaAcao, {})
  const [nome, setNome] = useState(estado.valores?.empresa ?? '')
  const [ver, setVer] = useState(false)

  // ── criada: falta o e-mail ──
  if (estado.criada) {
    const c = estado.criada
    return (
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <h2 className="text-xl font-bold tracking-tight text-titulo">Confira o seu e-mail</h2>
          <p className="text-[15px] leading-relaxed text-tinta-2">
            {c.enviado ? (
              <>
                A empresa foi criada. Mandamos um link para <b className="text-tinta">{c.email}</b> — abra o e-mail
                e toque em &ldquo;Confirmar meu e-mail&rdquo;.
              </>
            ) : (
              <>
                A empresa foi criada, mas o e-mail de confirmação não saiu agora. Na tela de entrar, digite o e-mail
                e a senha: ela oferece mandar o link de novo.
              </>
            )}
          </p>
        </div>
        <div className="rounded-xl border border-borda bg-superficie-2 px-4 py-3 text-sm">
          <span className="text-tinta-3">O endereço da sua empresa</span>
          <p className="font-semibold break-all text-tinta">
            {dominio}/{c.endereco}
          </p>
        </div>
        <ul className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-tinta-2">
          <li>O link vale por 48 horas e serve uma vez.</li>
          <li>Não chegou? Confira o spam e as promoções.</li>
          <li>Confirmado, é entrar com a senha que você escolheu e terminar o cadastro inicial.</li>
        </ul>
        <Link
          href={`/${c.endereco}/entrar`}
          className="botao-marca rounded-xl px-5 py-3 text-center text-[15px] font-semibold text-marca-tinta"
        >
          Ir para a tela de entrar
        </Link>
      </div>
    )
  }

  const sugerido = nome.trim().length >= 2 ? enderecoDoNome(nome) : null

  return (
    <form action={agir} className="flex flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}

      <input type="hidden" name="carimbo" value={carimbo} />
      {/* A isca: invisível para gente (e para o leitor de tela), preenchida
          por robô. Fora da tela em vez de `display:none`, que robô esperto
          reconhece e pula. */}
      <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="cadastro-site">Site (não preencha)</label>
        <input id="cadastro-site" name="site" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="cadastro-empresa" className={ROTULO}>
          Nome da empresa
        </label>
        <input
          id="cadastro-empresa"
          name="empresa"
          required
          minLength={2}
          maxLength={80}
          autoComplete="organization"
          autoFocus
          placeholder="Como a loja se chama"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          aria-describedby="cadastro-endereco"
          className={CAMPO}
        />
        <p id="cadastro-endereco" className="text-xs text-tinta-3" aria-live="polite">
          {sugerido ? (
            <>
              Endereço: <span className="font-semibold text-tinta-2">{dominio}/{sugerido}</span> — se já estiver em
              uso, ganha um número no fim.
            </>
          ) : (
            'É por ele que a equipe entra, num endereço só da loja.'
          )}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="cadastro-dono" className={ROTULO}>
            Seu nome
          </label>
          <input
            id="cadastro-dono"
            name="dono"
            required
            minLength={2}
            maxLength={80}
            autoComplete="name"
            defaultValue={estado.valores?.dono}
            className={CAMPO}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor="cadastro-ramo" className={ROTULO}>
            Ramo da loja
          </label>
          <select
            id="cadastro-ramo"
            name="ramo"
            required
            defaultValue={estado.valores?.ramo ?? ''}
            className={cx(CAMPO, 'pr-8')}
          >
            <option value="" disabled>
              Escolha…
            </option>
            {ramos.map((r) => (
              <option key={r.valor} value={r.valor}>
                {r.titulo}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="cadastro-email" className={ROTULO}>
          Seu e-mail
        </label>
        <input
          id="cadastro-email"
          name="email"
          type="email"
          inputMode="email"
          required
          maxLength={254}
          autoComplete="email"
          defaultValue={estado.valores?.email}
          placeholder="voce@empresa.com.br"
          aria-describedby={comEmail ? 'cadastro-email-dica' : undefined}
          className={CAMPO}
        />
        {comEmail && (
          <p id="cadastro-email-dica" className="text-xs text-tinta-3">
            Vamos mandar um link para confirmar. Sem ele, a conta não entra.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="cadastro-senha" className={ROTULO}>
          Crie uma senha
        </label>
        <div className="relative">
          <input
            id="cadastro-senha"
            name="senha"
            type={ver ? 'text' : 'password'}
            required
            minLength={8}
            autoComplete="new-password"
            aria-describedby="cadastro-senha-dica"
            className={cx(CAMPO, 'pr-20')}
          />
          <button
            type="button"
            onClick={() => setVer((v) => !v)}
            aria-pressed={ver}
            aria-controls="cadastro-senha"
            className="absolute inset-y-0 right-1.5 my-1.5 rounded-lg px-2.5 text-xs font-semibold text-tinta-2 hover:bg-superficie-2 hover:text-tinta"
          >
            {ver ? 'Ocultar' : 'Mostrar'}
          </button>
        </div>
        <p id="cadastro-senha-dica" className="text-xs text-tinta-3">
          Pelo menos 8 caracteres. Não use a mesma de outro lugar.
        </p>
      </div>

      {/* O aceite e a linha da LGPD. A caixa começa DESMARCADA: aceite
          marcado de fábrica não é aceite. */}
      <label className="flex items-start gap-3 rounded-xl border border-borda-suave bg-superficie-2 px-3.5 py-3 text-[13px] leading-relaxed text-tinta-2">
        <input type="checkbox" name="aceite" required className="mt-0.5 size-4 shrink-0 accent-[var(--marca)]" />
        <span>
          Li e aceito os{' '}
          <Link href="/termos" target="_blank" className="font-semibold text-marca underline-offset-2 hover:underline">
            Termos de Uso
          </Link>{' '}
          e a{' '}
          <Link href="/privacidade" target="_blank" className="font-semibold text-marca underline-offset-2 hover:underline">
            Política de Privacidade
          </Link>
          . Seu nome e seu e-mail são usados para criar e manter a conta da empresa e para avisos da própria
          conta — nada de propaganda sem você pedir.
        </span>
      </label>

      <Botao type="submit" largo carregando={pendente} className="mt-1 h-12 rounded-xl text-[15px]">
        {pendente ? 'Criando…' : 'Criar a conta grátis'}
      </Botao>
    </form>
  )
}
