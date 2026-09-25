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
// scripts/preparar-banco.ts, a cifra da sessão do WhatsApp em
// src/servidor/cifra.ts, o "cliente nunca chega ao modelo" em
// src/servidor/assistente/conversa.ts, o "parar" em
// src/servidor/campanhas/casar.ts e a lista permanente de quem saiu em
// src/servidor/ofertas.ts, a anonimização em src/servidor/anonimizar.ts, o
// registro do acesso do suporte em src/servidor/pagina.ts
// (`registrarAcessoDeSuporte`), e a lista de quem mais toca nos dados em
// src/servidor/legal.ts.
//
// ── o que está entre colchetes ───────────────────────────────
// `<Pendente>` marca o que o jurídico precisa decidir ou o dono precisa
// confirmar. Aparece em vermelho na tela de propósito: melhor um buraco
// visível do que uma frase que parece pronta e não foi conferida.
//
// ── o que passou a existir, e o texto agora afirma ───────────
// (25/09/2026) O dono ANONIMIZA um cliente pela ficha (e o nosso suporte,
// pelo script scripts/anonimizar-cliente.ts, quando o pedido chega por
// e-mail); o "PARAR" grava uma saída PERMANENTE, que só o "VOLTAR" da própria
// pessoa desfaz; a ficha guarda o aceite de ofertas (sim/não, quando, por
// onde, quem anotou); e todo acesso do suporte vira linha no livro da loja.
// Apagar a EMPRESA inteira continua sendo por pedido.

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { PaginaLegal, Secao, Itens, Destaque } from '@/ui/PaginaLegal'
import { EMPRESA, SUBPROCESSADORES } from '@/servidor/legal'

export const metadata: Metadata = {
  title: 'Privacidade · Norte',
  description: 'Que dado a gente guarda, onde ele fica, quem mais toca nele e como você tira ele daqui.',
}

/** O que o jurídico ainda precisa decidir. Em vermelho, para ninguém confundir com texto pronto. */
function Pendente({ children }: { children: ReactNode }) {
  return <b className="text-critico">[{children}]</b>
}

