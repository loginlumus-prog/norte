import { cookies } from 'next/headers'
import Link from 'next/link'
import { exigirEntrada } from '@/servidor/pagina'
import { escolherUnidade } from '@/servidor/unidade'
import { pode } from '@/servidor/permissao'
import { planoDaEmpresa } from '@/servidor/relatorios'
import { liberado } from '@/servidor/planos'
import {
  CORES_DE_QUADRO,
  GRUPOS_PADRAO,
  MODELOS,
  NIVEL_SITUACAO,
  ROTULO_SITUACAO,
  SITUACOES,
  atrasada,
  cabeNoPlano,
  chaveDoDia,
  iniciais,
  listarQuadros,
  minhasPendencias,
  pessoasParaAtribuir,
  podeMexerNaTarefa,
  quadroCompleto,
  resumir,
  tarefasDaRede,
  type ChaveModelo,
} from '@/servidor/tarefas'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Aviso, Vazio } from '@/ui/base'
import { Trancado } from '@/ui/Cadeado'
import { Secao, Tira } from '@/ui/painel'
import type { Tema } from '@/ui/TrocaTema'
import { Cabecalho } from './Cabecalho'
import { NovoQuadro, type ModeloNaTela } from './NovoQuadro'
import { LojaALoja, AMOSTRA_DA_REDE } from './LojaALoja'
import { Quadro, type QuadroNaTela, type SituacaoNaTela } from './Quadro'

// Os componentes de cliente recebem isto como DADO, e não importam do módulo
// de tarefas: ele fala com o banco, e valor importado dele levaria o driver
// do Postgres para o navegador.
const SITUACOES_NA_TELA: SituacaoNaTela[] = SITUACOES.map((s) => ({
  chave: s,
  rotulo: ROTULO_SITUACAO[s],
  nivel: NIVEL_SITUACAO[s],
}))

const MODELOS_NA_TELA: ModeloNaTela[] = (Object.keys(MODELOS) as ChaveModelo[]).map((chave) => ({
  chave,
  titulo: MODELOS[chave].titulo,
  descricao: MODELOS[chave].descricao,
  cor: MODELOS[chave].cor,
  grupos: MODELOS[chave].grupos.length,
  tarefas: MODELOS[chave].tarefas.map((t) => t.titulo),
}))

// O quadro da equipe.
//
// A tela que a loja abre todo dia, e por isso a mais barata de aprender:
// um quadro, grupos, linhas. O que muda de um plano para outro não é a
// tela — é quanto dela está aberto. O Grátis vê as colunas de responsável e
// prazo com cadeado; o Balcão as usa; o Assistente ganha a linha do tempo e
// os modelos; a Direção enxerga a rede inteira, loja a loja. Ver `planos.ts`.
//
// Tudo que é filtro mora no endereço: `?quadro=`, `?unidade=`, `?minhas=1`,
// `?novo=1`. O link é a tela inteira.

