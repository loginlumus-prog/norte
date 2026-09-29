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
import { Confirmar } from '@/ui/Confirmar'
import {
  convidarPessoa,
  cortarSuporte,
  gerarLinkSenha,
  revogar,
  trocarPapel,
  trocarSituacao,
  trocarTelefone,
  type EstadoEquipe,
} from './acoes'

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
  /** Celular com DDD: é por ele que o assistente reconhece a pessoa no WhatsApp. */
  telefone: string | null
  /**
   * Só 'confirmado' vale para o assistente: número só digitado é tratado
   * como de cliente. Quem confirma é a própria pessoa, em Minha conta.
   */
  telefoneEstado: 'sem_telefone' | 'falta_confirmar' | 'confirmado' | 'vencido'
  /**
   * Quem está vendo pode mexer no acesso desta pessoa? Vem do servidor
   * (`podeMexerEm`): o gerente não mexe na linha da dona, e mostrar o botão
   * que o servidor recusa só ensina que o sistema "não funciona".
   */
  podeMexer: boolean
  /** Pode mudar o telefone desta linha: o próprio (se não é só leitura) ou quem pode mexer. */
  podeTelefone: boolean
}

/** Uma conta do NOSSO suporte com acesso valendo. Mostrada à parte da equipe. */
export type SuporteNaTela = {
  id: string
  nome: string
  /** "28/09, 14:00" — o acesso de suporte sempre tem prazo. */
  ate: string | null
  motivo: string | null
}

/** "71999990000" → "(71) 99999-0000". O que não tiver forma de celular fica como veio. */
function mostrarTelefone(t: string | null): string {
  if (!t) return ''
  const d = t.replace(/\D/g, '')
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return t
}

/**
 * O telefone na linha da pessoa: texto enquanto está quieto, campo quando
 * alguém clica em mudar. A própria pessoa sempre pode; o de outra, só quem
 * gere a equipe (o servidor confere de novo).
 */
function Telefone({
  slug,
  pessoa,
  pode,
  aoSalvar,
}: {
  slug: string
  pessoa: PessoaNaTela
  pode: boolean
  aoSalvar: (r: EstadoEquipe) => void
}) {
  const [editando, setEditando] = useState(false)
  const [valor, setValor] = useState(mostrarTelefone(pessoa.telefone))
  const [indo, comecar] = useTransition()
  const router = useRouter()

  if (!editando) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-tinta-3">
        {pessoa.telefone ? (
          <>
            <span className="numero text-tinta-2">{mostrarTelefone(pessoa.telefone)}</span>
            {pessoa.telefoneEstado === 'confirmado' ? (
              <Situacao nivel="bom">confirmado</Situacao>
            ) : (
              <span
                title={
                  pessoa.souEu
                    ? 'Confirme em Minha conta: até lá o assistente trata este número como de cliente.'
                    : 'A pessoa confirma em Minha conta. Até lá o assistente trata este número como de cliente.'
                }
              >
                <Situacao nivel="atencao">
                  {pessoa.telefoneEstado === 'vencido' ? 'confirmar de novo' : 'falta confirmar'}
                </Situacao>
              </span>
            )}
          </>
        ) : (
          <span>sem telefone</span>
        )}
        {pode && (
          <button
            type="button"
            onClick={() => setEditando(true)}
            className="font-semibold text-marca hover:underline"
          >
            {pessoa.telefone ? 'mudar' : pessoa.souEu ? '+ cadastrar o meu' : '+ cadastrar'}
          </button>
        )}
      </span>
    )
  }

  return (
    <form
      className="flex flex-wrap items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault()
        comecar(async () => {
          const r = await trocarTelefone(slug, pessoa.id, valor)
          aoSalvar(r)
          if (r.ok) {
            setEditando(false)
            router.refresh()
          }
        })
      }}
    >
      <input
        aria-label={`Telefone de ${pessoa.nome}`}
        type="tel"
        inputMode="tel"
        autoFocus
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        placeholder="(71) 99999-0000"
        className="w-40 rounded-norte border border-borda bg-superficie px-2 py-1 text-xs text-tinta"
      />
      <Botao type="submit" className="px-2 py-1 text-xs" carregando={indo}>
        Salvar
      </Botao>
      <button
        type="button"
        onClick={() => setEditando(false)}
        className="text-xs text-tinta-3 hover:text-tinta"
      >
        cancelar
      </button>
    </form>
  )
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

