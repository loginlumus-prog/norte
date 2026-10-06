// Os termos de uso.
//
// ── a régra que valeu para escrever isto ─────────────────────
// Cada cláusula descreve uma coisa que o sistema REALMENTE faz. O teto de
// desconto existe no banco; as respostas do assistente são contadas uma a uma; a
// suspensão por falta de pagamento tem estado próprio na tabela. Contrato que
// promete o que o código não faz é armadilha para o lado que escreveu.
//
// Onde a decisão ainda não foi tomada — meio de pagamento, hospedagem — o
// texto diz isso, em vez de inventar. Ver src/servidor/legal.ts.
//
// ── a cláusula 8 (WhatsApp e campanhas) ──────────────────────
// Escrita para a entrada do Norte como provedor de tecnologia da Meta: a
// conta de WhatsApp é da loja, a loja paga a Meta direto, a loja responde
// pelo consentimento de quem recebe oferta. O "parar" citado lá existe em
// src/servidor/campanhas/casar.ts, e a saída permanente (com o VOLTAR) e o
// registro do aceite na ficha em src/servidor/ofertas.ts; o ritmo e a
// ausência de envio em massa da conexão por QR Code estão no README
// ("Conector do WhatsApp"). O registro do acesso do suporte (cláusula 9)
// está em src/servidor/pagina.ts (`registrarAcessoDeSuporte`).
//
// `<Pendente>` marca o que o jurídico precisa decidir — em vermelho na tela.
//
// Isto NÃO é peça de advogado, e a página diz isso enquanto a identidade de
// quem assina não estiver preenchida.

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { PaginaLegal, Secao, Itens, Destaque } from '@/ui/PaginaLegal'
import { EMPRESA } from '@/servidor/legal'
import { PLANOS, PRECOS, milhar } from '@/servidor/planos'

export const metadata: Metadata = {
  title: 'Termos de uso · Norte',
  description: 'O que a gente entrega, o que você paga e o que acontece quando algo dá errado.',
}

