'use client'

// A tela da equipe.
//
// ── a decisão que evita o erro caro ──────────────────────────
// TIRAR O ACESSO NÃO APAGA A PESSOA. A venda que ela fez, o caixa que ela
// fechou e as linhas dela no livro de auditoria continuam lá, com o nome
// dela. Apagar levaria a comissão de março junto.
//
// E o link do convite aparece UMA vez. Não é descuido: o banco guarda só o
// resumo do token, então nem nós conseguimos recuperar o link depois. A tela
// diz isso, para ninguém fechar a página achando que dá para voltar.

import { useActionState, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Botao, Campo, Selecao, Aviso, Cartao, Situacao, cx } from '@/ui/base'
import { convidarPessoa, revogar, trocarPapel, trocarSituacao, type EstadoEquipe } from './acoes'

export type PessoaNaTela = {
  id: string
  nome: string
  email: string
  ativo: boolean
  ultimoLogin: string | null
  papel: string | null
  unidadeId: string | null
  unidadeNome: string | null
  souEu: boolean
}

export type ConviteNaTela = {
  id: string
  email: string
  papel: string
  expiraEm: string
  vencido: boolean
}

const ROTULO: Record<string, string> = {
  DONO: 'Dono',
  GERENTE: 'Gerente',
  BALCAO: 'Balcão',
  FINANCEIRO: 'Financeiro',
  CONTADOR: 'Contador',
  SUPORTE: 'Suporte',
}

const RESUMO: Record<string, string> = {
  DONO: 'Tudo, em todas as lojas',
  GERENTE: 'Toca a operação da loja dele',
  BALCAO: 'Vende e opera o caixa',
  FINANCEIRO: 'O dinheiro, sem mexer em produto',
  CONTADOR: 'Só olha o financeiro',
}