/**
 * O papel de alguém, com confirmação.
 *
 * Antes, a lista salvava ao trocar: um toque errado rolando a tela no celular
 * rebaixava a gerente e derrubava a sessão dela. Agora escolher só PREPARA a
 * troca; ela acontece no "Sim". E não há "Sem acesso" aqui: tirar o acesso é
 * o botão ao lado (que guarda o papel para devolver depois).
 */
function TrocaDePapel({
  slug,
  pessoa,
  papeis,
  aoTerminar,
}: {
  slug: string
  pessoa: PessoaNaTela
  papeis: string[]
  aoTerminar: (r: EstadoEquipe) => void
}) {
  const atual = pessoa.papel ?? ''
  const [escolhido, setEscolhido] = useState(atual)
  const [indo, comecar] = useTransition()
  const router = useRouter()
  // O papel atual entra na lista mesmo quando quem vê não pode concedê-lo —
  // senão a lista mostraria outro nome no lugar do papel que a pessoa tem.
  const opcoes = [
    ...(atual ? [] : [{ valor: '', titulo: 'Escolha o papel...' }]),
    ...(atual && !papeis.includes(atual) ? [{ valor: atual, titulo: ROTULO[atual] ?? atual }] : []),
    ...papeis.map((v) => ({ valor: v, titulo: ROTULO[v] ?? v })),
  ]
  const mudou = escolhido !== atual && escolhido !== ''

  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
      <Selecao
        rotulo=""
        id={`papel-${pessoa.id}`}
        aria-label={`Papel de ${pessoa.nome}`}
        value={escolhido}
        disabled={indo}
        onChange={(ev) => setEscolhido(ev.currentTarget.value)}
        opcoes={opcoes}
        className="py-1 text-xs"
      />
      {mudou && (
        <span role="group" aria-label="Confirmar a troca de papel" className="inline-flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-tinta-2">
            Mudar para {ROTULO[escolhido] ?? escolhido}? {pessoa.nome.split(' ')[0]} vai precisar entrar de novo.
          </span>
          <Botao
            tom="confirmar"
            className="px-2 py-1 text-xs"
            carregando={indo}
            autoFocus
            onClick={() =>
              comecar(async () => {
                const r = await trocarPapel(slug, pessoa.id, escolhido, pessoa.unidadeId)
                aoTerminar(r)
                if (r.erro) setEscolhido(atual)
                router.refresh()
              })
            }
          >
            Sim, mudar
          </Botao>
          <Botao tom="discreto" className="px-2 py-1 text-xs" disabled={indo} onClick={() => setEscolhido(atual)}>
            Não
          </Botao>
        </span>
      )}
    </span>
  )
}

