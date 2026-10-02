'use client'

// Os cargos da empresa: o dono cria "Subgerente", marca o que ele pode, e o
// cargo aparece na lista de papéis da equipe e do convite.
//
// O que dá para marcar já vem filtrado do servidor (o teto é o Gerente, e os
// grupos de módulo desligado nem aparecem). O servidor confere de novo ao
// salvar e a cada tela de quem tem o cargo — a tela é só a conversa.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Aviso, Botao, Campo, cx } from '@/ui/base'
import { Confirmar } from '@/ui/Confirmar'
import { apagarCargoAcao, salvarCargoAcao, type EstadoEquipe } from './acoes'

type Grupo = { titulo: string; itens: { capacidade: string; titulo: string }[] }
type Cargo = { id: string; nome: string; capacidades: string[]; pessoas: number; convites: number }
type Rascunho = { id: string | null; nome: string; marcadas: Set<string> }

export function Cargos({
  slug,
  cargos,
  grupos,
  modelos,
  podeEditar,
}: {
  slug: string
  cargos: Cargo[]
  grupos: Grupo[]
  modelos: { nome: string; capacidades: string[] }[]
  podeEditar: boolean
}) {
  const [rascunho, setRascunho] = useState<Rascunho | null>(null)
  const [recado, setRecado] = useState<EstadoEquipe | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  const existe = new Set(grupos.flatMap((g) => g.itens.map((i) => i.capacidade)))
  const titulo = new Map(grupos.flatMap((g) => g.itens.map((i) => [i.capacidade, i.titulo] as const)))
  const abrir = (c: { id: string | null; nome: string; capacidades: string[] }) =>
    setRascunho({ id: c.id, nome: c.nome, marcadas: new Set(c.capacidades.filter((x) => existe.has(x))) })

  const marcar = (cap: string, sim: boolean) =>
    setRascunho((r) => {
      if (!r) return r
      const marcadas = new Set(r.marcadas)
      if (sim) marcadas.add(cap)
      else marcadas.delete(cap)
      return { ...r, marcadas }
    })

  const salvar = () =>
    rascunho &&
    comecar(async () => {
      const r = await salvarCargoAcao(slug, { id: rascunho.id, nome: rascunho.nome, capacidades: [...rascunho.marcadas] })
      setRecado(r)
      if (r.ok) {
        setRascunho(null)
        router.refresh()
      }
    })

  return (
    <div className="flex flex-col gap-4">
      {recado?.erro && <Aviso nivel="critico">{recado.erro}</Aviso>}
      {recado?.ok && <Aviso nivel="bom">{recado.ok}</Aviso>}

      {cargos.length === 0 && !rascunho && (
        <p className="text-sm text-tinta-2">
          Nenhum cargo criado ainda. Gerente, Balcão e Financeiro continuam valendo; o cargo é para quem fica no meio.
        </p>
      )}

      {cargos.length > 0 && (
        <ul className="flex flex-col">
          {cargos.map((c) => (
            <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 border-b border-borda-suave py-3 last:border-0">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold text-tinta">{c.nome}</span>
                <span className="text-xs text-tinta-3">
                  {c.pessoas === 0 ? 'ninguém com este cargo' : c.pessoas === 1 ? '1 pessoa' : `${c.pessoas} pessoas`}
                  {c.convites > 0 && ` · ${c.convites === 1 ? '1 convite esperando' : `${c.convites} convites esperando`}`}
                </span>
                <span className="text-xs text-tinta-2">
                  {c.capacidades.map((x) => titulo.get(x)).filter(Boolean).join(' · ') || 'nada marcado'}
                </span>
              </span>
              {podeEditar && (
                <span className="flex items-center gap-2">
                  <Botao tom="discreto" className="px-2 py-1 text-xs" onClick={() => abrir(c)} disabled={indo}>
                    Mudar
                  </Botao>
                  <Confirmar
                    tom="secundario"
                    className="px-2 py-1 text-xs"
                    pergunta={`Apagar o cargo "${c.nome}"?${c.convites > 0 ? ' Os convites esperando com ele param de valer.' : ''}`}
                    sim="Sim, apagar"
                    aoConfirmar={async () => {
                      const r = await apagarCargoAcao(slug, c.id)
                      if (r.erro) return r
                      setRecado(r)
                      router.refresh()
                    }}
                  >
                    Apagar
                  </Confirmar>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {podeEditar && !rascunho && (
        <div className="flex flex-wrap items-center gap-2">
          <Botao tom="confirmar" className="px-3 py-1.5 text-sm" onClick={() => abrir({ id: null, nome: '', capacidades: [] })}>
            + Novo cargo
          </Botao>
          {modelos
            .filter((m) => !cargos.some((c) => c.nome.toLowerCase() === m.nome.toLowerCase()))
            .map((m) => (
              <Botao key={m.nome} tom="discreto" className="px-3 py-1.5 text-sm" onClick={() => abrir({ id: null, ...m })}>
                Começar de &ldquo;{m.nome}&rdquo;
              </Botao>
            ))}
        </div>
      )}

      {podeEditar && rascunho && (
        <form
          className="flex flex-col gap-4 rounded-norte border border-borda bg-superficie p-4"
          onSubmit={(e) => {
            e.preventDefault()
            salvar()
          }}
        >
          <Campo
            rotulo="Nome do cargo"
            value={rascunho.nome}
            onChange={(e) => setRascunho({ ...rascunho, nome: e.currentTarget.value })}
            placeholder="Subgerente"
            maxLength={40}
            required
            autoFocus
          />

          <div className="grid gap-4 sm:grid-cols-2">
            {grupos.map((g) => {
              const todas = g.itens.every((i) => rascunho.marcadas.has(i.capacidade))
              return (
                <fieldset key={g.titulo} className="flex flex-col gap-1.5">
                  <legend className="mb-1 flex w-full items-center justify-between gap-2 text-xs font-bold tracking-wide text-tinta-3 uppercase">
                    {g.titulo}
                    <button
                      type="button"
                      className="text-[11px] font-semibold tracking-normal text-marca normal-case hover:underline"
                      onClick={() => g.itens.forEach((i) => marcar(i.capacidade, !todas))}
                    >
                      {todas ? 'desmarcar todas' : 'marcar todas'}
                    </button>
                  </legend>
                  {g.itens.map((i) => (
                    <label key={i.capacidade} className={cx('flex items-start gap-2 text-sm', rascunho.marcadas.has(i.capacidade) ? 'text-tinta' : 'text-tinta-2')}>
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 shrink-0 accent-[var(--marca)]"
                        checked={rascunho.marcadas.has(i.capacidade)}
                        onChange={(e) => marcar(i.capacidade, e.currentTarget.checked)}
                      />
                      {i.titulo}
                    </label>
                  ))}
                </fieldset>
              )
            })}
          </div>

          <p className="text-xs text-tinta-3">
            Configurar a empresa, lançar no financeiro e dar acesso a outras pessoas ficam sempre com o dono. Quem tem o
            cargo passa a poder o que está marcado na próxima tela que abrir.
          </p>

          <div className="flex justify-end gap-2">
            <Botao tom="discreto" onClick={() => setRascunho(null)} disabled={indo}>
              Cancelar
            </Botao>
            <Botao type="submit" tom="confirmar" carregando={indo}>
              {rascunho.id ? 'Salvar cargo' : 'Criar cargo'}
            </Botao>
          </div>
        </form>
      )}
    </div>
  )
}
