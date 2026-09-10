// A política de privacidade.
//
// ── a ideia que organiza o documento ─────────────────────────
// Existem DUAS relações de dados aqui, e confundir as duas é o erro mais comum
// de política de SaaS:
//
//   1. Sobre a SUA empresa, a gente é CONTROLADOR. A gente decide guardar seu
//      nome, seu e-mail, seu CNPJ — para poder cobrar e dar suporte.
//
//   2. Sobre os SEUS CLIENTES, a gente é OPERADOR. Quem decide o que é
//      coletado, para quê e por quanto tempo é você. A gente só guarda e
//      processa a mando seu.
//
// A LGPD trata as duas de forma diferente, e um cliente que recebe pedido de
// exclusão de um cliente DELE precisa saber quem responde o quê.
//
// Cada afirmação técnica aqui é verificável no código: o isolamento por
// empresa está em prisma/sql/rls.sql, o que a portaria enxerga está em
// scripts/preparar-banco.ts, e a lista de quem mais toca nos dados está em
// src/servidor/legal.ts.

import type { Metadata } from 'next'
import { PaginaLegal, Secao, Itens, Destaque } from '@/ui/PaginaLegal'
import { EMPRESA, SUBPROCESSADORES } from '@/servidor/legal'

export const metadata: Metadata = {
  title: 'Privacidade · Norte',
  description: 'Que dado a gente guarda, onde ele fica, quem mais toca nele e como você tira ele daqui.',
}