const link = 'font-semibold text-marca hover:underline'

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
            coletado, para que serve e por quanto tempo fica é <b>você</b>, o controlador. A gente
            guarda e processa a mando seu, e nada além disso.
          </li>
        </Itens>
        <Destaque>
          Na prática: se um cliente <i>seu</i> pedir para ser apagado, quem decide é você. Na ficha
          do cliente, o dono da conta usa <b>Anonimizar este cliente</b>: some tudo que identifica
          a pessoa — nome, WhatsApp, e-mail, CPF, endereço, aniversário, observações e as conversas
          do WhatsApp com ela — e as vendas ficam, sem nome, pelo prazo que a lei fiscal manda
          guardar. Se preferir, peça a nós, e a gente faz a mando seu. Se o pedido chegar direto
          aqui, a gente avisa você e responde a quem pediu — o caminho está em{' '}
          <a href="/exclusao-de-dados" className={link}>
            Exclusão de dados
          </a>
          .
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
          Se você conectar o WhatsApp da loja, também as <b>mensagens</b> que chegam e saem por
          ele pelo Norte — as da sua equipe com o assistente, e as dos seus clientes com as
          campanhas e o recado automático —, e as fotos, vídeos e áudios que você sobe para as
          campanhas. A seção 6 explica esse caminho inteiro.
        </p>
        <p>
          A base legal para tudo isso é sua, não nossa: normalmente execução de contrato entre você
          e o seu cliente, legítimo interesse ou, para mensagem de oferta, o consentimento dele.
          Cabe a você informar isso a eles, e a gente ajuda com o que o sistema registra.
        </p>
      </Secao>

      <Secao n={4} titulo="Onde os dados ficam, e como uma empresa não vê a outra">
        <p>
          O banco de dados fica em <b>São Paulo, Brasil</b>. A hospedagem do sistema está sendo
          trocada, e o destino também é São Paulo — não é só privacidade, é o balcão não esperar
          uma ida e volta aos Estados Unidos a cada venda. Enquanto a troca não termina, a seção 5
          mostra as opções como <b>em definição</b>, com o lugar de cada uma.
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
          o que cada um vê e quando ele entra em cena:
        </p>
        <div className="relative overflow-x-auto">
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
                  <td className="w-[9.5rem] border-b border-borda-suave py-3 pr-4 align-top font-semibold text-tinta">
                    {s.nome}
                  </td>
                  <td className="border-b border-borda-suave py-3 pr-4 align-top leading-relaxed">
                    {s.paraQue}
                    {s.quando && <span className="block pt-1 text-[13px] text-tinta-3">{s.quando}</span>}
                  </td>
                  <td className="w-[9rem] border-b border-borda-suave py-3 align-top leading-relaxed">
                    {s.onde}
                    {!s.decidido && (
                      <span className="block pt-1 text-[12px] font-semibold text-atencao">
                        em definição
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {indefinidos.length > 0 && (
          <p className="text-[13px] text-tinta-3">
            Linhas <b>em definição</b> ainda podem mudar: das três hospedagens, só uma fica, e as
            outras saem da lista; o meio de pagamento ainda não foi escolhido. Esta lista é
            atualizada antes de um fornecedor novo começar a operar, e a mudança é avisada com 30
            dias.
          </p>
        )}
        <p>
          Nenhum deles pode usar os seus dados para outra coisa que não seja prestar o serviço que
          está na tabela. E nada é vendido, alugado ou cedido para publicidade — nunca.
        </p>
      </Secao>

      <Secao n={6} titulo="O WhatsApp: quem é quem, e por onde a mensagem passa">
        <p>
          O WhatsApp é onde a loja fala com a equipe e com os clientes, e é onde os dados dos
          clientes <i>da loja</i> mais circulam. Por isso ele tem uma seção só dele.
        </p>

        <p className="font-semibold text-tinta">Os papéis, pela LGPD</p>
        <Itens>
          <li>
            <b>A loja é a controladora</b> dos dados dos clientes dela: decide quem recebe
            mensagem, o que é dito e por quanto tempo a conversa fica. A conta de WhatsApp é da
            loja.
          </li>
          <li>
            <b>O Norte é operador</b>: guarda as conversas, roda as campanhas que a loja montou e
            entrega as mensagens, sempre a mando dela.
          </li>
          <li>
            <b>A Meta e a Anthropic são suboperadoras</b>: a Meta entrega as mensagens quando a
            loja usa o caminho oficial do WhatsApp; a Anthropic é o modelo do assistente, e só
            recebe conversas da equipe.
          </li>
          <li>
            Na conexão por QR Code, a mensagem passa pela rede do WhatsApp sob a conta e os termos
            que a própria loja aceitou com o WhatsApp.{' '}
            <Pendente>jurídico: enquadrar o papel do WhatsApp/Meta nesta conexão</Pendente>
          </li>
        </Itens>

        <p className="font-semibold text-tinta">Por onde cada mensagem passa</p>
        <Itens>
          <li>
            <b>Caminho oficial</b> (WhatsApp Business Platform): celular do cliente → Meta → Norte.
            A Meta vê o número, o nome de perfil e o conteúdo, e guarda pelo prazo dos termos dela.{' '}
            <Pendente>jurídico: conferir o prazo de guarda vigente nos termos da Meta</Pendente>
          </li>
          <li>
            <b>Conexão por QR Code</b>: celular do cliente → rede do WhatsApp → o WhatsApp da loja →
            o nosso conector → Norte. O conector é um serviço nosso: não grava texto de mensagem nem
            número inteiro em registro, e a sessão do WhatsApp da loja fica no nosso banco{' '}
            <b>cifrada</b>, presa àquela empresa.
          </li>
          <li>
            <b>Mensagem de cliente nunca vai para a inteligência artificial.</b> Ela vai para as
            campanhas, que têm roteiro fixo escrito pela loja, ou para o recado automático, também
            de texto fixo. Se nenhuma das duas tratar, o assistente fica calado e quem responde é
            uma pessoa da loja.
          </li>
          <li>
            <b>Conversa da equipe com o assistente</b> vai ao modelo de linguagem, nos Estados
            Unidos — veja a seção 7.
          </li>
        </Itens>

        <p className="font-semibold text-tinta">O que o Norte guarda</p>
        <Itens>
          <li>A conversa: telefone, nome (quando existe), texto e o que foi enviado em cada mensagem.</li>
          <li>Em que campanha a pessoa entrou, em que passo está e quando saiu.</li>
          <li>As fotos, vídeos e áudios que a loja subiu para as campanhas.</li>
          <li>Na conexão por QR Code, a sessão do WhatsApp da loja — cifrada.</li>
          <li>
            Na ficha do cliente, o <b>aceite de ofertas no WhatsApp</b>: se a pessoa aceitou ou não,
            quando, por qual caminho (balcão, ficha em papel, site, WhatsApp, telefone) e quem da
            loja anotou. A versão do texto do aceite fica no livro de auditoria.
          </li>
          <li>
            A <b>lista de quem pediu para não receber ofertas</b> daquela loja: só o número reduzido
            a DDD e oito últimos dígitos, a data e o motivo. Ela vale também para quem nunca foi
            cadastrado, e fica mesmo depois de uma anonimização — é o que impede de escrever de novo
            a quem pediu para sair.
          </li>
        </Itens>

        <p className="font-semibold text-tinta">Saída do Brasil</p>
        <p>
          Pelo caminho oficial, a mensagem é tratada nos servidores da Meta, fora do Brasil. Pela
          conexão por QR Code, ela passa pela rede do WhatsApp, também fora. Essa transferência
          internacional se apoia em <Pendente>a definir pelo jurídico: cláusulas-padrão da ANPD</Pendente>.
        </p>

        <p className="font-semibold text-tinta">Por quanto tempo</p>
        <Itens>
          <li>
            <b>Desconectar o WhatsApp</b> apaga a sessão guardada na hora. As conversas já
            gravadas continuam no histórico da loja, porque são dela.
          </li>
          <li>
            <b>Conversas e mídias</b> ficam enquanto o contrato durar, e seguem a seção 8 quando
            ele acabar — ou saem antes, se a loja pedir.
          </li>
        </Itens>

        <p className="font-semibold text-tinta">Os direitos de quem é cliente da loja</p>
        <Itens>
          <li>
            Mandar <b>PARAR</b> (ou pare, sair, stop — e, dentro de uma campanha, também cancelar
            ou não quero) sozinho numa mensagem tira a pessoa da campanha em andamento na hora e
            põe o número na lista de quem não recebe ofertas daquela loja, <b>de forma
            permanente</b>. Ela recebe uma única confirmação, que já diz como voltar. Nenhuma
            campanha começa de novo para esse número — nem com a palavra-chave — até a própria
            pessoa mandar <b>VOLTAR</b>. A loja não consegue desfazer um PARAR pela tela.
          </li>
          <li>
            Mensagem de oferta que a <b>loja</b> começa, sem a pessoa ter escrito agora, só sai
            para quem tem o aceite registrado na ficha e não está na lista.
          </li>
          <li>
            Para acessar, corrigir ou apagar os dados, o primeiro caminho é a própria loja, que é
            quem decide. A pessoa também pode escrever direto para o nosso encarregado, em{' '}
            <b>{EMPRESA.encarregadoEmail}</b>: a gente avisa a loja e responde a quem pediu.
          </li>
          <li>
            O passo a passo, e o que a lei obriga a guardar mesmo depois de um pedido, está em{' '}
            <a href="/exclusao-de-dados" className={link}>
              Exclusão de dados
            </a>
            .
          </li>
        </Itens>
      </Secao>

      <Secao n={7} titulo="O assistente e a saída do Brasil">
        <p>
          Se você usar o assistente, existe uma transferência internacional, e ela merece um
          parágrafo próprio em vez de uma nota de rodapé:
        </p>
        <Destaque>
          Para responder a você e à sua equipe, o assistente manda para o modelo de linguagem —
          que roda nos <b>Estados Unidos</b> — o trecho da conversa e apenas os dados que a
          pergunta exige: o saldo de uma peça, o total de um dia. Não é uma cópia do seu banco: é o
          pedaço necessário para aquela resposta. <b>Mensagem de cliente não vai para o modelo</b>:
          campanha e recado automático têm texto fixo e não usam IA.
        </Destaque>
        <Itens>
          <li>
            <b>Nada disso treina modelo.</b> É condição contratual com o fornecedor, não promessa
            nossa.
          </li>
          <li>
            A transferência se apoia em{' '}
            <Pendente>a definir pelo jurídico: cláusulas-padrão da ANPD</Pendente>, e acontece só
            enquanto o assistente estiver ligado.
          </li>
          <li>
            <b>Desligar o assistente encerra a transferência.</b> É uma chave em Configurações, e
            o resto do sistema continua inteiro.
          </li>
        </Itens>
      </Secao>

      <Secao n={8} titulo="Por quanto tempo">
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

      <Secao n={9} titulo="Os seus direitos">
        <p>
          A LGPD (art. 18) garante a você — e às pessoas cujos dados estão aqui — confirmar se
          existe tratamento, acessar, corrigir, anonimizar, bloquear, apagar, levar os dados para
          outro fornecedor, saber com quem foram compartilhados e revogar consentimento.
        </p>
        <p>
          Parte disso não precisa de pedido: dentro do sistema você já consegue ver, corrigir,
          desativar e <b>anonimizar</b> cadastro de cliente, registrar e revogar o aceite dele para
          ofertas, e exportar o que é seu. Apagar a conta da sua empresa inteira é por pedido, e o
          caminho está em{' '}
          <a href="/exclusao-de-dados" className={link}>
            Exclusão de dados
          </a>
          .
        </p>
        <p>
          Para o resto, escreva para <b>{EMPRESA.encarregadoEmail}</b>. A gente responde em até{' '}
          <b>15 dias</b>. Se o pedido for sobre um cliente da <i>sua</i> loja e chegar aqui, a gente
          avisa você e responde a quem pediu — porque nesse caso quem decide é você.
        </p>
      </Secao>

      <Secao n={10} titulo="Cookies">
        <p>
          O Norte usa cookie para duas coisas, e só: manter você logado, e lembrar se você prefere
          o tema claro ou o escuro. Não há cookie de publicidade, nem rastreador de terceiro, nem
          pixel de rede social. Por isso também não existe aquele aviso de cookies pedindo
          permissão — não há o que pedir.
        </p>
      </Secao>

      <Secao n={11} titulo="Segurança, e o que a gente faz quando dá errado">
        <p>
          Senha é guardada como resumo criptográfico com algoritmo lento, própria para senha —
          nunca em texto, e a gente não consegue ler a sua. Convite de equipe viaja como número
          aleatório, e o banco guarda só o resumo dele: se o banco vazar, os convites em aberto
          continuam inúteis. A sessão do WhatsApp conectado por QR Code e as chaves de conta de
          WhatsApp são guardadas cifradas, com a chave fora do banco. Todo tráfego é cifrado. O
          acesso é por papel, e cada ação fica no livro de auditoria, que só recebe linha nova —
          não se edita nem se apaga. A única exceção é a anonimização de um cliente: nas linhas
          sobre ele, o nome e os dados pessoais saem, e o que foi feito, por quem e quando fica.
        </p>
        <p>
          O acesso da <b>nossa equipe de suporte</b> à sua empresa é só leitura, tem prazo e motivo
          registrados, e <b>cada tela que ela abre e cada ação que ela tenta vira uma linha no livro
          de auditoria da sua empresa</b> — com o endereço aberto, o motivo do acesso e a hora —,
          que você lê na tela Auditoria, na ficha &quot;suporte do Norte&quot;. Se a linha não
          puder ser gravada, o acesso é recusado.
        </p>
        <p>
          Se acontecer incidente que possa causar risco relevante a você ou aos seus clientes, a
          gente avisa <b>você</b> e a <b>ANPD</b>, dizendo o que aconteceu, que dado foi afetado, o
          que já foi feito e o que você precisa fazer. Sem enrolar e sem esperar ter todas as
          respostas para começar a contar.
        </p>
      </Secao>

      <Secao n={12} titulo="Encarregado e contato">
        <p>
          Encarregado pelo tratamento de dados:{' '}
          {EMPRESA.encarregado ? <b>{EMPRESA.encarregado}</b> : <Pendente>a designar</Pendente>} —{' '}
          <b>{EMPRESA.encarregadoEmail}</b>.
        </p>
        <p>
          Para qualquer outro assunto: <b>{EMPRESA.email}</b>.
        </p>
      </Secao>

      <Secao n={13} titulo="Mudanças nesta política">
        <p>
          Mudança que afete o que a gente faz com os seus dados é avisada com <b>30 dias</b>, por
          e-mail e dentro do sistema, antes de valer. Versões anteriores ficam guardadas e podem
          ser pedidas.
        </p>
        <p className="text-[13px] text-tinta-3">
          Veja também os{' '}
          <a href="/termos" className={link}>
            Termos de uso
          </a>{' '}
          e as instruções de{' '}
          <a href="/exclusao-de-dados" className={link}>
            exclusão de dados
          </a>
          .
        </p>
      </Secao>
    </PaginaLegal>
  )
}