export function Equipe({
  slug,
  pessoas,
  convites,
  unidades,
  papeisQuePosso,
  podeGerir,
  suportes,
  podeCortarSuporte,
}: {
  slug: string
  pessoas: PessoaNaTela[]
  convites: ConviteNaTela[]
  unidades: { id: string; nome: string }[]
  /** Só os papéis que ESTA pessoa pode conceder. */
  papeisQuePosso: string[]
  podeGerir: boolean
  /** O nosso suporte com acesso valendo — fora da lista da equipe. */
  suportes: SuporteNaTela[]
  /** Só a dona da empresa inteira corta o acesso do suporte. */
  podeCortarSuporte: boolean
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

  // Para o `Confirmar`: o recado de sucesso vai para o alto da tela; o erro
  // volta para o próprio botão, onde a pessoa está olhando.
  const confirmado = async (fn: () => Promise<EstadoEquipe>) => {
    const r = await fn()
    if (r.erro) return r
    setRecado(r)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      {recado?.erro && <Aviso nivel="critico">{recado.erro}</Aviso>}
      {recado?.ok && !recado.link && <Aviso nivel="bom">{recado.ok}</Aviso>}
      {/* O link de senha nova aparece UMA vez, como o do convite. */}
      {recado?.ok && recado.link && (
        <Aviso nivel="bom">
          <span className="flex flex-col gap-1.5">
            <span>{recado.ok}</span>
            <code className="block overflow-x-auto rounded bg-superficie px-2 py-1.5 font-mono text-xs break-all text-tinta">
              {recado.link}
            </code>
            <span className="text-xs">
              Copie agora: ele não aparece de novo. Vale por 24 horas e serve uma vez; gerar outro apaga este.
            </span>
          </span>
        </Aviso>
      )}

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
                <Telefone slug={slug} pessoa={p} pode={p.podeTelefone} aoSalvar={setRecado} />
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

                {p.podeMexer && (
                  <>
                    <TrocaDePapel slug={slug} pessoa={p} papeis={papeisQuePosso} aoTerminar={setRecado} />
                    {p.ativo ? (
                      <Confirmar
                        tom="secundario"
                        className="px-2 py-1 text-xs"
                        pergunta={`Tirar o acesso de ${p.nome}? Sai do sistema na próxima tela.`}
                        sim="Sim, tirar"
                        aoConfirmar={() => confirmado(() => trocarSituacao(slug, p.id, false))}
                      >
                        Tirar acesso
                      </Confirmar>
                    ) : (
                      <Botao
                        tom="confirmar"
                        className="px-2 py-1 text-xs"
                        carregando={indo}
                        onClick={() => fazer(() => trocarSituacao(slug, p.id, true))}
                      >
                        Devolver
                      </Botao>
                    )}
                    {p.ativo && (
                      <Botao
                        tom="discreto"
                        className="px-2 py-1 text-xs"
                        carregando={indo}
                        title="Um link para esta pessoa escolher uma senha nova. Aparece uma vez."
                        onClick={() => fazer(() => gerarLinkSenha(slug, p.id))}
                      >
                        Gerar link de senha
                      </Botao>
                    )}
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

      {/* ── o nosso suporte ── */}
      {suportes.length > 0 && (
        <Cartao titulo="Suporte do Norte">
          <ul className="flex flex-col">
            {suportes.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-borda-suave py-3 last:border-0"
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-semibold text-tinta">
                    Suporte do Norte{s.ate ? `, até ${s.ate}` : ''}
                  </span>
                  <span className="text-xs text-tinta-3">
                    {s.nome} · motivo: {s.motivo?.trim() || 'não informado'}
                  </span>
                </span>
                {podeCortarSuporte && (
                  <Confirmar
                    tom="secundario"
                    className="px-2 py-1 text-xs"
                    pergunta="Cortar agora o acesso do suporte?"
                    sim="Sim, cortar"
                    aoConfirmar={() => confirmado(() => cortarSuporte(slug, s.id))}
                  >
                    Cortar acesso do suporte
                  </Confirmar>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-tinta-3">
            É a nossa equipe, olhando o sistema para resolver o que você pediu. Só lê, não ocupa vaga e tudo
            o que abre fica na tela Auditoria. O acesso vence sozinho no prazo; cortar antes é com você.
          </p>
        </Cartao>
      )}

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
        <Cartao
          titulo={convites.length === 1 ? 'Convite esperando' : 'Convites esperando'}
          acao={<span className="text-xs text-tinta-3">{convites.length}</span>}
        >
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
                    <Confirmar
                      tom="secundario"
                      className="px-2 py-1 text-xs"
                      pergunta="Cancelar este convite? O link para de valer."
                      sim="Sim, cancelar"
                      aoConfirmar={() => confirmado(() => revogar(slug, c.id))}
                    >
                      Cancelar
                    </Confirmar>
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