export default function Privacidade() {
  const indefinidos = SUBPROCESSADORES.filter((s) => !s.decidido)

  return (
    <PaginaLegal
      titulo="Política de Privacidade"
      resumo="Que dado a gente guarda, onde ele fica, quem mais toca nele, por quanto tempo, e como você tira ele daqui. Sem parágrafo decorativo: se está escrito, dá para conferir."
    >
      <Secao n={1} titulo="Duas relações diferentes, e isso muda tudo">
        <p>
          O Norte lida com dois tipos de dado, e a lei trata os dois de forma diferente. Vale
          entender a diferença antes de ler o resto:
        </p>
        <Itens>
          <li>
            <b>Sobre a sua empresa</b>, a gente é <b>controlador</b>. É a gente que decide guardar
            o nome, o e-mail e o CNPJ de quem contrata — para poder cobrar, dar suporte e cumprir a
            lei.
          </li>
          <li>
            <b>Sobre os clientes da sua loja</b>, a gente é <b>operador</b>. Quem decide o que é
            coletado, para que serve e por quanto tempo fica é <b>você</b>. A gente guarda e
            processa a mando seu, e nada além disso.
          </li>
        </Itens>
        <Destaque>
          Na prática: se um cliente <i>seu</i> pedir para ser apagado, quem responde é você — e o
          sistema te dá a ferramenta para fazer isso. Se o pedido chegar aqui, a gente encaminha
          para você e avisa quem pediu.
        </Destaque>
      </Secao>

      <Secao n={2} titulo="O que a gente guarda sobre a sua empresa">
        <Itens>
          <li>
            <b>Da empresa</b> — nome, razão social, CNPJ ou CPF, inscrição estadual, regime
            tributário, endereço, telefone, WhatsApp e e-mail.
          </li>
          <li>
            <b>De quem usa</b> — nome, e-mail, senha (guardada como resumo criptográfico, nunca em
            texto), papel e a qual loja a pessoa tem acesso.
          </li>
          <li>
            <b>Do uso</b> — o livro de auditoria: quem fez o quê, quando, e o valor antes e depois.
            Isso existe para a sua segurança, e você enxerga tudo.
          </li>
          <li>
            <b>Da cobrança</b> — plano, situação, datas e valores. <b>Nunca</b> cartão nem conta
            bancária.
          </li>
        </Itens>
        <Destaque>
          <b>O cadastro inicial não pergunta faturamento, conta bancária nem cartão.</b> Não é
          esquecimento: é decisão. Dado financeiro que não existe aqui não vaza daqui, e para
          cobrar a mensalidade quem precisa dele é o meio de pagamento, na hora de cobrar.
        </Destaque>
      </Secao>

      <Secao n={3} titulo="O que a gente processa por você">
        <p>
          Tudo que a sua operação coloca no sistema: produtos, estoque, vendas, formas de
          pagamento, contas a pagar e receber, e o cadastro dos seus clientes — nome, telefone,
          e-mail, documento, endereço, histórico de compra, pontos e, se você usar crediário, o
          que está em aberto.
        </p>
        <p>
          Se o assistente estiver ligado, também as <b>conversas de WhatsApp</b> entre a sua loja e
          os seus clientes, e o que ele consultou para responder.
        </p>
        <p>
          A base legal para tudo isso é sua, não nossa: normalmente execução de contrato entre você
          e o seu cliente, ou legítimo interesse. Cabe a você informar isso a eles, e a gente ajuda
          com o que o sistema registra.
        </p>
      </Secao>

      <Secao n={4} titulo="Onde os dados ficam, e como uma empresa não vê a outra">
        <p>
          O banco de dados fica em <b>São Paulo, Brasil</b>. O sistema também roda em São Paulo —
          não é só privacidade, é o balcão não esperar uma ida e volta aos Estados Unidos a cada
          venda.
        </p>
        <p>O isolamento entre empresas tem duas paredes, e elas são independentes:</p>
        <Itens>
          <li>
            <b>No código</b> — nenhuma parte do sistema fala com o banco sem antes carimbar de que
            empresa é a requisição.
          </li>
          <li>
            <b>No próprio banco</b> — as tabelas têm segurança em nível de linha, ligada e
            forçada. Mesmo uma consulta que esquecesse o filtro volta vazia, porque o filtro não
            está no código: está no banco.
          </li>
        </Itens>
        <p>
          A parede de dentro é testada a cada mudança: existe um conjunto de testes que{' '}
          <i>tenta vazar de propósito</i> dado de uma empresa para outra, de vários jeitos, e
          precisa falhar em todos.
        </p>
        <p>
          A credencial que responde à tela de login — antes de existir sessão — enxerga apenas nove
          colunas de uma tabela: nome, endereço, logo e cor da empresa. Ela não alcança venda,
          cliente, usuário nem documento.
        </p>
      </Secao>

      <Secao n={5} titulo="Quem mais toca nos dados">
        <p>
          Para o Norte funcionar, alguns fornecedores tocam nos dados. Esta é a lista inteira, com
          o que cada um vê:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] border-collapse text-[14px]">
            <thead>
              <tr>
                {['Quem', 'O que vê', 'Onde'].map((t) => (
                  <th
                    key={t}
                    className="border-b border-borda pr-4 pb-2 text-left text-[11px] font-bold tracking-[0.12em] text-tinta-3 uppercase"
                  >
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SUBPROCESSADORES.map((s) => (
                <tr key={s.nome}>
                  <td className="border-b border-borda-suave py-3 pr-4 align-top font-semibold text-tinta">
                    {s.nome}
                  </td>
                  <td className="border-b border-borda-suave py-3 pr-4 align-top leading-relaxed">
                    {s.paraQue}
                  </td>
                  <td className="border-b border-borda-suave py-3 align-top whitespace-nowrap">
                    {s.decidido ? (
                      s.onde
                    ) : (
                      <span className="font-semibold text-atencao">a definir</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {indefinidos.length > 0 && (
          <p className="text-[13px] text-tinta-3">
            {indefinidos.length === 1 ? 'Um fornecedor ainda não foi escolhido' : `${indefinidos.length} fornecedores ainda não foram escolhidos`}
            . Esta lista é atualizada antes de qualquer um deles começar a operar, e a mudança é
            avisada com 30 dias.
          </p>
        )}
        <p>
          Nenhum deles pode usar os seus dados para outra coisa que não seja prestar o serviço que
          está na tabela. E nada é vendido, alugado ou cedido para publicidade — nunca.
        </p>
      </Secao>

      <Secao n={6} titulo="O assistente e a saída do Brasil">
        <p>
          Se você usar o assistente, existe uma transferência internacional, e ela merece um
          parágrafo próprio em vez de uma nota de rodapé:
        </p>
        <Destaque>
          Para responder, o assistente manda para o modelo de linguagem — que roda nos{' '}
          <b>Estados Unidos</b> — o trecho da conversa e apenas os dados que a pergunta exige: o
          saldo de uma peça, o total de um dia, o nome de um cliente que escreveu. Não é uma cópia
          do seu banco: é o pedaço necessário para aquela resposta.
        </Destaque>
        <Itens>
          <li>
            <b>Nada disso treina modelo.</b> É condição contratual com o fornecedor, não promessa
            nossa.
          </li>
          <li>
            A transferência se apoia em cláusulas contratuais padrão com o fornecedor, e acontece
            só enquanto o assistente estiver ligado.
          </li>
          <li>
            <b>Desligar o assistente encerra a transferência.</b> É uma chave em Configurações, e
            o resto do sistema continua inteiro.
          </li>
        </Itens>
      </Secao>

      <Secao n={7} titulo="Por quanto tempo">
        <Itens>
          <li>
            <b>Enquanto o contrato durar</b> — tudo fica, porque é disso que o sistema serve.
          </li>
          <li>
            <b>Acabou o contrato</b> — 30 dias para você exportar, e apagamos em até 90 dias,
            inclusive das cópias de segurança conforme o ciclo delas.
          </li>
          <li>
            <b>O que a lei manda guardar</b> — registro fiscal e registro de acesso ficam pelo
            prazo legal, e servem só para isso.
          </li>
          <li>
            <b>Cópias de segurança</b> — mantidas para o caso de perda ou erro, e descartadas no
            ciclo normal delas.
          </li>
        </Itens>
      </Secao>

      <Secao n={8} titulo="Os seus direitos">
        <p>
          A LGPD (art. 18) garante a você — e às pessoas cujos dados estão aqui — confirmar se
          existe tratamento, acessar, corrigir, anonimizar, bloquear, apagar, levar os dados para
          outro fornecedor, saber com quem foram compartilhados e revogar consentimento.
        </p>
        <p>
          Boa parte disso não precisa de pedido: dentro do sistema você já consegue ver, corrigir e
          apagar cadastro de cliente, e exportar o que é seu.
        </p>
        <p>
          Para o resto, escreva para <b>{EMPRESA.encarregadoEmail}</b>. A gente responde em até{' '}
          <b>15 dias</b>. Se o pedido for sobre um cliente da <i>sua</i> loja e chegar aqui, a gente
          encaminha para você e avisa quem pediu — porque nesse caso quem responde é você.
        </p>
      </Secao>

      <Secao n={9} titulo="Cookies">
        <p>
          O Norte usa cookie para duas coisas, e só: manter você logado, e lembrar se você prefere
          o tema claro ou o escuro. Não há cookie de publicidade, nem rastreador de terceiro, nem
          pixel de rede social. Por isso também não existe aquele aviso de cookies pedindo
          permissão — não há o que pedir.
        </p>
      </Secao>

      <Secao n={10} titulo="Segurança, e o que a gente faz quando dá errado">
        <p>
          Senha é guardada como resumo criptográfico com algoritmo lento, própria para senha —
          nunca em texto, e a gente não consegue ler a sua. Convite de equipe viaja como número
          aleatório, e o banco guarda só o resumo dele: se o banco vazar, os convites em aberto
          continuam inúteis. Todo tráfego é cifrado. O acesso é por papel, e cada ação fica no
          livro de auditoria.
        </p>
        <p>
          Se acontecer incidente que possa causar risco relevante a você ou aos seus clientes, a
          gente avisa <b>você</b> e a <b>ANPD</b>, dizendo o que aconteceu, que dado foi afetado, o
          que já foi feito e o que você precisa fazer. Sem enrolar e sem esperar ter todas as
          respostas para começar a contar.
        </p>
      </Secao>

      <Secao n={11} titulo="Encarregado e contato">
        <p>
          Encarregado pelo tratamento de dados:{' '}
          {EMPRESA.encarregado ? (
            <b>{EMPRESA.encarregado}</b>
          ) : (
            <b className="text-critico">[a designar]</b>
          )}{' '}
          — <b>{EMPRESA.encarregadoEmail}</b>.
        </p>
        <p>
          Para qualquer outro assunto: <b>{EMPRESA.email}</b>.
        </p>
      </Secao>

      <Secao n={12} titulo="Mudanças nesta política">
        <p>
          Mudança que afete o que a gente faz com os seus dados é avisada com <b>30 dias</b>, por
          e-mail e dentro do sistema, antes de valer. Versões anteriores ficam guardadas e podem
          ser pedidas.
        </p>
      </Secao>
    </PaginaLegal>
  )
}