export default async function TelaTarefas({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ quadro?: string; unidade?: string; minhas?: string; novo?: string }>
}) {
  const { empresa: slug } = await params
  const { quadro: quadroPedido, unidade: unidadePedida, minhas: minhasPedido, novo } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'tarefa.ver' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const podeGerir = pode(sessao, 'tarefa.gerir')
  const minhas = minhasPedido === '1'
  const hoje = new Date()

  // Uma consulta de cada vez: cada uma abre a própria transação, e a regra
  // da casa é não paralelizar o que fala com o banco.
  const onde = await escolherUnidade(sessao, empresa, unidadePedida, 'tarefa.ver')
  const plano = await planoDaEmpresa(sessao)
  const quadros = await listarQuadros(sessao, onde.ids)
  const pendencias = await minhasPendencias(sessao)

  const escolhido = quadros.find((q) => q.id === quadroPedido) ?? quadros[0] ?? null
  const completo = escolhido && novo !== '1' ? await quadroCompleto(sessao, escolhido.id) : null

  const lib = {
    responsavel: liberado(plano, 'tarefas.responsavel'),
    prazo: liberado(plano, 'tarefas.prazo'),
    prioridade: liberado(plano, 'tarefas.prioridade'),
    linhaDoTempo: liberado(plano, 'tarefas.linhaDoTempo'),
  }

  // Quem gere e tem o responsável aberto precisa da lista de gente para
  // atribuir. Fora disso, a lista nem é lida.
  const pessoas = (completo && podeGerir && lib.responsavel ? await pessoasParaAtribuir(sessao, completo.unidadeId) : []).map(
    (p) => ({ ...p, iniciais: iniciais(p.nome) }),
  )

  // O teto do plano, contado sobre a empresa inteira — é assim que o
  // servidor conta na hora de gravar, e a tela precisa concordar com ele.
  const abertasNaEmpresa = quadros.reduce((s, q) => s + q.abertas, 0)
  const cabeQuadro = cabeNoPlano(plano, { quadros: quadros.length, abertas: abertasNaEmpresa }, 'quadro')
  const cabeTarefa = cabeNoPlano(plano, { quadros: quadros.length, abertas: abertasNaEmpresa }, 'tarefa')

  // A rede: só quando a pessoa está olhando TODAS as lojas e há mais de uma.
  const verRede = onde.unidadeId === null && onde.opcoes.length > 1
  const redeAberta = liberado(plano, 'tarefas.rede')
  const rede = verRede && redeAberta ? await tarefasDaRede(sessao, onde.ids) : []

  // Só o que é dela, se pediu. A tira conta o que está na tela.
  const tarefasVisiveis = completo
    ? completo.tarefas.filter((t) => !minhas || t.responsavelId === sessao.usuarioId)
    : []
  const resumo = resumir(tarefasVisiveis, hoje)

  const naTela: QuadroNaTela | null = completo
    ? {
        id: completo.id,
        nome: completo.nome,
        descricao: completo.descricao,
        cor: completo.cor,
        unidadeId: completo.unidadeId,
        unidadeNome: completo.unidadeNome,
        grupos: completo.grupos,
        tarefas: tarefasVisiveis.map((t) => ({
          id: t.id,
          grupo: t.grupo,
          titulo: t.titulo,
          descricao: t.descricao,
          responsavelId: t.responsavelId,
          responsavelNome: t.responsavelNome,
          responsavelIniciais: t.responsavelNome ? iniciais(t.responsavelNome) : null,
          situacao: t.situacao,
          prioridade: t.prioridade,
          progresso: t.progresso,
          inicio: t.inicio ? chaveDoDia(t.inicio) : null,
          prazo: t.prazo ? chaveDoDia(t.prazo) : null,
          atrasada: atrasada(t.prazo, t.situacao, hoje),
          podeMexer: podeMexerNaTarefa(sessao, t, completo.unidadeId),
        })),
      }
    : null

  // A bolinha do menu: vermelha com o número de vencidas quando há alguma;
  // senão, a contagem discreta do que é meu e está em aberto.
  const menu = MENU(slug).map((i) =>
    i.href !== `/${slug}/tarefas`
      ? i
      : pendencias.atrasadas > 0
        ? { ...i, aviso: { quantos: pendencias.atrasadas, nivel: 'critico' as const, titulo: 'suas atrasadas' } }
        : pendencias.abertas > 0
          ? { ...i, contagem: pendencias.abertas }
          : i,
  )

  const semQuadro = quadros.length === 0
  const mostrarNovo = podeGerir && (novo === '1' || semQuadro)

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={menu}
      ativo={`/${slug}/tarefas`}
      tema={tema}
      titulo={onde.mostrarSeletor ? `Tarefas · ${onde.titulo}` : 'Tarefas'}
      acao={
        <Cabecalho
          quadros={quadros.map((q) => ({ id: q.id, nome: q.nome, cor: q.cor, abertas: q.abertas }))}
          atual={naTela?.id ?? null}
          unidades={onde.opcoes}
          unidadeAtual={onde.unidadeId}
          mostrarSeletor={onde.mostrarSeletor}
          minhas={minhas}
          podeGerir={podeGerir}
          novoTitulo={cabeQuadro.pode ? undefined : cabeQuadro.motivo}
        />
      }
    >
      {naTela && (
        <Tira
          itens={[
            { rotulo: 'a fazer', quantos: resumo.aFazer, nivel: 'neutro' },
            { rotulo: 'em andamento', quantos: resumo.emAndamento, nivel: 'atencao' },
            { rotulo: resumo.paradas === 1 ? 'parada' : 'paradas', quantos: resumo.paradas, nivel: 'critico' },
            { rotulo: resumo.feitas === 1 ? 'feita' : 'feitas', quantos: resumo.feitas, nivel: 'bom' },
            { rotulo: resumo.atrasadas === 1 ? 'atrasada' : 'atrasadas', quantos: resumo.atrasadas, nivel: 'critico' },
          ]}
        />
      )}

      {mostrarNovo && (
        <Secao
          titulo={semQuadro ? 'Crie o primeiro quadro' : 'Novo quadro'}
          resumo={semQuadro ? 'O quadro é a parede do estoque com a lista da equipe: o que abrir, conferir, montar — quem faz e até quando.' : undefined}
          acao={
            semQuadro ? undefined : (
              <Link href={`/${slug}/tarefas${naTela ? `?quadro=${naTela.id}` : ''}`} className="text-sm text-tinta-2 hover:text-tinta hover:underline">
                Voltar ao quadro
              </Link>
            )
          }
        >
          <NovoQuadro
            slug={slug}
            plano={plano}
            unidades={onde.opcoes}
            unidadeAtual={onde.unidadeId}
            cabe={cabeQuadro}
            primeiro={semQuadro}
            cores={CORES_DE_QUADRO}
            gruposPadrao={GRUPOS_PADRAO}
            modelos={MODELOS_NA_TELA}
          />
        </Secao>
      )}

      {semQuadro && !podeGerir && (
        <Vazio>
          Ainda não há quadro de tarefas. Quem gere a equipe cria o primeiro — peça para a gerente ou para o dono.
        </Vazio>
      )}

      {naTela && (
        <>
          {minhas && naTela.tarefas.length === 0 && (
            <Aviso nivel="neutro">Nenhuma tarefa sua neste quadro. Clique em “Minhas tarefas” de novo para ver todas.</Aviso>
          )}
          <Quadro slug={slug} quadro={naTela} podeGerir={podeGerir} liberacoes={lib} pessoas={pessoas} situacoes={SITUACOES_NA_TELA} teto={cabeTarefa} />
        </>
      )}

      {!naTela && !semQuadro && novo !== '1' && (
        <Vazio>Este quadro não está entre os que você vê. Escolha outro em cima.</Vazio>
      )}

      {verRede && (
        <Secao
          titulo="Loja a loja"
          resumo="Cada loja com o que tem a fazer, o que venceu e o que fez no mês — sem trocar de loja para descobrir qual está deixando a lista acumular."
        >
          <Trancado chave="tarefas.rede" plano={plano} slug={slug} resumo="Todas as lojas numa olhada, com as tarefas vencidas de cada uma pelo nome.">
            <LojaALoja lojas={redeAberta ? rede : AMOSTRA_DA_REDE} slug={slug} />
          </Trancado>
        </Secao>
      )}
    </Estrutura>
  )
}
