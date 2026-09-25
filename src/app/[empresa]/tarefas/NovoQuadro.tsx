'use client'

// Criar um quadro: do zero, com nome e grupos, ou a partir de um modelo.
//
// Os modelos vêm ANTES do formulário quando a pessoa ainda não tem quadro
// nenhum. Quadro vazio pede que ela imagine o que vai nele; a lista de
// abertura da loja diz "é isto" e ela só clica. Quando o plano não abre
// modelos, eles aparecem do mesmo jeito — trancados, com o nome do plano —
// porque é a melhor propaganda que o Assistente pode ter.
//
// Cores, grupos padrão e o resumo dos modelos chegam da página como DADO:
// este arquivo roda no navegador, e o módulo de tarefas fala com o banco.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Plano } from '@prisma/client'
import { Aviso, Botao, Campo, Selecao, cx } from '@/ui/base'
import { Trancado } from '@/ui/Cadeado'
import { liberado } from '@/servidor/planos'
import type { Veredito } from '@/servidor/tarefas'
import type { UnidadeVisivel } from '@/servidor/unidade'
import { criarDeModeloAcao, criarQuadroAcao, type Resultado } from './acoes'

export type ModeloNaTela = {
  chave: string
  titulo: string
  descricao: string
  cor: string
  grupos: number
  /** Os títulos das tarefas, na ordem. */
  tarefas: string[]
}

