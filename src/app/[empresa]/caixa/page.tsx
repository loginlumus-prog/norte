import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { pode } from '@/servidor/permissao'
import { escolherUnidade } from '@/servidor/unidade'
import { janela, lerPeriodo } from '@/servidor/periodo'
import { listarCaixas, movimentosDoCaixa, type TurnoDeCaixa } from '@/servidor/caixa'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Tabela } from '@/ui/Tabela'
import { SeletorUnidade } from '@/ui/SeletorUnidade'
import { SeletorPeriodo } from '@/ui/Periodo'
import { Numero, Secao, Tira, brl } from '@/ui/painel'
import { Aviso, Cartao, Situacao, cx } from '@/ui/base'
import type { Tema } from '@/ui/TrocaTema'

// Os turnos do caixa.
//
// A tela responde uma pergunta que antes não tinha resposta: "quanto faltou,
// em qual turno, com quem no caixa?". O fechamento já gravava tudo isso;
// gravava e ninguém via. Aqui o turno aberto vem primeiro, com a hora — e
// fica âmbar quando passou de um dia, porque caixa aberto desde ontem é
// caixa que ninguém conferiu.

const quando = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(d)

const hora = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(d)

export default async function CaixaPagina({
  params,
  searchParams,
}: {
  params: Promise<{ empresa: string }>
  searchParams: Promise<{ unidade?: string; periodo?: string; turno?: string }>
}) {
  const { empresa: slug } = await params
  const { unidade: pedida, periodo: pedido, turno } = await searchParams
  const { empresa, sessao } = await exigirEntrada(slug)
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  if (!pode(sessao, 'caixa.ver')) notFound()

  const onde = await escolherUnidade(sessao, empresa, pedida, 'caixa.ver')
  const j = janela(lerPeriodo(pedido))
  const turnos = await listarCaixas(sessao, { unidadeIds: onde.ids, de: j.de, ate: j.ate })

  const aberto = turnos.find((t) => t.id === turno) ?? null
  const movimentos = aberto ? await movimentosDoCaixa(sessao, aberto.id) : []

  const abertos = turnos.filter((t) => t.aberto)
  const fechados = turnos.filter((t) => !t.aberto)
  const comFalta = fechados.filter((t) => (t.diferenca ?? 0) < -0.005)
  const comSobra = fechados.filter((t) => (t.diferenca ?? 0) > 0.005)
  const somaDif = fechados.reduce((s, t) => s + (t.diferenca ?? 0), 0)
  const vendido = fechados.reduce((s, t) => s + t.vendido, 0)
  const esquecidos = abertos.filter((t) => t.horasAberto > 24)

  const link = (t: TurnoDeCaixa) =>
    `/${slug}/caixa?turno=${t.id}${onde.unidadeId ? `&unidade=${onde.unidadeId}` : ''}&periodo=${j.chave}`

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/caixa`}
      tema={tema}
      titulo="Caixa"
      acao={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SeletorPeriodo atual={j.chave} />
          {onde.mostrarSeletor && <SeletorUnidade opcoes={onde.opcoes} atual={onde.unidadeId} />}
        </div>
      }
    >
      {esquecidos.map((t) => (
        <Aviso key={t.id} nivel="atencao">
          O caixa de <b>{t.unidade}</b> está aberto desde {quando(t.abertoEm)}, por {t.abertoPor} — há{' '}
          {Math.floor(t.horasAberto / 24)} dia{Math.floor(t.horasAberto / 24) === 1 ? '' : 's'}. Caixa aberto de
          um dia para o outro mistura o dinheiro de dois turnos.
          {pode(sessao, 'caixa.operar', t.unidadeId) && (
            <>
              {' '}
              <Link href={`/${slug}/balcao?caixa=fechar&unidade=${t.unidadeId}`} className="font-semibold underline underline-offset-2">
                Fechar agora
              </Link>
            </>
          )}
        </Aviso>
      ))}

      <Secao titulo={`${j.rotulo} · ${onde.titulo}`}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Numero
            principal
            rotulo="Diferença acumulada"
            valor={brl(somaDif)}
            detalhe={`em ${fechados.length} turno${fechados.length === 1 ? '' : 's'} fechado${fechados.length === 1 ? '' : 's'}`}
            nivel={Math.abs(somaDif) < 0.005 ? 'bom' : somaDif < 0 ? 'critico' : 'atencao'}
          />
          <Numero rotulo="Vendido nos turnos" valor={brl(vendido)} detalhe="todas as formas" />
          <Numero
            rotulo="Turnos com falta"
            valor={String(comFalta.length)}
            detalhe={comFalta.length ? brl(comFalta.reduce((s, t) => s + (t.diferenca ?? 0), 0)) : 'nenhum'}
            nivel={comFalta.length ? 'critico' : 'bom'}
          />
          <Numero
            rotulo="Turnos com sobra"
            valor={String(comSobra.length)}
            detalhe={comSobra.length ? brl(comSobra.reduce((s, t) => s + (t.diferenca ?? 0), 0)) : 'nenhum'}
            nivel={comSobra.length ? 'atencao' : undefined}
          />
        </div>

        <Tira
          itens={[
            { rotulo: 'aberto agora', quantos: abertos.length, nivel: 'bom' },
            { rotulo: 'fechou certo', quantos: fechados.length - comFalta.length - comSobra.length, nivel: 'bom' },
            { rotulo: 'com falta', quantos: comFalta.length, nivel: 'critico' },
            { rotulo: 'com sobra', quantos: comSobra.length, nivel: 'atencao' },
          ]}
        />

        <Tabela
          colunas={[
            {
              chave: 'abriu',
              titulo: 'Abriu',
              largura: '9rem',
              celula: (t: TurnoDeCaixa) => (
                <span className="flex flex-col">
                  <span className="numero whitespace-nowrap text-tinta">{quando(t.abertoEm)}</span>
                  <span className="truncate text-xs text-tinta-3">{t.abertoPor}</span>
                </span>
              ),
            },
            {
              chave: 'fechou',
              titulo: 'Fechou',
              largura: '9rem',
              celula: (t: TurnoDeCaixa) =>
                t.aberto ? (
                  <Situacao nivel={t.horasAberto > 24 ? 'atencao' : 'bom'}>aberto</Situacao>
                ) : (
                  <span className="flex flex-col">
                    <span className="numero whitespace-nowrap text-tinta">{t.fechadoEm ? quando(t.fechadoEm) : '—'}</span>
                    <span className="truncate text-xs text-tinta-3">{t.fechadoPor}</span>
                  </span>
                ),
            },
            ...(onde.unidadeId === null && onde.opcoes.length > 1
              ? [
                  {
                    chave: 'unidade',
                    titulo: 'Loja',
                    largura: '8rem',
                    celula: (t: TurnoDeCaixa) => <span className="truncate text-tinta-2">{t.unidade}</span>,
                  },
                ]
              : []),
            {
              chave: 'vendas',
              titulo: 'Vendas',
              numero: true,
              largura: '8rem',
              celula: (t: TurnoDeCaixa) => (
                <span className="flex flex-col items-end">
                  <span className="numero font-semibold text-tinta">{brl(t.vendido)}</span>
                  <span className="text-xs text-tinta-3">{t.vendas} venda{t.vendas === 1 ? '' : 's'}</span>
                </span>
              ),
            },
            {
              chave: 'gaveta',
              titulo: 'Gaveta',
              numero: true,
              largura: '9rem',
              celula: (t: TurnoDeCaixa) => (
                <span className="flex flex-col items-end text-xs text-tinta-3">
                  <span className="numero text-sm text-tinta">
                    {t.saldoContado !== null ? brl(t.saldoContado) : t.aberto ? '—' : brl(0)}
                  </span>
                  <span>
                    {t.saldoEsperado !== null ? `esperado ${brl(t.saldoEsperado)}` : `abriu com ${brl(t.saldoAbertura)}`}
                  </span>
                </span>
              ),
            },
            {
              chave: 'dif',
              titulo: 'Diferença',
              numero: true,
              largura: '7rem',
              celula: (t: TurnoDeCaixa) =>
                t.diferenca === null ? null : Math.abs(t.diferenca) < 0.005 ? (
                  <Situacao nivel="bom">bateu</Situacao>
                ) : (
                  <span className={cx('numero font-bold', t.diferenca < 0 ? 'text-critico' : 'text-atencao')}>
                    {t.diferenca > 0 ? '+' : ''}
                    {brl(t.diferenca)}
                  </span>
                ),
            },
            {
              chave: 'ver',
              titulo: '',
              largura: '5rem',
              celula: (t: TurnoDeCaixa) => (
                <Link href={link(t)} className="text-xs font-medium text-marca underline-offset-2 hover:underline">
                  detalhes
                </Link>
              ),
            },
          ]}
          linhas={turnos}
          chave={(t) => t.id}
          vazio="Nenhum turno de caixa no período."
        />
      </Secao>

      {aberto && (
        <Secao
          titulo={`Turno de ${quando(aberto.abertoEm)} · ${aberto.unidade}`}
          resumo={
            aberto.aberto
              ? `Aberto por ${aberto.abertoPor} às ${hora(aberto.abertoEm)}.`
              : `Aberto por ${aberto.abertoPor}, fechado por ${aberto.fechadoPor ?? '—'}${aberto.fechadoEm ? ` às ${hora(aberto.fechadoEm)}` : ''}.`
          }
          acao={
            <Link href={`/${slug}/caixa?${onde.unidadeId ? `unidade=${onde.unidadeId}&` : ''}periodo=${j.chave}`} className="text-xs text-tinta-3 hover:text-tinta">
              fechar detalhes
            </Link>
          }
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <Cartao caixa titulo="A conta da gaveta">
              <dl className="flex flex-col text-sm">
                {[
                  ['Abertura', aberto.saldoAbertura],
                  ['Suprimentos', aberto.suprimentos],
                  ['Sangrias', -aberto.sangrias],
                ].map(([r, v]) => (
                  <div key={String(r)} className="flex justify-between gap-4 border-b border-borda-suave py-1.5 text-tinta-2">
                    <dt>{r}</dt>
                    <dd className="numero">{brl(Number(v))}</dd>
                  </div>
                ))}
                {aberto.saldoEsperado !== null && (
                  <div className="flex justify-between gap-4 py-1.5 font-bold text-tinta">
                    <dt>Deveria ter</dt>
                    <dd className="numero">{brl(aberto.saldoEsperado)}</dd>
                  </div>
                )}
                {aberto.saldoContado !== null && (
                  <div className="flex justify-between gap-4 py-1.5 font-bold text-tinta">
                    <dt>Contado</dt>
                    <dd className="numero">{brl(aberto.saldoContado)}</dd>
                  </div>
                )}
                {aberto.diferenca !== null && (
                  <div className={cx('flex justify-between gap-4 py-1.5 font-bold', Math.abs(aberto.diferenca) < 0.005 ? 'text-bom' : aberto.diferenca < 0 ? 'text-critico' : 'text-atencao')}>
                    <dt>{Math.abs(aberto.diferenca) < 0.005 ? 'Bateu' : aberto.diferenca < 0 ? 'Faltou' : 'Sobrou'}</dt>
                    <dd className="numero">{brl(Math.abs(aberto.diferenca))}</dd>
                  </div>
                )}
              </dl>
              {aberto.observacoes && (
                <p className="mt-3 text-xs text-tinta-2">
                  <b>Observação:</b> {aberto.observacoes}
                </p>
              )}
            </Cartao>

            <Cartao caixa titulo={`Sangrias e suprimentos (${movimentos.length})`}>
              {movimentos.length === 0 ? (
                <p className="py-4 text-center text-sm text-tinta-3">Nenhum movimento neste turno.</p>
              ) : (
                <ul className="flex flex-col text-sm">
                  {movimentos.map((m) => (
                    <li key={m.id} className="flex items-center justify-between gap-3 border-b border-borda-suave py-1.5 last:border-0">
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate text-tinta">{m.motivo}</span>
                        <span className="text-xs text-tinta-3">
                          {hora(m.criadoEm)} · {m.quem}
                        </span>
                      </span>
                      <span className={cx('numero shrink-0 font-semibold', m.tipo === 'SANGRIA' ? 'text-critico' : 'text-bom')}>
                        {m.tipo === 'SANGRIA' ? '− ' : '+ '}
                        {brl(m.valor)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Cartao>
          </div>
          <p className="text-xs text-tinta-3">
            As vendas deste turno estão em{' '}
            <Link href={`/${slug}/vendas?unidade=${aberto.unidadeId}`} className="font-medium text-marca underline-offset-2 hover:underline">
              Vendas
            </Link>
            .
          </p>
        </Secao>
      )}
    </Estrutura>
  )
}
