// A parte Escola da ficha do aluno: o responsável, as matrículas e as
// mensalidades — com o "Receber" ali mesmo, porque é com o responsável na
// frente (ou no telefone) que a ficha é aberta.
//
// Componente de servidor: lê com a sessão de quem abriu, e cada pedaço pede a
// sua permissão (a turma pede `escola.ver`; o dinheiro, `mensalidade.ver`).

import Link from 'next/link'
import { pode, type Sessao } from '@/servidor/permissao'
import { colunaDoDia, diaEmSP, mostrarDiaDaColuna } from '@/servidor/dia'
import { mostrarTelefone } from '@/servidor/cliente'
import { unidadesVisiveis } from '@/servidor/unidade'
import { fichaEscolar, NIVEL_MATRICULA, ROTULO_MATRICULA } from '@/servidor/escola'
import { listarMensalidades, mesPorExtenso, ROTULO_SITUACAO } from '@/servidor/mensalidades'
import { ORIGENS_ACEITE, ehOrigemAceite } from '@/servidor/ofertas'
import { Cartao, Situacao, Vazio, cx } from '@/ui/base'
import { brl } from '@/ui/painel'
import { BotaoDaLinha } from '@/ui/premium'
import { Responsavel } from './Responsavel'
import { Receber } from '../../mensalidades/Receber'

