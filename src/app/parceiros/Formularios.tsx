'use client'

import { useActionState, useState } from 'react'
import Link from 'next/link'
import { Botao, Aviso, cx } from '@/ui/base'
import { cadastrarAcao, entrarAcao, esqueciAcao, novaSenhaAcao, type Estado } from './acoes'

// Campos altos, de toque — os mesmos do cadastro da loja.
export const CAMPO =
  'h-12 w-full rounded-xl border border-borda bg-superficie px-4 text-[15px] text-tinta ' +
  'placeholder:text-tinta-3 transition-shadow ' +
  'focus:border-marca focus:ring-4 focus:ring-marca/15 focus:outline-none'
export const ROTULO = 'text-sm font-semibold text-tinta'

function Linha({ id, rotulo, dica, children }: { id: string; rotulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className={ROTULO}>
        {rotulo}
      </label>
      {children}
      {dica && <p className="text-xs text-tinta-3">{dica}</p>}
    </div>
  )
}

function Senha({ id, nome = 'senha', nova = true, rotulo }: { id: string; nome?: string; nova?: boolean; rotulo: string }) {
  const [ver, setVer] = useState(false)
  return (
    <Linha id={id} rotulo={rotulo} dica={nova ? 'Pelo menos 8 caracteres.' : undefined}>
      <div className="relative">
        <input
          id={id}
          name={nome}
          type={ver ? 'text' : 'password'}
          required
          minLength={nova ? 8 : 1}
          autoComplete={nova ? 'new-password' : 'current-password'}
          className={cx(CAMPO, 'pr-20')}
        />
        <button
          type="button"
          onClick={() => setVer((v) => !v)}
          aria-pressed={ver}
          aria-controls={id}
          className="absolute inset-y-0 right-1.5 my-1.5 rounded-lg px-2.5 text-xs font-semibold text-tinta-2 hover:bg-superficie-2 hover:text-tinta"
        >
          {ver ? 'Ocultar' : 'Mostrar'}
        </button>
      </div>
    </Linha>
  )
}

export function FormCadastro({ carimbo, quemTrouxe }: { carimbo: string; quemTrouxe: string | null }) {
  const [estado, agir, pendente] = useActionState<Estado, FormData>(cadastrarAcao, {})
  const v = estado.valores ?? {}
  return (
    <form action={agir} className="flex flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      {quemTrouxe && <Aviso nivel="bom">Você entra na rede de {quemTrouxe}.</Aviso>}
      <input type="hidden" name="carimbo" value={carimbo} />
      <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="p-site">Site (não preencha)</label>
        <input id="p-site" name="site" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <Linha id="p-nome" rotulo="Seu nome">
        <input id="p-nome" name="nome" required minLength={2} maxLength={80} autoComplete="name" defaultValue={v.nome} className={CAMPO} />
      </Linha>
      <Linha id="p-email" rotulo="Seu e-mail" dica="É com ele que você entra no painel.">
        <input id="p-email" name="email" type="email" inputMode="email" required maxLength={254} autoComplete="email" defaultValue={v.email} className={CAMPO} />
      </Linha>
      <Linha id="p-tel" rotulo="WhatsApp" dica="Para a equipe falar com você sobre os pagamentos.">
        <input id="p-tel" name="telefone" type="tel" inputMode="tel" maxLength={20} autoComplete="tel" placeholder="(71) 99999-0000" defaultValue={v.telefone} className={CAMPO} />
      </Linha>
      <Senha id="p-senha" rotulo="Crie uma senha" />
      <label className="flex items-start gap-3 rounded-xl border border-borda-suave bg-superficie-2 px-3.5 py-3 text-[13px] leading-relaxed text-tinta-2">
        <input type="checkbox" name="aceite" required className="mt-0.5 size-4 shrink-0 accent-[var(--marca)]" />
        <span>
          Li e aceito os{' '}
          <Link href="/parceiros/termos" target="_blank" className="font-semibold text-marca underline-offset-2 hover:underline">
            termos do programa de parceiros
          </Link>{' '}
          e a{' '}
          <Link href="/privacidade" target="_blank" className="font-semibold text-marca underline-offset-2 hover:underline">
            Política de Privacidade
          </Link>
          .
        </span>
      </label>
      <Botao type="submit" largo carregando={pendente} className="mt-1 h-12 rounded-xl text-[15px]">
        {pendente ? 'Criando…' : 'Criar minha conta de parceiro'}
      </Botao>
      <p className="text-center text-sm text-tinta-2">
        Já é parceiro?{' '}
        <Link href="/parceiros/entrar" className="font-semibold text-marca hover:underline">
          Entrar
        </Link>
      </p>
    </form>
  )
}

export function FormEntrar() {
  const [estado, agir, pendente] = useActionState<Estado, FormData>(entrarAcao, {})
  return (
    <form action={agir} className="flex flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      <Linha id="e-email" rotulo="E-mail">
        <input id="e-email" name="email" type="email" inputMode="email" required autoComplete="email" autoFocus defaultValue={estado.valores?.email} className={CAMPO} />
      </Linha>
      <Senha id="e-senha" rotulo="Senha" nova={false} />
      <Botao type="submit" largo carregando={pendente} className="mt-1 h-12 rounded-xl text-[15px]">
        {pendente ? 'Entrando…' : 'Entrar'}
      </Botao>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <Link href="/parceiros/esqueci" className="font-semibold text-marca hover:underline">
          Esqueci a senha
        </Link>
        <Link href="/parceiros/cadastro" className="font-semibold text-marca hover:underline">
          Quero ser parceiro
        </Link>
      </div>
    </form>
  )
}

export function FormEsqueci() {
  const [estado, agir, pendente] = useActionState<Estado, FormData>(esqueciAcao, {})
  if (estado.ok) return <Aviso nivel="bom">{estado.ok}</Aviso>
  return (
    <form action={agir} className="flex flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      <Linha id="s-email" rotulo="O e-mail da sua conta de parceiro">
        <input id="s-email" name="email" type="email" inputMode="email" required autoComplete="email" autoFocus defaultValue={estado.valores?.email} className={CAMPO} />
      </Linha>
      <Botao type="submit" largo carregando={pendente} className="h-12 rounded-xl text-[15px]">
        Mandar o link
      </Botao>
    </form>
  )
}

export function FormNovaSenha({ codigo }: { codigo: string }) {
  const [estado, agir, pendente] = useActionState<Estado, FormData>(novaSenhaAcao, {})
  return (
    <form action={agir} className="flex flex-col gap-4">
      {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
      <input type="hidden" name="codigo" value={codigo} />
      <Senha id="n-senha" rotulo="Senha nova" />
      <Senha id="n-confirma" nome="confirma" rotulo="Repita a senha nova" />
      <Botao type="submit" largo carregando={pendente} className="h-12 rounded-xl text-[15px]">
        Salvar e entrar
      </Botao>
    </form>
  )
}