export function NovoQuadro({
  slug,
  plano,
  unidades,
  unidadeAtual,
  cabe,
  primeiro,
  cores,
  gruposPadrao,
  modelos,
  verPlanos = true,
}: {
  slug: string
  /** Quem olha abre os planos? Sem isso, o trancado diz quem troca de plano. */
  verPlanos?: boolean
  plano: Plano
  unidades: UnidadeVisivel[]
  unidadeAtual: string | null
  /** Cabe mais um quadro no plano? Se não, o formulário explica e não envia. */
  cabe: Veredito
  /** Ainda não há quadro nenhum: os modelos ganham destaque. */
  primeiro: boolean
  cores: { hex: string; nome: string }[]
  gruposPadrao: string[]
  modelos: ModeloNaTela[]
}) {
  const router = useRouter()
  const [indo, comecar] = useTransition()
  const [recado, setRecado] = useState<Resultado | null>(null)
  const [cor, setCor] = useState<string>(cores[0]?.hex ?? '')
  const [grupos, setGrupos] = useState(gruposPadrao.join(', '))

  const varios = liberado(plano, 'tarefas.varios')
  const temModelos = liberado(plano, 'tarefas.modelos')

  const abrir = (r: Resultado) => {
    setRecado(r)
    if (r.id) router.push(`/${slug}/tarefas?quadro=${r.id}`)
  }

  const cartoes = (
    <div className="grid gap-2 sm:grid-cols-2">
      {modelos.map((m) => (
        <div key={m.chave} className="flex flex-col gap-2 rounded-norte border border-borda bg-superficie p-3 border-l-[3px]" style={{ borderLeftColor: m.cor }}>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-bold text-tinta">{m.titulo}</span>
            <span className="text-xs text-tinta-2">{m.descricao}</span>
          </div>
          <ul className="flex flex-col gap-0.5 text-xs text-tinta-2">
            {m.tarefas.slice(0, 3).map((t) => (
              <li key={t} className="flex items-center gap-1.5">
                <span aria-hidden className="size-1 rounded-full bg-tinta-3" />
                {t}
              </li>
            ))}
            {m.tarefas.length > 3 && <li className="text-tinta-3">e mais {m.tarefas.length - 3}…</li>}
          </ul>
          <span className="mt-auto flex items-center justify-between gap-2 text-xs text-tinta-3">
            <span className="numero">
              {m.grupos} grupos · {m.tarefas.length} tarefas
            </span>
            <Botao
              tom="secundario"
              className="py-1 text-xs"
              disabled={!temModelos || !cabe.pode}
              title={!temModelos ? 'Modelos são do Assistente para cima' : !cabe.pode ? cabe.motivo : `Cria "${m.titulo}" com as tarefas prontas`}
              carregando={indo}
              onClick={() => comecar(async () => abrir(await criarDeModeloAcao(slug, m.chave, varios ? unidadeAtual : null)))}
            >
              Usar este
            </Botao>
          </span>
        </div>
      ))}
    </div>
  )

  const modelosTrancados = (resumo: string) => (
    <Trancado chave="tarefas.modelos" plano={plano} slug={slug} resumo={resumo} verPlanos={verPlanos}>
      {cartoes}
    </Trancado>
  )

  return (
    <div className="flex flex-col gap-5">
      {recado?.erro && <Aviso nivel="critico">{recado.erro}</Aviso>}
      {!cabe.pode && <Aviso nivel="atencao">{cabe.motivo}</Aviso>}

      {primeiro && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-bold text-tinta">Começar de um modelo</h3>
          {modelosTrancados('Quatro quadros prontos, com as tarefas de loja de verdade: abertura e fechamento, inventário, campanha, chegada de mercadoria.')}
        </section>
      )}

      <form
        className="flex flex-col gap-3 rounded-norte border border-borda bg-superficie p-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (!cabe.pode) return
          const form = new FormData(e.currentTarget)
          form.set('cor', cor)
          form.set('grupos', grupos)
          comecar(async () => abrir(await criarQuadroAcao(slug, form)))
        }}
      >
        <h3 className="text-sm font-bold text-tinta">{primeiro ? 'Ou criar do zero' : 'Novo quadro'}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo rotulo="Nome" name="nome" required maxLength={80} placeholder="Abertura da loja, Semana, Campanha de Natal…" disabled={!cabe.pode} />
          <Selecao
            rotulo="Loja"
            name="unidadeId"
            defaultValue={varios ? (unidadeAtual ?? '') : ''}
            disabled={!varios || !cabe.pode}
            dica={varios ? 'Quadro de uma loja só aparece para quem tem acesso a ela.' : 'Quadro por loja é do Balcão para cima. Este vale para a empresa inteira.'}
            opcoes={[{ valor: '', titulo: 'Empresa inteira' }, ...unidades.map((u) => ({ valor: u.id, titulo: u.nome }))]}
          />
        </div>
        <Campo rotulo="Descrição" name="descricao" maxLength={200} placeholder="Para que serve este quadro (opcional)" disabled={!cabe.pode} />
        <Campo
          rotulo="Grupos"
          name="grupos-visivel"
          value={grupos}
          onChange={(e) => setGrupos(e.target.value)}
          dica="Separados por vírgula, na ordem em que aparecem. Dá para mudar depois."
          disabled={!cabe.pode}
        />
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-sm font-medium text-tinta">Cor</legend>
          <div className="flex flex-wrap gap-1.5">
            {cores.map((c) => (
              <button
                key={c.hex}
                type="button"
                aria-label={c.nome}
                aria-pressed={cor === c.hex}
                title={c.nome}
                disabled={!cabe.pode}
                onClick={() => setCor(c.hex)}
                className={cx('grid size-7 place-items-center rounded-full border-2 text-xs font-bold text-white', cor === c.hex ? 'border-tinta' : 'border-transparent')}
                style={{ background: c.hex }}
              >
                {cor === c.hex ? '✓' : ''}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Botao type="submit" carregando={indo} disabled={!cabe.pode} title={cabe.pode ? undefined : cabe.motivo}>
            Criar quadro
          </Botao>
          {recado?.ok && <span className="text-sm font-medium text-bom">{recado.ok}</span>}
        </div>
      </form>

      {!primeiro && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-bold text-tinta">Ou começar de um modelo</h3>
          {modelosTrancados('Quatro quadros prontos, com as tarefas de loja de verdade.')}
        </section>
      )}
    </div>
  )
}
