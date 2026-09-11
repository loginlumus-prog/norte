import Link from 'next/link'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { acharCliente, mostrarTelefone, comprasPorMes, favoritosDoCliente } from '@/servidor/cliente'
import { valesDoCliente } from '@/servidor/devolucao'
import { listarParcelas } from '@/servidor/crediario'
import { moduloLigado } from '@/servidor/modulos'
import { unidadesVisiveis } from '@/servidor/unidade'
import { pode } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Cartao, Situacao, Vazio, cx } from '@/ui/base'
import { Numero, Secao, brl } from '@/ui/painel'
import { BarrasMeses, BarrasH } from '@/ui/Graficos'
import type { Tema } from '@/ui/TrocaTema'
import { Editor, type ClienteNaTela } from '../Editor'

// A ficha do cliente.
//
// O HISTÓRICO VEM ANTES DO CADASTRO. Quem abre esta tela está quase sempre
// com a pessoa na frente ou no telefone, e a pergunta é "o que ela costuma
// levar?" — não "qual o CEP dela?". Editar fica embaixo, para quando é isso
// mesmo que se quer.

const data = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(d)

export default async function FichaCliente({
  params,
}: {
  params: Promise<{ empresa: string; id: string }>
}) {
  const { empresa: slug, id } = await params
  const { empresa, sessao } = await exigirEntrada(slug, { capacidade: 'cliente.ver' })
  const tema = ((await cookies()).get('tema')?.value ?? 'sistema') as Tema

  const cliente = await acharCliente(sessao, id)
  if (!cliente) notFound()

  const temCrediario = moduloLigado(empresa, 'crediario') && pode(sessao, 'crediario.ver')
  const [meses, favoritos, vales, parcelas] = await Promise.all([
    comprasPorMes(sessao, id, 12),
    favoritosDoCliente(sessao, id),
    valesDoCliente(sessao, id),
    temCrediario
      ? unidadesVisiveis(sessao, 'crediario.ver').then((us) =>
          listarParcelas(sessao, { unidadeIds: us.map((u) => u.id), situacao: 'aberta', clienteId: id }),
        )
      : Promise.resolve([]),
  ])
  const devendo = parcelas.reduce((s, p) => s + p.resta, 0)
  const vencidas = parcelas.filter((p) => p.situacao === 'vencida')
  const primeiroNome = cliente.nome.split(' ')[0]
  const telefoneLimpo = cliente.telefone?.replace(/\D/g, '') ?? ''
  const cobranca =
    telefoneLimpo && vencidas.length > 0
      ? `https://wa.me/55${telefoneLimpo}?text=${encodeURIComponent(
          `Olá, ${primeiroNome}! Aqui é da ${empresa.nome}. Passando para lembrar ${
            vencidas.length === 1
              ? `da parcela ${vencidas[0]!.numero}/${vencidas[0]!.de} de ${brl(vencidas[0]!.resta)}, que venceu em ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' }).format(vencidas[0]!.vencimento)}`
              : `das ${vencidas.length} parcelas em atraso, que somam ${brl(vencidas.reduce((s, p) => s + p.resta, 0))}`
          }. Podemos acertar? Obrigado!`,
        )}`
      : null

  const podeEditar = pode(sessao, 'cliente.editar')

  const gastou = cliente.vendas.reduce((s, v) => s + Number(v.total), 0)
  const ultima = cliente.vendas[0]?.criadaEm ?? null
  const dias = ultima ? Math.floor((Date.now() - ultima.getTime()) / 864e5) : null
  const ticket = cliente.vendas.length > 0 ? gastou / cliente.vendas.length : 0

  const naTela: ClienteNaTela = {
    id: cliente.id,
    nome: cliente.nome,
    telefone: mostrarTelefone(cliente.telefone),
    documento: cliente.documento ?? '',
    email: cliente.email ?? '',
    nascimento: cliente.nascimento ? cliente.nascimento.toISOString().slice(0, 10) : '',
    endereco: cliente.endereco ?? '',
    numero: cliente.numero ?? '',
    bairro: cliente.bairro ?? '',
    cidade: cliente.cidade ?? '',
    estado: cliente.estado ?? '',
    cep: cliente.cep ?? '',
    observacoes: cliente.observacoes ?? '',
    ativo: cliente.ativo,
  }

  return (
    <Estrutura
      empresa={empresa}
      sessao={sessao}
      itens={MENU(slug)}
      ativo={`/${slug}/clientes`}
      tema={tema}
      titulo={cliente.nome}
      acao={
        cliente.telefone ? (
          <a
            href={`https://wa.me/55${cliente.telefone}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-norte border border-borda px-3 py-1.5 text-sm font-semibold text-tinta hover:bg-superficie-2"
          >
            {mostrarTelefone(cliente.telefone)}
          </a>
        ) : undefined
      }
    >
      <Secao titulo="O que ela já comprou">
        <div className="grid gap-2 sm:grid-cols-3">
          <Numero
            rotulo="Gastou aqui"
            valor={brl(gastou)}
            detalhe={`${cliente.vendas.length} compra(s)`}
            nivel={gastou > 0 ? 'bom' : undefined}
          />
          <Numero rotulo="Ticket médio" valor={brl(ticket)} detalhe="por compra" />
          <Numero
            rotulo="Última compra"
            valor={dias === null ? '—' : `${dias}d`}
            detalhe={dias === null ? 'nunca comprou' : 'atrás'}
            nivel={dias !== null && dias >= 60 ? 'atencao' : undefined}
          />
        </div>

        {cliente.vendas.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <Cartao caixa titulo="Quanto gastou, mês a mês">
              <BarrasMeses
                rotulos={meses.map((m) => m.rotulo)}
                series={[{ nome: 'Gastou', cor: 'var(--bom-vivo)', valores: meses.map((m) => m.total) }]}
                altura={110}
              />
            </Cartao>
            <Cartao caixa titulo="O que mais leva">
              <BarrasH
                itens={favoritos.map((f) => ({
                  rotulo: f.descricao,
                  valor: f.quantidade,
                  detalhe: `${f.vezes}× · ${brl(f.total)}`,
                }))}
                formato="un"
              />
            </Cartao>
          </div>
        )}

        {/* ── o que a loja deve a ela, e o que ela deve à loja ── */}
        {(vales.length > 0 || parcelas.length > 0) && (
          <div className="grid gap-3 lg:grid-cols-2">
            {vales.length > 0 && (
              <Cartao caixa titulo="Vales de troca com saldo">
                <ul className="flex flex-col divide-y divide-borda-suave text-sm">
                  {vales.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="flex flex-col">
                        <span className="numero font-mono font-bold text-tinta">{v.codigo}</span>
                        <span className="text-xs text-tinta-3">
                          {v.validade
                            ? `${v.vencido ? 'venceu' : 'vale até'} ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(v.validade)}`
                            : 'sem validade'}
                        </span>
                      </span>
                      <span className={cx('numero font-semibold', v.vencido ? 'text-tinta-3 line-through' : 'text-bom')}>{brl(v.saldo)}</span>
                    </li>
                  ))}
                </ul>
              </Cartao>
            )}
            {parcelas.length > 0 && (
              <Cartao
                caixa
                titulo={`Crediário · deve ${brl(devendo)}`}
                acao={
                  cobranca ? (
                    <a
                      href={cobranca}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-norte border border-critico-borda bg-critico-fundo px-2.5 py-1 text-xs font-semibold text-critico hover:brightness-95"
                    >
                      Cobrar pelo WhatsApp
                    </a>
                  ) : undefined
                }
              >
                <ul className="flex flex-col divide-y divide-borda-suave text-sm">
                  {parcelas.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="flex flex-col">
                        <span className="text-tinta">
                          Venda {p.vendaNumero} · parcela {p.numero}/{p.de}
                        </span>
                        <span className="text-xs text-tinta-3">
                          vence {new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(p.vencimento)}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {p.situacao === 'vencida' ? (
                          <Situacao nivel="critico">{p.diasAtraso}d atrasada</Situacao>
                        ) : (
                          <Situacao nivel="neutro">em dia</Situacao>
                        )}
                        <span className={cx('numero font-semibold', p.situacao === 'vencida' ? 'text-critico' : 'text-tinta')}>{brl(p.resta)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="pt-2 text-xs text-tinta-3">
                  Receber é em{' '}
                  <Link href={`/${slug}/crediario?cliente=${cliente.id}`} className="font-medium text-marca underline-offset-2 hover:underline">
                    Crediário
                  </Link>
                  .
                </p>
              </Cartao>
            )}
          </div>
        )}

        {cliente.pontos > 0 || cliente.movimentosPontos.length > 0 ? (
          <Cartao titulo="Pontos">
            <div className="flex flex-wrap items-baseline justify-between gap-3 pb-2">
              <span className="text-sm text-tinta-2">Saldo agora</span>
              <span className="numero text-2xl font-bold text-tinta">{cliente.pontos}</span>
            </div>
            {/* O extrato, e nao so o saldo: numero sozinho nao responde
                "por que caiu", e quem juntou ponto nao tem comprovante em casa. */}
            <ul className="flex flex-col">
              {cliente.movimentosPontos.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 border-b border-borda-suave py-2 last:border-0"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-tinta">
                      {m.tipo === 'GANHOU' ? 'Ganhou' : m.tipo === 'USOU' ? 'Usou' : 'Ajuste'}
                      {m.motivo ? ` — ${m.motivo}` : ''}
                    </span>
                    <span className="text-xs text-tinta-3">{data(m.criadoEm)}</span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-3">
                    <span
                      className={
                        m.pontos >= 0
                          ? 'numero text-sm font-semibold text-bom'
                          : 'numero text-sm font-semibold text-tinta-2'
                      }
                    >
                      {m.pontos > 0 ? `+${m.pontos}` : m.pontos}
                    </span>
                    <span className="numero w-12 text-right text-xs text-tinta-3">
                      {m.saldoDepois}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </Cartao>
        ) : null}

        <Cartao titulo="Compras">
          {cliente.vendas.length === 0 ? (
            <Vazio>
              Esta pessoa ainda não comprou nada. Escolha ela no balcão na próxima venda e o
              histórico começa aqui.
            </Vazio>
          ) : (
            <ul className="flex flex-col">
              {cliente.vendas.map((v) => (
                <li
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-3 border-b border-borda-suave py-2.5 last:border-0"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm text-tinta">
                      {v.itens.map((i) => i.descricao).join(', ')}
                    </span>
                    <span className="text-xs text-tinta-3">
                      venda {v.numero} · {data(v.criadaEm)} · {v.unidade.nome}
                    </span>
                  </span>
                  <span className="numero shrink-0 text-sm font-semibold text-tinta">
                    {brl(Number(v.total))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Cartao>

        {cliente.observacoes && (
          <Cartao titulo="O que a equipe precisa lembrar">
            <p className="text-sm leading-relaxed text-tinta-2">{cliente.observacoes}</p>
          </Cartao>
        )}

        {!cliente.ativo && (
          <Cartao>
            <Situacao nivel="neutro">
              Cliente inativo — some da busca do balcão e continua no histórico.
            </Situacao>
          </Cartao>
        )}
      </Secao>

      {podeEditar && (
        <Secao titulo="Cadastro">
          <Editor slug={slug} cliente={naTela} />
        </Secao>
      )}
    </Estrutura>
  )
}
