import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { escolherUnidade } from '@/servidor/unidade'
import { caixaAberto, conferirCaixa } from '@/servidor/caixa'
import { pode } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Aviso, Situacao } from '@/ui/base'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import type { Tema } from '@/ui/TrocaTema'
import { Balcao } from './Balcao'
import { comoOrg } from '@/servidor/banco'
import { programaDe, DESLIGADO } from '@/servidor/pontos'
import { AbrirCaixa, FecharCaixa, Movimento } from './Caixa'

export default async function BalcaoPagina({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string; caixa?: string }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida, caixa: aba } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  // Vender é sempre EM uma loja — não existe venda "consolidada". Por isso
  // aqui o seletor nunca cai em "todas": pega a primeira que a pessoa alcança.
  const onde = await escolherUnidade(sessao, empresa, pedida, 'venda.criar')
  const unidadeId = onde.unidadeId ?? onde.opcoes[0]?.id ?? null
  const unidadeNome = onde.opcoes.find((u) => u.id === unidadeId)?.nome ?? ''

  // O programa de pontos vem do servidor junto com a tela. A conta de quanto
  // a pessoa pode abater roda no navegador, para responder no ato — mas ela é
  // refeita no servidor na hora de fechar, porque o que vem do navegador é
  // pedido, nunca ordem.
  const conf = await comoOrg(sessao.orgId, (db) =>
    db.org.findUnique({
      where: { id: sessao.orgId },
      select: { pontosAtivo: true, pontosPorReal: true, pontoVale: true, pontosMinimo: true },
    }),
  )
  const programa = conf ? programaDe(conf) : DESLIGADO

  const caixa = unidadeId ? await caixaAberto(sessao, unidadeId) : null
  const conferencia = caixa ? await conferirCaixa(sessao, caixa.id) : null

  const podeOperarCaixa = unidadeId ? pode(sessao, 'caixa.operar', unidadeId) : false

  const hora = (d: Date) =>
    new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(d)

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/balcao`}
      tema={tema}
      titulo={aba === 'fechar' ? 'Fechar o caixa' : 'Balcão'}
      acao={
        <span className="flex items-center gap-2">
          {caixa && (
            <Situacao nivel="bom">
              caixa aberto {hora(caixa.abertoEm)} · {caixa.abertoPor}
            </Situacao>
          )}
          {onde.mostrarSeletor && (
            <SeletorUnidade opcoes={onde.opcoes} atual={unidadeId} />
          )}
        </span>
      }
    >
      {!unidadeId ? (
        <Aviso nivel="atencao">
          Você não tem acesso de venda em nenhuma unidade. Peça para quem responde pela
          empresa liberar.
        </Aviso>
      ) : !caixa ? (
        podeOperarCaixa ? (
          <AbrirCaixa slug={slug} unidadeId={unidadeId} unidadeNome={unidadeNome} />
        ) : (
          <Aviso nivel="atencao">
            O caixa desta loja está fechado, e só quem opera o caixa pode abrir. Chame o
            gerente.
          </Aviso>
        )
      ) : aba === 'fechar' ? (
        <div className="flex flex-col gap-4">
          <FecharCaixa slug={slug} caixaId={caixa.id} conferencia={conferencia!} />
          <Movimento slug={slug} caixaId={caixa.id} />
        </div>
      ) : (
        <>
          <Balcao
            slug={slug}
            unidadeId={unidadeId}
            usuarioId={sessao.usuarioId}
            caixaId={caixa.id}
            unidadeNome={unidadeNome}
            programa={programa}
          />
          <p className="text-xs text-tinta-3">
            <a
              href={`/${slug}/balcao?caixa=fechar${unidadeId ? `&unidade=${unidadeId}` : ''}`}
              className="font-medium text-marca underline underline-offset-2"
            >
              Fechar o caixa
            </a>{' '}
            — {conferencia?.vendas ?? 0} venda(s) no turno.
          </p>
        </>
      )}
    </Estrutura>
  )
}
