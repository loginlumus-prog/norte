import type { Metadata } from 'next'
import { vocabularioDaEmpresa, vocabularioDoEndereco } from '@/servidor/vocabulario'
import { mostrarDiaDaColuna } from '@/servidor/dia'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { exigirEntrada } from '@/servidor/pagina'
import { acharCliente, mostrarTelefone, comprasPorMes, favoritosDoCliente } from '@/servidor/cliente'
import { valesDoCliente } from '@/servidor/devolucao'
import { limiteDeCredito } from '@/servidor/venda'
import { listarParcelas } from '@/servidor/crediario'
import { recibosDoCliente, type ReciboNaLista } from '@/servidor/recibos'
import { BotaoReceber } from '../../crediario/BotaoReceber'
import { ListaDeRecibos } from '../../crediario/Recibos'
import { moduloLigado } from '@/servidor/modulos'
import { unidadesVisiveis } from '@/servidor/unidade'
import { ehSuporteDoNorte, pode } from '@/servidor/permissao'
import { Estrutura } from '@/ui/Estrutura'
import { MENU } from '@/ui/menu'
import { Aviso, Cartao, Situacao, Vazio, cx } from '@/ui/base'
import { Numero, Secao, brl } from '@/ui/painel'
import { BarrasMeses, BarrasH } from '@/ui/Graficos'
import { BotaoDaLinha } from '@/ui/premium'
import type { Tema } from '@/ui/TrocaTema'
import { Editor, type ClienteNaTela } from '../Editor'
import { ofertasNaTela } from '../ofertasNaTela'
import { Anonimizar } from './Anonimizar'
import { Escola } from './Escola'
import { PALAVRA_CONFIRMA } from '@/servidor/anonimizar'
import { colunaDoDia, diaEmSP } from '@/servidor/dia'
import { plural, quantidade } from '@/ui/texto'
import { listarAgenda, ROTULO_AGENDA, NIVEL_AGENDA, OCUPAM, diaCurtoSP, horaEmSP } from '@/servidor/agenda'

export async function generateMetadata({ params }: { params: Promise<{ empresa: string }> }): Promise<Metadata> {
  return { title: (await vocabularioDoEndereco((await params).empresa)).Pessoa }
}

// A ficha do cliente.
//
// O HISTÓRICO VEM ANTES DO CADASTRO. Quem abre esta tela está quase sempre
// com a pessoa na frente ou no telefone, e a pergunta é "o que ela costuma
// levar?" — não "qual o CEP dela?". Editar fica embaixo, para quando é isso
// mesmo que se quer.

