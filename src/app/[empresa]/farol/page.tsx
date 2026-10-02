import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { exigirEntrada } from '@/servidor/pagina'
import { comoOrg } from '@/servidor/banco'
import { moduloLigado } from '@/servidor/modulos'
import { listarMarcas, listarPecas, TIPOS, garantirCreditoDoFarol } from '@/servidor/farol'
import { PRECOS } from '@/servidor/planos'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'
import { Farol, type MarcaNaTela, type PecaNaTela } from './Farol'

export const metadata: Metadata = { title: 'Farol' }

// O Farol: o direcionamento digital, por marca. A tela tem três partes, na
// ordem em que se usa: a marca (o que a IA precisa saber), o "pedir" (o que
// escrever agora) e o conteúdo (o que já foi escrito, para editar, aprovar e
// marcar como publicado).

export default async function TelaFarol({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ marca?: string }>
}) {
  const { empresa: slug } = await params
  const { marca: pedida } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'agente.configurar' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const estrutura = (filhos: React.ReactNode) => (
    <Estrutura empresa={empresa} sessao={sessao} itens={MENU(slug)} ativo={`/${slug}/farol`} tema={tema} titulo="Farol">
      {filhos}
    </Estrutura>
  )

  if (!moduloLigado(empresa, 'farol')) {
    return estrutura(
      <Cartao caixa>
        <div className="flex max-w-2xl flex-col gap-2">
          <p className="text-base font-semibold text-tinta">O Farol ainda não está contratado.</p>
          <p className="text-sm text-tinta-2">
            É o direcionamento digital da sua marca: diagnóstico do nicho, calendário do mês, roteiros de Reels, carrosséis,
            legendas, comentários para você fazer, anúncios e campanhas no WhatsApp — escritos com IA, a partir do que a sua loja
            vende de verdade. R$ {PRECOS.farolMarca} por mês a primeira marca (perfil), R$ {PRECOS.farolMarcaExtra} cada marca a
            mais, com R$ {PRECOS.creditoDoFarol} de crédito de IA por marca todo mês.
          </p>
          <p className="text-sm text-tinta-2">Para contratar, fale com a gente pelo WhatsApp do Norte.</p>
        </div>
      </Cartao>,
    )
  }

  await garantirCreditoDoFarol(sessao.orgId)
  const [marcas, org, lojas] = await Promise.all([
    listarMarcas(sessao),
    comoOrg(sessao.orgId, (db) => db.org.findUniqueOrThrow({ where: { id: sessao.orgId }, select: { creditoIaCent: true } })),
    comoOrg(sessao.orgId, (db) => db.unidade.findMany({ where: { ativa: true, ehDeposito: false }, orderBy: { nome: 'asc' }, select: { id: true, nome: true } })),
  ])
  const atual = marcas.find((m) => m.id === pedida) ?? marcas[0] ?? null
  const pecas = atual ? await listarPecas(sessao, atual.id) : []

  const marcasNaTela: MarcaNaTela[] = marcas.map((m) => ({
    id: m.id, nome: m.nome, nicho: m.nicho, cidade: m.cidade, instagram: m.instagram, tiktok: m.tiktok,
    publico: m.publico, tom: m.tom, diferenciais: m.diferenciais, objetivos: m.objetivos, unidadeIds: m.unidadeIds,
  }))
  const pecasNaTela: PecaNaTela[] = pecas.map((p) => ({
    id: p.id, tipo: p.tipo, titulo: p.titulo, pedido: p.pedido, conteudo: p.conteudo, situacao: p.situacao,
    para: p.para ? p.para.toISOString().slice(0, 10) : null, custoCent: p.custoCent, quem: p.quem,
    criadaEm: new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(p.criadaEm),
  }))

  return estrutura(
    <Farol
      slug={slug}
      marcas={marcasNaTela}
      atualId={atual?.id ?? null}
      pecas={pecasNaTela}
      lojas={lojas}
      tipos={Object.entries(TIPOS).map(([chave, t]) => ({ chave, titulo: t.titulo, resumo: t.resumo }))}
      creditoCent={org.creditoIaCent}
    />,
  )
}
