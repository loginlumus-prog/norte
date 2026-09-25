import { cookies } from 'next/headers'
import Link from 'next/link'
import { exigirEntrada } from '@/servidor/pagina'
import { pode } from '@/servidor/permissao'
import { comoOrg } from '@/servidor/banco'
import { lerOrgParaCampanha, porQueNao } from '@/servidor/campanhas/acesso'
import { caminhoDaMidia } from '@/servidor/campanhas/midia'
import { modelosDaLoja } from '@/servidor/assistente/meta-conexao'
import { MOTIVO_RECUSA } from '@/servidor/assistente/meta-regras'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Aviso, Cartao, Situacao, Vazio } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'
import { NovoModelo, ApagarModelo } from './Modelos'

// Campanhas › Modelos: as mensagens pré-aprovadas pela Meta.
//
// Só existem no WhatsApp OFICIAL. Lá, a loja só escreve livremente para quem
// mandou mensagem nas últimas 24 horas; depois disso, só com um modelo que a
// Meta aprovou antes (o texto fixo, com lacunas {{1}}, {{2}} para o nome, o
// cupom...). É aqui que a loja cria, acompanha a aprovação e apaga — e é daqui
// que o bloco de mensagem da campanha escolhe o modelo "fora da janela".
//
// A lista é lida ao vivo da conta da loja na Meta (nada guardado aqui): o que
// a tela mostra é o que a Meta diz agora, inclusive o motivo de uma recusa.
//
// Mesma régua das campanhas: `agente.configurar`, o plano que abre campanhas e
// o módulo do agente ligado — conferidos de novo em cada ação.

const SITUACAO: Record<string, { nivel: 'bom' | 'atencao' | 'critico' | 'neutro'; texto: string }> = {
  APPROVED: { nivel: 'bom', texto: 'Aprovado' },
  PENDING: { nivel: 'atencao', texto: 'Em análise' },
  IN_APPEAL: { nivel: 'atencao', texto: 'Em recurso' },
  REJECTED: { nivel: 'critico', texto: 'Recusado' },
  PAUSED: { nivel: 'atencao', texto: 'Pausado pela Meta' },
  DISABLED: { nivel: 'critico', texto: 'Desativado' },
}

const CATEGORIA: Record<string, string> = { MARKETING: 'Marketing', UTILITY: 'Utilidade', AUTHENTICATION: 'Autenticação' }

export default async function Modelos({ params }: { params: Promise<{ empresa: string }> }) {
  const { empresa: slug } = await params
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'agente.configurar' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema
  const base = {
    empresa,
    sessao,
    itens: MENU(slug),
    ativo: `/${slug}/campanhas`,
    tema,
    titulo: 'Modelos de mensagem',
    acao: (
      <Link href={`/${slug}/campanhas`} className="text-sm font-medium text-tinta-2 hover:text-tinta">
        ← Campanhas
      </Link>
    ),
  }

  const bloqueio = porQueNao(await lerOrgParaCampanha(sessao.orgId))
  if (bloqueio) {
    return (
      <Estrutura {...base}>
        <Aviso nivel="atencao">{bloqueio}</Aviso>
      </Estrutura>
    )
  }

  const lista = await modelosDaLoja(sessao, { tentativas: 2, prazoMs: 8_000 })
  const imagens =
    lista.situacao === 'ok'
      ? (
          await comoOrg(sessao.orgId, (db) =>
            db.midia.findMany({
              where: { tipo: 'imagem', mime: { in: ['image/jpeg', 'image/png'] } },
              orderBy: { criadaEm: 'desc' },
              take: 30,
              select: { id: true, nome: true },
            }),
          )
        ).map((m) => ({ ...m, previa: caminhoDaMidia(sessao.orgId, m.id) }))
      : []

  return (
    <Estrutura {...base}>
      <p className="max-w-3xl text-sm text-tinta-2">
        No WhatsApp oficial, a loja só escreve livremente para quem mandou mensagem nas <b className="text-tinta">últimas 24 horas</b>.
        Depois disso, só sai <b className="text-tinta">modelo aprovado pela Meta</b>: um texto fixo com lacunas ({'{{1}}'}, {'{{2}}'}) para o
        nome, o cupom, a data. A aprovação costuma levar minutos (até 24 horas). A Meta cobra cada modelo entregue direto na conta
        da loja — marketing sempre; utilidade só fora da janela.
      </p>

      {lista.situacao === 'indisponivel' && (
        <Cartao titulo="Só no WhatsApp oficial">
          <div className="flex flex-col gap-2 text-sm text-tinta-2">
            <p>{lista.recado}</p>
            <p>
              Modelos só existem na conexão oficial da Meta. Pelo QR Code e pelo Z-API não há janela de 24 horas nem modelo — a
              campanha manda o texto direto.{' '}
              {pode(sessao, 'agente.configurar') && (
                <Link href={`/${slug}/agente`} className="font-medium text-marca underline-offset-2 hover:underline">
                  Ver a conexão do WhatsApp
                </Link>
              )}
            </p>
          </div>
        </Cartao>
      )}

      {lista.situacao === 'erro' && <Aviso nivel="critico">Não deu para ler os modelos na Meta agora. {lista.recado}</Aviso>}

      {lista.situacao === 'ok' && (
        <>
          <Cartao titulo="Novo modelo" caixa>
            <NovoModelo slug={slug} imagens={imagens} />
          </Cartao>

          <Cartao titulo={`Modelos na conta (${lista.modelos.length})`}>
            {lista.modelos.length === 0 ? (
              <Vazio>Nenhum modelo ainda. Crie o primeiro acima — por exemplo, um convite para voltar à loja com o nome da pessoa.</Vazio>
            ) : (
              <ul className="flex flex-col divide-y divide-borda rounded-norte border border-borda bg-superficie">
                {lista.modelos.map((m) => {
                  const s = SITUACAO[m.status] ?? { nivel: 'neutro' as const, texto: m.status }
                  const doNorte = m.nome.startsWith('norte_')
                  return (
                    <li key={`${m.nome}|${m.idioma}|${m.id}`} className="flex flex-col gap-2 p-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="flex min-w-0 flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-tinta">{m.nome}</span>
                          <Situacao nivel={s.nivel}>{s.texto}</Situacao>
                          <span className="text-xs text-tinta-3">
                            {CATEGORIA[m.categoria] ?? m.categoria} · {m.idioma}
                            {m.variaveis ? ` · ${m.variaveis} variável(is)` : ''}
                          </span>
                          {doNorte && <span className="rounded-full bg-superficie-2 px-2 py-0.5 text-xs text-tinta-2">aviso automático do Norte</span>}
                        </div>
                        {m.cabecalho && <p className="text-xs font-semibold text-tinta-2">{m.cabecalho}</p>}
                        <p className="max-w-2xl text-sm whitespace-pre-wrap text-tinta-2">{m.corpo}</p>
                        {m.botoes.length > 0 && <p className="text-xs text-tinta-3">Botões: {m.botoes.join(' · ')}</p>}
                        {m.status === 'REJECTED' && (
                          <p className="text-xs font-medium text-critico">
                            Motivo da Meta: {m.motivo ? (MOTIVO_RECUSA[m.motivo] ?? m.motivo) : 'não informado'}. Ajuste o texto e crie de
                            novo com outro nome.
                          </p>
                        )}
                      </div>
                      {!doNorte && <ApagarModelo slug={slug} nome={m.nome} />}
                    </li>
                  )
                })}
              </ul>
            )}
          </Cartao>
        </>
      )}
    </Estrutura>
  )
}