const data = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: '2-digit' }).format(d)

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
  // Com a Agenda ligada, a ficha mostra os horários da pessoa: o próximo e os
  // de antes, com falta e desmarcado — "ela sempre falta às segundas" é o que
  // a recepção precisa saber antes de marcar de novo.
  const temAgenda = moduloLigado(empresa, 'agenda') && pode(sessao, 'agenda.ver')
  // Com a Escola ligada, a ficha é também a do ALUNO: o responsável, as
  // matrículas e as mensalidades (ver Escola.tsx).
  const temEscola = moduloLigado(empresa, 'escola') && pode(sessao, 'escola.ver')
  const vocab = await vocabularioDaEmpresa(sessao.orgId)
  const [meses, favoritos, vales, parcelas, horarios, recibos] = await Promise.all([
    comprasPorMes(sessao, id, 12),
    favoritosDoCliente(sessao, id),
    valesDoCliente(sessao, id),
    temCrediario
      ? unidadesVisiveis(sessao, 'crediario.ver').then((us) =>
          listarParcelas(sessao, { unidadeIds: us.map((u) => u.id), situacao: 'aberta', clienteId: id }),
        )
      : Promise.resolve([]),
    temAgenda
      ? unidadesVisiveis(sessao, 'agenda.ver').then((us) =>
          listarAgenda(sessao, {
            unidadeIds: us.map((u) => u.id),
            de: new Date(Date.now() - 365 * 864e5),
            ate: new Date(Date.now() + 365 * 864e5),
            clienteId: id,
          }),
        )
      : Promise.resolve([]),
    temCrediario ? recibosDoCliente(sessao, id, 10) : Promise.resolve([] as ReciboNaLista[]),
  ])
  const agora = new Date()
  const proximos = horarios.filter((h) => h.fim > agora && OCUPAM.includes(h.situacao) && h.situacao !== 'ATENDIDO')
  const passados = horarios.filter((h) => !proximos.includes(h)).reverse().slice(0, 12)
  const faltas = horarios.filter((h) => h.situacao === 'FALTOU').length
  const devendo = parcelas.reduce((s, p) => s + p.resta, 0)
  const vencidas = parcelas.filter((p) => p.situacao === 'vencida')
  const primeiroNome = cliente.nome.split(' ')[0]
  const telefoneLimpo = cliente.telefone?.replace(/\D/g, '') ?? ''
  const cobranca =
    telefoneLimpo && vencidas.length > 0
      ? `https://wa.me/55${telefoneLimpo}?text=${encodeURIComponent(
          `Olá, ${primeiroNome}! Aqui é da ${empresa.nome}. Passando para lembrar ${
            vencidas.length === 1
              ? `da parcela ${vencidas[0]!.numero}/${vencidas[0]!.de} de ${brl(vencidas[0]!.resta)}, que venceu em ${mostrarDiaDaColuna(vencidas[0]!.vencimento)}`
              : `das ${vencidas.length} parcelas em atraso, que somam ${brl(vencidas.reduce((s, p) => s + p.resta, 0))}`
          }. Podemos acertar? Obrigado!`,
        )}`
      : null

  const anonimizado = !!cliente.anonimizadoEm
  // Anonimizada não se edita (ver editarCliente): o formulário nem aparece.
  const podeEditar = pode(sessao, 'cliente.editar') && !anonimizado
  // Irreversível e apaga conversa: é de quem configura a empresa (o dono).
  const podeAnonimizar = pode(sessao, 'empresa.configurar') && !ehSuporteDoNorte(sessao) && !anonimizado
  const ofertas = podeEditar ? await ofertasNaTela(sessao, empresa.nome, cliente) : null

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
    crediario:
      moduloLigado(empresa, 'crediario') && podeEditar
        ? await limiteDeCredito(sessao, cliente.id).then((l) => ({
            limite: l !== null ? l.toFixed(2).replace('.', ',') : '',
            podeLimite: pode(sessao, 'venda.desconto'),
          }))
        : null,
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
        cliente.telefone && !anonimizado ? (
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
      {/* Título sem "ela" nem "ele": a ficha é de qualquer cliente, e o
          sistema não sabe — nem precisa saber — o gênero de ninguém. */}
      <Secao titulo="Resumo">
        {anonimizado && (
          <Aviso nivel="neutro">
            Cadastro anonimizado em{' '}
            {mostrarDiaDaColuna(colunaDoDia(diaEmSP(cliente.anonimizadoEm!)), 'longo')}, a pedido do titular. As compras
            continuam aqui, sem nome, pelo prazo que a lei manda guardar.
          </Aviso>
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          <Numero
            rotulo={vocab.naFicha.Gastou === 'Gastou' ? 'Gastou aqui' : vocab.naFicha.Gastou}
            valor={brl(gastou)}
            detalhe={plural(cliente.vendas.length, vocab.naFicha.uma, vocab.naFicha.varias)}
            nivel={gastou > 0 ? 'bom' : undefined}
          />
          <Numero rotulo={vocab.ticketMedio} valor={brl(ticket)} detalhe={`por ${vocab.naFicha.uma}`} />
          <Numero
            rotulo={vocab.naFicha.Ultima}
            valor={dias === null ? '—' : dias === 0 ? 'hoje' : `há ${plural(dias, 'dia', 'dias')}`}
            detalhe={dias === null ? vocab.naFicha.nunca : undefined}
            nivel={dias !== null && dias >= 60 ? 'atencao' : undefined}
          />
        </div>

        {cliente.vendas.length > 0 && (
          <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
            <Cartao caixa titulo={vocab.naFicha.Gastou === 'Gastou' ? 'Quanto gastou, mês a mês' : `${vocab.naFicha.Gastou}, mês a mês`}>
              <BarrasMeses
                rotulos={meses.map((m) => m.rotulo)}
                series={[{ nome: vocab.naFicha.Gastou, cor: 'var(--bom-vivo)', valores: meses.map((m) => m.total) }]}
                altura={110}
              />
            </Cartao>
            <Cartao caixa titulo="O que mais leva">
              <BarrasH
                // A barra mede as VEZES (o que se compara entre quilo e
                // peça); o número é a quantidade com a medida dela.
                itens={favoritos.map((f) => ({
                  rotulo: f.descricao,
                  valor: f.vezes,
                  texto: quantidade(f.quantidade, f.medida),
                  detalhe: `${plural(f.vezes, 'vez', 'vezes')} · ${brl(f.total)}`,
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
                            ? `${v.vencido ? 'venceu' : 'vale até'} ${mostrarDiaDaColuna(v.validade, 'longo')}`
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
                          vence {mostrarDiaDaColuna(p.vencimento, 'curto')}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {p.situacao === 'vencida' ? (
                          <Situacao nivel="critico">{p.diasAtraso}d atrasada</Situacao>
                        ) : (
                          <Situacao nivel="neutro">em dia</Situacao>
                        )}
                        <span className="flex flex-col items-end">
                          <span className={cx('numero font-semibold', p.situacao === 'vencida' ? 'text-critico' : 'text-tinta')}>{brl(p.resta)}</span>
                          {p.multaHoje + p.jurosHoje > 0 && (
                            <span className="numero text-[12.5px] text-critico">+ {brl(p.multaHoje + p.jurosHoje)} atraso</span>
                          )}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
                {/* Receber por loja: cada loja é um credor, com o caixa dela. */}
                <div className="flex flex-wrap items-center gap-2 pt-2">
                  {[...new Map(parcelas.map((p) => [p.unidadeId, p.unidade])).entries()]
                    .filter(([u]) => pode(sessao, 'crediario.receber', u))
                    .map(([u, nome], _i, todas) => (
                      <BotaoReceber key={u} slug={slug} unidadeId={u} clienteId={cliente.id} className="py-1 text-xs">
                        {todas.length > 1 ? `Receber em ${nome}` : 'Receber parcelas'}
                      </BotaoReceber>
                    ))}
                  <BotaoDaLinha
                    comRotulo
                    href={`/${slug}/crediario?cliente=${cliente.id}&situacao=todas`}
                    icone="ver"
                    rotulo="Todas as parcelas"
                    dica="Ver todas as parcelas, pagas também"
                  />
                </div>
              </Cartao>
            )}
          </div>
        )}

        {recibos.length > 0 && (
          <Cartao titulo="Recibos do crediário">
            <ListaDeRecibos slug={slug} recibos={recibos} />
          </Cartao>
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
              Esta pessoa ainda não comprou nada. Escolha esta pessoa no balcão na próxima venda e o
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
                    {/* Até duas linhas no celular, em vez de uma cortada: é
                        a lista do que a pessoa levou, e é ela que se procura. */}
                    <span className="line-clamp-2 text-sm text-tinta sm:line-clamp-1">
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

        {temAgenda && (
          <Cartao
            titulo="Agenda"
            acao={
              faltas > 0 ? (
                <Situacao nivel="critico">{plural(faltas, 'falta', 'faltas')} no último ano</Situacao>
              ) : undefined
            }
          >
            {horarios.length === 0 ? (
              <Vazio>Nenhum horário marcado no último ano.</Vazio>
            ) : (
              <ul className="flex flex-col">
                {[...proximos, ...passados].map((h) => (
                  <li
                    key={h.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-borda-suave py-2.5 last:border-0"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="text-sm text-tinta">
                        {h.servico} · com {h.colaboradorNome}
                      </span>
                      <span className="text-xs text-tinta-3">
                        {diaCurtoSP(h.inicio)} às {horaEmSP(h.inicio)} · {h.unidadeNome}
                        {h.motivo ? ` · ${h.motivo}` : ''}
                      </span>
                    </span>
                    <Situacao nivel={proximos.includes(h) ? 'atencao' : NIVEL_AGENDA[h.situacao]}>
                      {proximos.includes(h) ? `próximo · ${ROTULO_AGENDA[h.situacao].toLowerCase()}` : ROTULO_AGENDA[h.situacao]}
                    </Situacao>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        )}

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

      {temEscola && !anonimizado && (
        <Secao titulo="Escola">
          <Escola slug={slug} sessao={sessao} alunoId={cliente.id} nomeAluno={cliente.nome} escola={empresa.nome} palavra={vocab.pessoa} />
        </Secao>
      )}

      {podeEditar && ofertas && (
        <Secao titulo="Cadastro">
          <Editor slug={slug} cliente={naTela} ofertas={ofertas} />
        </Secao>
      )}

      {podeAnonimizar && (
        <Secao titulo="Dados pessoais">
          <Cartao>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="max-w-xl text-sm text-tinta-2">
                A pessoa pediu para apagar os dados dela? Anonimizar tira nome, contato e conversas, e mantém as
                vendas sem nome — o registro fiscal que a lei manda guardar.
              </p>
              <Anonimizar slug={slug} clienteId={cliente.id} palavra={PALAVRA_CONFIRMA} />
            </div>
          </Cartao>
        </Secao>
      )}
    </Estrutura>
  )
}