const real = (n: number) => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2 })}`

/** O que o jurídico ainda precisa decidir. Em vermelho, para ninguém confundir com texto pronto. */
function Pendente({ children }: { children: ReactNode }) {
  return <b className="text-critico">[{children}]</b>
}

const link = 'font-semibold text-marca hover:underline'

export default function Termos() {
  return (
    <PaginaLegal
      titulo="Termos de uso"
      resumo="O que a gente entrega, o que você paga, o que é seu, e o que acontece quando alguma coisa dá errado. Escrito para ser lido — se alguma parte precisar de tradução, ela está mal escrita e a gente quer saber."
    >
      <Secao n={1} titulo="Quem é quem">
        <p>
          <b>Norte</b> é um sistema de gestão para comércio, com um assistente no WhatsApp que
          conversa com você e a sua equipe e roda campanhas de roteiro fixo para os seus
          clientes. Ele é operado por{' '}
          {EMPRESA.razaoSocial ? (
            <b>
              {EMPRESA.razaoSocial}, CNPJ {EMPRESA.cnpj}
            </b>
          ) : (
            <b className="text-critico">[razão social e CNPJ a preencher]</b>
          )}
          , daqui em diante “a gente”.
        </p>
        <p>
          <b>Você</b> é a empresa que contrata — não a pessoa que clica. Quem aceita estes termos
          declara que pode assinar pela empresa.
        </p>
        <p>
          Contratar é ato de empresa, para uso profissional. Isto não é relação de consumo: você
          não é destinatário final do serviço, você usa o Norte para tocar o seu negócio.
        </p>
      </Secao>

      <Secao n={2} titulo="O endereço da sua empresa">
        <p>
          Cada empresa entra pelo próprio endereço, e o login acontece dentro dele. Isso não é
          estética: é o que garante que nunca exista busca de usuário atravessando empresas.
        </p>
        <p>
          O endereço é escolhido no cadastro e fica reservado enquanto o contrato estiver de pé.
          Alguns nomes são do sistema e não podem ser usados. A gente pode recusar ou trocar um
          endereço que imite marca de terceiro ou induza a erro — avisando antes, salvo ordem
          judicial.
        </p>
      </Secao>

      <Secao n={3} titulo="Planos e preço">
        {/* Os números saem de `PRECOS` e `PLANOS` (servidor/planos.ts), a
            mesma fonte da página de venda e da tela de Assinatura: contrato
            com número digitado à mão é contrato que diverge da tabela. */}
        <p>
          A tabela, por mês. São dois planos, o <b>{PLANOS.BALCAO.titulo}</b> e o{' '}
          <b>{PLANOS.BALCAO_AGENTE.titulo}</b>, e o que se paga é a loja; o assistente vem dentro do plano. O que
          vale para a empresa inteira entra por cima, só se você contratar.
        </p>
        <Itens>
          <li>
            <b>{PLANOS.BALCAO.titulo}</b> — {real(PRECOS.essencial)}/mês a primeira loja e{' '}
            {real(PRECOS.essencialLojaExtra)}/mês cada loja a mais, com o assistente básico (relatório,
            avisos e {milhar(PRECOS.respostasEssencial)} respostas por mês; ele consulta, não lança).
          </li>
          <li>
            <b>{PLANOS.BALCAO_AGENTE.titulo}</b> — {real(PRECOS.profissional)}/mês a primeira loja e{' '}
            {real(PRECOS.profissionalLojaExtra)}/mês cada loja a mais, com todos os módulos e o assistente
            completo ({milhar(PRECOS.respostasProfissional)} respostas por mês).
          </li>
          <li>
            Nos dois, cada loja a mais soma {milhar(PRECOS.respostasPorLojaExtra)} respostas ao mês. Depósito
            não entra na conta. Cadastrar a equipe inteira não tem custo, e não há limite de pessoas dentro
            ao mesmo tempo.
          </li>
          <li>
            <b>Pacotes de respostas</b> — +{milhar(PRECOS.pacoteRespostas)} por {real(PRECOS.pacotePreco)} ou +
            {milhar(PRECOS.pacoteGrandeRespostas)} por {real(PRECOS.pacoteGrandePreco)}, que valem para o mês
            em que entram (cláusula 7).
          </li>
          <li>
            <b>Fábrica</b> — {real(PRECOS.fabrica)}/mês no {PLANOS.BALCAO_AGENTE.titulo}, uma vez para a
            empresa, com quantas unidades de fábrica ela tiver.
          </li>
          <li>
            <b>Farol</b> — {real(PRECOS.farolMarca)}/mês a primeira marca e{' '}
            {real(PRECOS.farolMarcaExtra)}/mês cada marca a mais.
          </li>
          <li>
            <b>{PLANOS.CORPORATIVO.titulo}</b> — preço fechado caso a caso, em contrato próprio que
            complementa este.
          </li>
        </Itens>
        <p>
          A loja a mais tem preço de tabela, e a tela diz o valor e a conta nova antes de abrir: o que
          está escrito aqui é o que se paga. Implantação — trazer dados de outro sistema, por exemplo —
          é cobrada uma vez só quando houver, com o valor combinado por escrito antes de começar.
          Serviços anunciados como “em breve” não fazem parte deste contrato até entrarem na tabela.
        </p>
        <p>
          Existe também o plano <b>{PLANOS.GRATIS.titulo}</b>, que não se contrata: é onde a empresa
          fica quando o teste acaba sem assinatura. Uma loja, uma pessoa dentro por vez, sem nota
          fiscal e sem assistente, com teto de {PLANOS.GRATIS.tetoVendasMes} vendas por mês. Ele não
          vira cobrança sozinho — mas também não tem suporte garantido, e pode ser descontinuado com
          30 dias de aviso. Seus dados continuam seus, e a cláusula 12 vale igual.
        </p>
        <p>
          O preço pode ser reajustado uma vez a cada doze meses, com <b>30 dias</b> de aviso. Se o
          novo preço não servir para você, pode cancelar antes de ele valer, sem multa.
        </p>
      </Secao>

      <Secao n={4} titulo="Teste">
        <p>
          Empresa criada pelo site começa em teste por <b>{PRECOS.diasDeTeste} dias</b>, com o
          sistema inteiro — não é versão capada. O assistente vem junto, com{' '}
          {milhar(PRECOS.respostasDoTeste)} respostas para o teste inteiro. O teste não pede cartão e
          não vira cobrança sozinho.
        </p>
        <p>
          Acabado o prazo sem contratação, a empresa passa para o plano {PLANOS.GRATIS.titulo}{' '}
          (cláusula 3): o que ele não inclui desliga, e os dados ficam todos. Contratando, durante ou
          depois do teste, o que foi lançado continua.
        </p>
      </Secao>

      <Secao n={5} titulo="Pagamento">
        <p>
          A mensalidade é cobrada no mesmo dia de cada mês, adiantada. A cobrança é feita por um
          meio de pagamento contratado por nós.
        </p>
        <Destaque>
          <b>A gente não guarda dado de pagamento.</b> Cartão, conta bancária e afins vão direto
          para o meio de pagamento e nunca passam pelo Norte. Nem no cadastro, nem no banco de
          dados, nem em registro de sistema. É decisão de arquitetura: dado que não existe aqui não
          vaza daqui.
        </Destaque>
      </Secao>

      <Secao n={6} titulo="Atraso, suspensão e cancelamento">
        <p>Se a mensalidade atrasar, nesta ordem:</p>
        <Itens>
          <li>
            <b>Do 1º ao 10º dia</b> — o sistema funciona normalmente, e a gente avisa dentro dele.
          </li>
          <li>
            <b>Do 11º ao 30º dia</b> — a conta fica suspensa. Ninguém entra, e nada é apagado.
          </li>
          <li>
            <b>Depois de 30 dias</b> — o contrato pode ser encerrado por nós, e vale a cláusula 12.
          </li>
        </Itens>
        <p>
          Valor em atraso tem multa de 2% e juros de 1% ao mês, proporcionais aos dias. Você pode
          cancelar quando quiser, sem multa e sem prazo de fidelidade: o serviço vale até o fim do
          período já pago, e não há devolução proporcional dele.
        </p>
      </Secao>

      <Secao n={7} titulo="O assistente e as respostas">
        <p>
          O assistente vem com o plano e vale para a empresa inteira: básico no{' '}
          {PLANOS.BALCAO.titulo}, completo no {PLANOS.BALCAO_AGENTE.titulo}. Ele é medido em <b>respostas</b> — cada mensagem que ele escreve com
          inteligência artificial para você ou a sua equipe conta uma. Relatórios, avisos, recado
          automático e campanhas são texto fixo e não contam.
        </p>
        <Itens>
          <li>
            O mês vem com {milhar(PRECOS.respostasEssencial)} respostas no {PLANOS.BALCAO.titulo} e{' '}
            {milhar(PRECOS.respostasProfissional)} no {PLANOS.BALCAO_AGENTE.titulo}, mais{' '}
            {milhar(PRECOS.respostasPorLojaExtra)} por loja a mais. O mês é o de
            calendário, no horário de Brasília, e a franquia volta no dia 1º; o que sobra não passa
            para o mês seguinte.
          </li>
          <li>
            Acabaram as respostas, o assistente para de responder até o dia 1º ou até um pacote
            avulso (+{milhar(PRECOS.pacoteRespostas)} por {real(PRECOS.pacotePreco)} ou +
            {milhar(PRECOS.pacoteGrandeRespostas)} por {real(PRECOS.pacoteGrandePreco)}, para o mês em que
            entra). O resto do sistema continua inteiro, e a tela avisa quando faltam 10%.
          </li>
          <li>
            Para proteger o serviço de uso fora do normal, existe também um limite de uso de
            inteligência artificial por mês, calculado para cobrir as respostas contratadas em uso
            comum. Atingido antes do fim das respostas, o assistente para e a tela diz isso, com as
            mesmas saídas: o dia 1º ou um pacote.
          </li>
          <li>Pacote é avulso e opcional, sem virar mensalidade nova.</li>
        </Itens>
        <Destaque>
          <b>O assistente propõe; quem decide é você.</b> Toda ação que mexe em dinheiro, estoque
          ou cadastro passa por confirmação de uma pessoa da sua equipe, dentro dos limites que
          você definir — inclusive o teto de desconto. Ele responde a partir dos seus dados e pode
          errar, como qualquer sistema que gera texto. <b>Conferir antes de confirmar é seu.</b>
        </Destaque>
        <p>
          O assistente fala pelo WhatsApp da loja, e a cláusula 8 vale para ele também.
        </p>
      </Secao>

      <Secao n={8} titulo="WhatsApp e campanhas">
        <p>
          O Norte conversa com a sua equipe e com os seus clientes pelo WhatsApp da loja. Há dois
          jeitos de conectar, e as regras abaixo valem para os dois, salvo onde está dito.
        </p>

        <p className="font-semibold text-tinta">8.1 A conta é sua</p>
        <Itens>
          <li>
            O número e a conta de WhatsApp são <b>da loja</b>, não do Norte. A gente conecta,
            guarda as conversas e roda as campanhas a seu mando; desconectar é um botão, e o número
            continua seu.
          </li>
          <li>
            Na <b>conexão oficial</b> (WhatsApp Business Platform, da Meta), você aceita os termos
            e as políticas do WhatsApp para empresas direto com a Meta, e{' '}
            <b>paga à Meta, direto, as mensagens que ela cobra</b>, pela forma de pagamento que você
            cadastra na conta da Meta. O Norte não revende, não intermedeia e não embute esse custo
            na mensalidade.
          </li>
        </Itens>

        <p className="font-semibold text-tinta">8.2 O conteúdo e o consentimento são seus</p>
        <Itens>
          <li>
            Você responde pelo que as suas campanhas, o seu recado automático e a sua equipe
            dizem: preço, oferta, prazo, promessa. O Norte entrega o texto que você escreveu.
          </li>
          <li>
            Antes de <b>começar</b> uma conversa de oferta com alguém, você precisa ter o{' '}
            <b>consentimento</b> dessa pessoa para receber mensagens da loja no WhatsApp, e
            conseguir mostrar quando e como ela deu. Conversa que o próprio cliente começou não
            vira autorização para mandar oferta depois. A gente fornece um modelo de texto de
            consentimento, e a ficha do cliente tem onde registrar o aceite — sim ou não, quando,
            por qual caminho e quem anotou. O sistema só deixa sair oferta começada pela loja
            (fora da conversa aberta pela pessoa) para quem tem o aceite registrado.
          </li>
          <li>
            Quem pedir para sair sai. Mandar <b>PARAR</b> sozinho numa mensagem encerra a campanha
            em andamento na hora e põe o número na lista de quem não recebe ofertas da sua loja, de
            forma permanente: nenhuma campanha começa de novo para ele até a própria pessoa mandar{' '}
            <b>VOLTAR</b>, e a loja não desfaz isso pela tela. Qualquer outro pedido de saída, por
            qualquer canal, você precisa respeitar também — anotando o número na lista, em
            Clientes › Sem ofertas, ou marcando &quot;não aceitou&quot; na ficha.
          </li>
        </Itens>

        <p className="font-semibold text-tinta">8.3 O que é proibido</p>
        <Itens>
          <li>
            Mensagem em massa não pedida (spam), lista de contatos comprada, alugada ou raspada, e
            contato com quem pediu para não receber.
          </li>
          <li>
            Oferecer produto ou serviço proibido pela Política Comercial do WhatsApp ou pela
            Política de Mensagens para Empresas do WhatsApp — e, claro, qualquer coisa ilegal.
          </li>
          <li>Conteúdo enganoso, discriminatório, ofensivo, ou que se passe por outra empresa ou pessoa.</li>
        </Itens>

        <p className="font-semibold text-tinta">8.4 Quando a gente pausa uma campanha</p>
        <p>
          A gente pode <b>pausar</b> uma campanha, ou o envio inteiro da loja, quando ela puser o
          número em risco — muitas denúncias ou bloqueios, queda da qualidade do número apontada
          pelo WhatsApp, ou descumprimento desta cláusula. A gente avisa você, diz o motivo e
          religa quando o motivo acabar. Pausar não apaga nada. Em descumprimento grave ou
          repetido, a gente pode encerrar o contrato, avisando por escrito — e os seus dados
          seguem a cláusula 12.
        </p>

        <p className="font-semibold text-tinta">
          8.5 A conexão por QR Code{' '}
          <Pendente>jurídico: avaliar se mantém após a conexão oficial</Pendente>
        </p>
        <p>
          Como alternativa, dá para conectar o WhatsApp da loja lendo um QR Code, do jeito do
          WhatsApp Web. Ela é oferecida a pedido seu, e com um aviso que precisa ser lido:
        </p>
        <Destaque>
          <b>A conexão por QR Code não é a API oficial do WhatsApp.</b> Os termos do WhatsApp não
          preveem automação por esse caminho, e o WhatsApp pode <b>restringir ou banir o número</b>{' '}
          a qualquer momento, sem aviso. O Norte reduz o risco — responde só a quem chamou, manda
          em ritmo de gente e não tem envio em massa —, mas não consegue eliminá-lo. Ao escolher
          essa conexão você assume esse risco, e <b>o Norte não responde</b> por restrição,
          banimento ou perda do número, nem pelo que isso causar ao seu negócio. Use um número da
          loja, nunca o pessoal.
        </Destaque>

        <p className="font-semibold text-tinta">8.6 Quando o WhatsApp muda as regras</p>
        <p>
          O WhatsApp é de outra empresa, que muda regras e preços por conta própria. Mudança de
          regra, de preço ou bloqueio vindo do WhatsApp não é descumprimento nosso — mas, na
          conexão oficial, se o canal ficar indisponível por mais de <b>15 dias seguidos</b> por
          motivo que não seja o conteúdo ou o comportamento da loja, você pode cancelar sem multa.
        </p>
      </Secao>

      <Secao n={9} titulo="O que é seu, e o que é nosso">
        <p>
          <b>Seu:</b> todo dado que entra no sistema — produtos, vendas, clientes, contas,
          conversas. A gente não vende, não aluga e não usa dado de cliente para treinar modelo de
          IA. Só olhamos quando você pede suporte, com um acesso só de leitura, com prazo e motivo,
          e cada tela que a nossa equipe abre fica registrada, sozinha, no livro de auditoria da
          sua empresa — você vê o que foi olhado, quando e por quê, na tela Auditoria.
        </p>
        <p>
          <b>Nosso:</b> o sistema — código, telas, marca, textos. Contratar dá direito de usar
          enquanto o contrato durar, e mais nada: não dá direito de copiar, revender, hospedar
          cópia nem tirar o código.
        </p>
      </Secao>

      <Secao n={10} titulo="O que fica com você">
        <Itens>
          <li>
            Cumprir a lei no seu negócio: emissão de nota, obrigação fiscal, trabalhista e de
            defesa do consumidor. O Norte é ferramenta, não é contador.
          </li>
          <li>
            Cuidar de quem entra: cada pessoa da equipe tem senha própria e papel próprio. Senha
            compartilhada é responsabilidade sua, e a auditoria vai mostrar o nome de quem
            emprestou.
          </li>
          <li>
            Ser o controlador dos dados dos <i>seus</i> clientes — inclusive base de contato e
            consentimento para falar com eles no WhatsApp (cláusula 8), e responder aos pedidos
            deles. Ver a{' '}
            <a href="/privacidade" className={link}>
              Política de Privacidade
            </a>{' '}
            e as instruções de{' '}
            <a href="/exclusao-de-dados" className={link}>
              exclusão de dados
            </a>
            .
          </li>
          <li>Não usar o sistema para o que é ilegal, nem para mandar mensagem não pedida em massa.</li>
        </Itens>
      </Secao>

      <Secao n={11} titulo="Disponibilidade, suporte e falhas">
        <p>
          A gente trabalha para o sistema ficar no ar o tempo todo, mas não promete um número que
          não pode garantir sozinho: parte da infraestrutura é de terceiros. Não há SLA contratado
          nos planos de tabela — o Corporativo pode ter um, em contrato próprio.
        </p>
        <p>
          Manutenção programada é avisada com antecedência e feita no horário de menor movimento.
          Suporte é por {EMPRESA.email}, em dias úteis.
        </p>
        <p>
          A gente responde por prejuízo direto e comprovado que tenha sido causado por nós, até o
          total pago por você nos <b>12 meses</b> anteriores ao fato. Não respondemos por lucro
          cessante, por dado que você mesmo apagou, nem por queda de serviço de terceiro. Nada aqui
          limita responsabilidade por dolo ou por aquilo que a lei não deixa limitar.
        </p>
      </Secao>

      <Secao n={12} titulo="Quando acabar, os dados são seus">
        <p>Encerrado o contrato, por qualquer lado e por qualquer motivo:</p>
        <Itens>
          <li>
            Você tem <b>30 dias</b> para exportar tudo, em formato aberto. É só pedir por{' '}
            {EMPRESA.email} — e a gente responde em até 5 dias úteis.
          </li>
          <li>
            Passados os 30 dias, os dados são apagados em até <b>90 dias</b>, inclusive das cópias
            de segurança conforme o ciclo delas.
          </li>
          <li>
            O que a lei manda guardar (registro fiscal, registro de acesso) fica pelo prazo legal,
            e só para isso.
          </li>
        </Itens>
        <p>Cancelar não é castigo: a gente devolve seus dados sem discutir, e sem pedir motivo.</p>
      </Secao>

      <Secao n={13} titulo="Mudanças nestes termos">
        <p>
          Mudança que afete o que você paga ou o que você recebe é avisada com <b>30 dias</b>, por
          e-mail e dentro do sistema. Continuar usando depois disso vale como aceite; se não
          servir, cancele antes sem multa. Correção de erro de escrita e ajuste que só favoreça
          você valem na hora.
        </p>
        <p>Toda versão anterior fica guardada e pode ser pedida.</p>
      </Secao>

      <Secao n={14} titulo="Foro">
        <p>
          Vale a lei brasileira. Antes de processo, as partes se comprometem a tentar resolver
          direto, por escrito, por 30 dias. Fica eleito o foro de {EMPRESA.foro}.
        </p>
        <p className="text-[13px] text-tinta-3">
          Veja também a{' '}
          <a href="/privacidade" className={link}>
            Política de Privacidade
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