export function Equipe({
  slug,
  pessoas,
  convites,
  unidades,
  papeisQuePosso,
  podeGerir,
}: {
  slug: string
  pessoas: PessoaNaTela[]
  convites: ConviteNaTela[]
  unidades: { id: string; nome: string }[]
  /** Só os papéis que ESTA pessoa pode conceder. */
  papeisQuePosso: string[]
  podeGerir: boolean
}) {
  const acao = convidarPessoa.bind(null, slug)
  const [estado, agir, pendente] = useActionState<EstadoEquipe, FormData>(acao, {})
  const [abrindo, setAbrindo] = useState(false)
  const [recado, setRecado] = useState<EstadoEquipe | null>(null)
  const [indo, comecar] = useTransition()
  const router = useRouter()

  const fazer = (fn: () => Promise<EstadoEquipe>) =>
    comecar(async () => {
      const r = await fn()
      setRecado(r)
      router.refresh()
    })

  return (
    <div className="flex flex-col gap-4">
      {recado?.erro && <Aviso nivel="critico">{recado.erro}</Aviso>}
      {recado?.ok && <Aviso nivel="bom">{recado.ok}</Aviso>}

      {/* ── quem tem acesso ── */}
      <Cartao
        titulo="Quem tem acesso"
        acao={
          podeGerir && !abrindo ? (
            <button
              type="button"
              onClick={() => setAbrindo(true)}
              className="text-xs font-semibold text-marca hover:underline"
            >
              + Convidar
            </button>
          ) : undefined
        }
      >
        <ul className="flex flex-col">
          {pessoas.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-borda-suave py-3 last:border-0"
            >
              <span className="flex min-w-0 flex-col">
                <span className="flex items-center gap-2">
                  <span className={cx('text-sm font-semibold', p.ativo ? 'text-tinta' : 'text-tinta-3')}>
                    {p.nome}
                  </span>
                  {p.souEu && (
                    <span className="rounded bg-superficie-2 px-1.5 py-px text-[10px] font-bold text-tinta-3 uppercase">
                      você
                    </span>
                  )}
                </span>
                <span className="truncate text-xs text-tinta-3">
                  {p.email}
                  {p.ultimoLogin && ` · entrou ${p.ultimoLogin}`}
                  {!p.ultimoLogin && ' · nunca entrou'}
                </span>
              </span>

              <span className="flex flex-wrap items-center gap-2">
                {p.papel ? (
                  <Situacao nivel={p.ativo ? 'bom' : 'neutro'}>
                    {ROTULO[p.papel] ?? p.papel}
                    {p.unidadeNome ? ` · ${p.unidadeNome}` : ''}
                  </Situacao>
                ) : (
                  <Situacao nivel="atencao">sem acesso</Situacao>
                )}

                {podeGerir && !p.souEu && (
                  <>
                    <Selecao
                      rotulo=""
                      aria-label={`Papel de ${p.nome}`}
                      value={p.papel ?? ''}
                      disabled={indo}
                      onChange={(e) =>
                        fazer(() => trocarPapel(slug, p.id, e.currentTarget.value, p.unidadeId))
                      }
                      opcoes={[
                        { valor: '', titulo: 'Sem acesso' },
                        ...papeisQuePosso.map((v) => ({ valor: v, titulo: ROTULO[v] ?? v })),
                      ]}
                      className="py-1 text-xs"
                    />
                    <Botao
                      tom={p.ativo ? 'secundario' : 'confirmar'}
                      className="px-2 py-1 text-xs"
                      carregando={indo}
                      onClick={() => fazer(() => trocarSituacao(slug, p.id, !p.ativo))}
                    >
                      {p.ativo ? 'Tirar acesso' : 'Devolver'}
                    </Botao>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-xs text-tinta-3">
          Tirar o acesso não apaga a pessoa: a venda que ela fez e as linhas dela no livro
          continuam com o nome dela. Ela só para de entrar — na próxima tela que abrir.
        </p>
      </Cartao>

      {/* ── convidar ── */}
      {podeGerir && abrindo && (
        <Cartao
          titulo="Convidar alguém"
          acao={
            <button
              type="button"
              onClick={() => setAbrindo(false)}
              className="text-xs text-tinta-3 hover:text-tinta"
            >
              fechar
            </button>
          }
        >
          <form action={agir} className="flex flex-col gap-4">
            {estado.erro && <Aviso nivel="critico">{estado.erro}</Aviso>}
            {estado.ok && (
              <Aviso nivel="bom">
                <span className="flex flex-col gap-1.5">
                  <span>{estado.ok}</span>
                  <code className="block overflow-x-auto rounded bg-superficie px-2 py-1.5 font-mono text-xs break-all text-tinta">
                    {estado.link}
                  </code>
                  <span className="text-xs">
                    Copie agora. Este link não aparece de novo — o sistema guarda só o
                    resumo dele, então nem nós conseguimos recuperar.
                  </span>
                </span>
              </Aviso>
            )}

            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="E-mail" name="email" type="email" required placeholder="pessoa@loja.com" />
              <Selecao
                rotulo="Papel"
                name="papel"
                required
                opcoes={[
                  { valor: '', titulo: 'Escolha...' },
                  ...papeisQuePosso.map((v) => ({ valor: v, titulo: `${ROTULO[v]} — ${RESUMO[v]}` })),
                ]}
              />
              <Selecao
                rotulo="Loja"
                name="unidadeId"
                opcoes={[
                  { valor: '', titulo: 'Todas as lojas' },
                  ...unidades.map((u) => ({ valor: u.id, titulo: u.nome })),
                ]}
                dica="Preso a uma loja, ele não vê as outras."
              />
            </div>

            <div className="flex justify-end">
              <Botao type="submit" tom="confirmar" carregando={pendente}>
                {pendente ? 'Criando...' : 'Criar convite'}
              </Botao>
            </div>
          </form>
        </Cartao>
      )}

      {/* ── convites em aberto ── */}
      {convites.length > 0 && (
        <Cartao titulo="Convites esperando" acao={<span className="text-xs text-tinta-3">{convites.length}</span>}>
          <ul className="flex flex-col">
            {convites.map((c) => (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 border-b border-borda-suave py-2.5 last:border-0"
              >
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-sm text-tinta">{c.email}</span>
                  <span className="text-xs text-tinta-3">
                    {ROTULO[c.papel] ?? c.papel} · {c.vencido ? 'venceu' : `vale até ${c.expiraEm}`}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Situacao nivel={c.vencido ? 'critico' : 'atencao'}>
                    {c.vencido ? 'vencido' : 'esperando'}
                  </Situacao>
                  {podeGerir && (
                    <Botao
                      tom="secundario"
                      className="px-2 py-1 text-xs"
                      carregando={indo}
                      onClick={() => fazer(() => revogar(slug, c.id))}
                    >
                      Cancelar
                    </Botao>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Cartao>
      )}
    </div>
  )
}