export async function Escola({
  slug,
  sessao,
  alunoId,
  nomeAluno,
  escola,
  palavra,
}: {
  slug: string
  sessao: Sessao
  alunoId: string
  nomeAluno: string
  escola: string
  palavra: string
}) {
  const ficha = await fichaEscolar(sessao, alunoId)
  const verDinheiro = pode(sessao, 'mensalidade.ver')
  const lojas = verDinheiro ? (await unidadesVisiveis(sessao, 'mensalidade.ver')).map((u) => u.id) : []
  const todas = verDinheiro ? await listarMensalidades(sessao, { unidadeIds: lojas, alunoId }) : []
  // As em aberto (de qualquer mês) e as últimas pagas — a ficha não é o extrato.
  const abertas = todas.filter((m) => m.situacao !== 'paga' && m.situacao !== 'cancelada')
  const pagas = todas.filter((m) => m.situacao === 'paga').reverse().slice(0, 6)
  const atrasadas = abertas.filter((m) => m.situacao === 'atrasada')
  const r = ficha.responsavel
  const podeMatricular = pode(sessao, 'escola.matricular')

  const resumoAviso = r
    ? r.avisos === 'NAO_PERGUNTADO'
      ? 'Ainda não foi perguntado: o aviso não sai para este número.'
      : `${r.avisos === 'SIM' ? 'Aceitou' : 'Não aceitou'}${r.avisosEm ? ` em ${mostrarDiaDaColuna(colunaDoDia(diaEmSP(r.avisosEm)), 'longo')}` : ''}${ehOrigemAceite(r.avisosOrigem) ? `, ${ORIGENS_ACEITE[r.avisosOrigem]}` : ''}.${r.avisosPor ? ` Anotado por ${r.avisosPor}.` : ''}`
    : null

  const primeiroNome = (r?.nome ?? '').split(' ')[0]
  const telefoneLimpo = r?.telefone?.replace(/\D/g, '') ?? ''
  const cobranca =
    telefoneLimpo && atrasadas.length > 0
      ? `https://wa.me/55${telefoneLimpo}?text=${encodeURIComponent(
          `Olá, ${primeiroNome}! Aqui é da ${escola}. Passando para lembrar ${
            atrasadas.length === 1
              ? `da mensalidade de ${mesPorExtenso(atrasadas[0]!.mes)} de ${nomeAluno.split(' ')[0]}, de ${brl(atrasadas[0]!.resta)}, que venceu em ${mostrarDiaDaColuna(atrasadas[0]!.vencimento)}`
              : `das ${atrasadas.length} mensalidades de ${nomeAluno.split(' ')[0]} em atraso, que somam ${brl(atrasadas.reduce((s, m) => s + m.resta, 0))}`
          }. Podemos acertar? Obrigado!`,
        )}`
      : null

  return (
    <div id="escola" className="grid gap-3 lg:grid-cols-2">
      <Cartao caixa titulo="Responsável" acao={r?.parentesco ? <span className="text-xs text-tinta-3">{r.parentesco}</span> : undefined}>
        {r && (
          <div className="flex flex-col gap-1 pb-3 text-sm">
            <span className="font-semibold text-tinta">{r.nome}</span>
            <span className="text-tinta-2">
              {[mostrarTelefone(r.telefone), r.email].filter(Boolean).join(' · ') || 'sem contato'}
            </span>
            <span className="text-xs text-tinta-3">
              Aviso da mensalidade: {r.avisos === 'SIM' ? 'aceita' : r.avisos === 'NAO' ? 'não aceita' : 'não perguntado'}
            </span>
          </div>
        )}
        {podeMatricular ? (
          <Responsavel
            slug={slug}
            alunoId={alunoId}
            escola={escola}
            palavra={palavra}
            origens={Object.entries(ORIGENS_ACEITE).map(([valor, titulo]) => ({ valor, titulo: titulo[0]!.toUpperCase() + titulo.slice(1) }))}
            inicial={
              r
                ? {
                    nome: r.nome,
                    parentesco: r.parentesco ?? '',
                    telefone: mostrarTelefone(r.telefone),
                    email: r.email ?? '',
                    documento: r.documento ?? '',
                    avisos: r.avisos,
                    resumoAviso,
                  }
                : null
            }
          />
        ) : !r ? (
          <Vazio>Sem responsável anotado. Quem matricula anota aqui quem paga e quem a escola contata.</Vazio>
        ) : null}
        <p className="pt-2 text-[12.5px] text-tinta-3">
          Mensagem da escola vai para o responsável, nunca para o {palavra}. O aceite de ofertas desta ficha não vale enquanto houver responsável.
        </p>
      </Cartao>

      <Cartao caixa titulo="Matrículas">
        {ficha.matriculas.length === 0 ? (
          <Vazio>
            Nenhuma matrícula.{' '}
            {pode(sessao, 'escola.ver') && (
              <Link href={`/${slug}/turmas`} className="font-medium text-marca underline-offset-2 hover:underline">
                Matricular em uma turma
              </Link>
            )}
          </Vazio>
        ) : (
          <ul className="flex flex-col divide-y divide-borda-suave text-sm">
            {ficha.matriculas.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                <span className="flex min-w-0 flex-col">
                  <Link href={`/${slug}/turmas/${m.turmaId}`} className="truncate font-medium text-tinta underline-offset-2 hover:underline">
                    {m.turma}
                  </Link>
                  <span className="text-xs text-tinta-3">
                    desde {mostrarDiaDaColuna(m.inicio, 'curto')}
                    {m.fim ? ` até ${mostrarDiaDaColuna(m.fim, 'curto')}` : ''}
                    {verDinheiro ? ` · ${brl(Math.max(0, m.valor - m.desconto))} dia ${m.diaVencimento}` : ''}
                    {m.desconto > 0 && m.descontoMotivo ? ` · ${m.descontoMotivo}` : ''}
                    {m.motivoSaida ? ` · ${m.motivoSaida}` : ''}
                  </span>
                </span>
                <Situacao nivel={NIVEL_MATRICULA[m.situacao]}>{ROTULO_MATRICULA[m.situacao]}</Situacao>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      {verDinheiro && (
        <Cartao
          caixa
          titulo={abertas.length ? `Mensalidades · falta ${brl(abertas.reduce((s, m) => s + m.resta, 0))}` : 'Mensalidades'}
          acao={
            <span className="flex flex-wrap items-center gap-2">
              {cobranca && (
                <a
                  href={cobranca}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-norte border border-critico-borda bg-critico-fundo px-2.5 py-1 text-xs font-semibold text-critico hover:brightness-95"
                  title="Abre o WhatsApp do responsável com a mensagem pronta — quem manda é você"
                >
                  Cobrar o responsável
                </a>
              )}
              {ficha.matriculas.some((m) => m.situacao === 'ATIVA') && (
                <BotaoDaLinha comRotulo href={`/${slug}/mensalidades/carne?aluno=${alunoId}`} icone="carne" rotulo="Carnê" dica={`Carnê das mensalidades de ${nomeAluno}`} />
              )}
            </span>
          }
        >
          {abertas.length + pagas.length === 0 ? (
            <Vazio>Nenhuma mensalidade ainda.</Vazio>
          ) : (
            <ul className="flex flex-col divide-y divide-borda-suave text-sm">
              {[...abertas, ...pagas].map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span className="flex flex-col">
                    <span className="text-tinta">
                      {mesPorExtenso(m.mes)} · {m.turma}
                    </span>
                    <span className="text-xs text-tinta-3">
                      vence {mostrarDiaDaColuna(m.vencimento, 'curto')} · {brl(m.devido)}
                      {m.pago > 0 && m.situacao !== 'paga' ? ` · pago ${brl(m.pago)}` : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-2">
                    <Situacao nivel={m.situacao === 'paga' ? 'bom' : m.situacao === 'atrasada' ? 'critico' : m.situacao === 'vence_hoje' ? 'atencao' : 'neutro'}>
                      {m.situacao === 'atrasada' ? `${m.diasAtraso}d em atraso` : ROTULO_SITUACAO[m.situacao]}
                    </Situacao>
                    {m.situacao !== 'paga' && (
                      <span className={cx('numero font-semibold', m.situacao === 'atrasada' ? 'text-critico' : 'text-tinta')}>{brl(m.resta)}</span>
                    )}
                    {m.situacao !== 'paga' && pode(sessao, 'mensalidade.receber', m.unidadeId) && (
                      <Receber
                        slug={slug}
                        mensalidadeId={m.id}
                        resta={m.resta}
                        jurosHoje={m.jurosHoje}
                        multaHoje={m.multaHoje}
                        abonoHoje={m.abonoHoje}
                        diasAtraso={m.diasAtraso}
                        diasJuros={m.diasJuros}
                      />
                    )}
                    {m.temPagamento && (
                      <BotaoDaLinha
                        href={`/${slug}/mensalidades/${m.id}/recibo`}
                        icone="imprimir"
                        rotulo="Recibo"
                        dica={`Recibo da mensalidade de ${mesPorExtenso(m.mes)}`}
                      />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {abertas.some((m) => m.situacao === 'a_receber' || m.situacao === 'vence_hoje') && (
            <p className="pt-2 text-[12.5px] text-tinta-3">
              O aviso ao responsável (se a escola ligou em Configurações e ele aceitou) sai alguns dias antes do vencimento.
            </p>
          )}
        </Cartao>
      )}
    </div>
  )
}
