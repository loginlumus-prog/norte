// Os termos de uso.
//
// ── a régra que valeu para escrever isto ─────────────────────
// Cada cláusula descreve uma coisa que o sistema REALMENTE faz. O teto de
// desconto existe no banco; o crédito de IA é medido consumo a consumo; a
// suspensão por falta de pagamento tem estado próprio na tabela. Contrato que
// promete o que o código não faz é armadilha para o lado que escreveu.
//
// Onde a decisão ainda não foi tomada — meio de pagamento, canal de WhatsApp —
// o texto diz isso, em vez de inventar. Ver src/servidor/legal.ts.
//
// Isto NÃO é peça de advogado, e a página diz isso enquanto a identidade de
// quem assina não estiver preenchida.

import type { Metadata } from 'next'
import { PaginaLegal, Secao, Itens, Destaque } from '@/ui/PaginaLegal'
import { EMPRESA } from '@/servidor/legal'
import { PLANOS, PLANOS_COM_PRECO } from '@/servidor/planos'

export const metadata: Metadata = {
  title: 'Termos de uso · Norte',
  description: 'O que a gente entrega, o que você paga e o que acontece quando algo dá errado.',
}

const real = (n: number) => `R$ ${n.toLocaleString('pt-BR')}`

export default function Termos() {
  return (
    <PaginaLegal
      titulo="Termos de uso"
      resumo="O que a gente entrega, o que você paga, o que é seu, e o que acontece quando alguma coisa dá errado. Escrito para ser lido — se alguma parte precisar de tradução, ela está mal escrita e a gente quer saber."
    >
      <Secao n={1} titulo="Quem é quem">
        <p>
          <b>Norte</b> é um sistema de gestão para comércio, com um assistente que atende no
          WhatsApp. Ele é operado por{' '}
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
        <p>Os planos com preço de tabela, por mês:</p>
        <Itens>
          {PLANOS_COM_PRECO.map((p) => {
            const l = PLANOS[p]
            return (
              <li key={p}>
                <b>{l.titulo}</b> — {real(l.mensal!)}/mês.{' '}
                {l.unidades === null ? 'Lojas sem limite' : `Até ${l.unidades} loja(s)`}, e{' '}
                {l.vagas === null
                  ? 'sem limite de pessoas dentro ao mesmo tempo'
                  : `${l.vagas} pessoa(s) dentro ao mesmo tempo`}
                . Cadastrar a equipe inteira não tem custo em nenhum plano.
                {l.porVagaExtra ? ` Pessoa a mais ao mesmo tempo: ${real(l.porVagaExtra)}/mês cada.` : ''}
                {l.creditoMensal > 0 ? ` Inclui ${real(l.creditoMensal)} de crédito de IA por mês.` : ''}
              </li>
            )
          })}
          <li>
            <b>{PLANOS.CORPORATIVO.titulo}</b> — preço fechado caso a caso, em contrato próprio que
            complementa este.
          </li>
        </Itens>
        <p>
          Existe também o plano <b>Grátis</b>: uma loja, uma pessoa dentro por vez, sem nota
          fiscal e sem assistente, com teto de {PLANOS.GRATIS.tetoVendasMes} vendas por mês. Ele
          não tem prazo para acabar e não vira cobrança sozinho — mas também não tem suporte
          garantido, e pode ser descontinuado com 30 dias de aviso. Seus dados continuam seus, e a
          cláusula 11 vale igual.
        </p>
        <p>
          Não existe taxa de implantação, e pessoa a mais tem preço de tabela: o que está escrito
          aqui é o que se paga.
        </p>
        <p>
          O preço pode ser reajustado uma vez a cada doze meses, com <b>30 dias</b> de aviso. Se o
          novo preço não servir para você, pode cancelar antes de ele valer, sem multa.
        </p>
      </Secao>

      <Secao n={4} titulo="Teste">
        <p>
          Empresa nova começa em teste, com o prazo dito na hora da criação. No teste o sistema é
          inteiro — não é versão capada. Acabado o prazo sem contratação, a conta é suspensa
          conforme a cláusula 6, e os dados seguem a cláusula 11.
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
            <b>Depois de 30 dias</b> — o contrato pode ser encerrado por nós, e vale a cláusula 11.
          </li>
        </Itens>
        <p>
          Valor em atraso tem multa de 2% e juros de 1% ao mês, proporcionais aos dias. Você pode
          cancelar quando quiser, sem multa e sem prazo de fidelidade: o serviço vale até o fim do
          período já pago, e não há devolução proporcional dele.
        </p>
      </Secao>

      <Secao n={7} titulo="O assistente e o crédito de IA">
        <p>
          O assistente é opcional e vem nos planos que dizem isso. Ele consome <b>crédito de IA</b>,
          que é medido por uso e não por assinatura — uma loja que conversa o dia inteiro gasta
          muito mais que outra do mesmo tamanho, e embutir isso na mensalidade faria a loja pequena
          pagar o risco da grande.
        </p>
        <Itens>
          <li>O plano dá um crédito por mês, que não acumula para o mês seguinte.</li>
          <li>Cada conversa desconta o que ela custou, e o sistema mostra isso item a item.</li>
          <li>Crédito esgotado para o assistente. O resto do sistema continua inteiro.</li>
          <li>Recarga é avulsa e opcional, sem virar mensalidade nova.</li>
        </Itens>
        <Destaque>
          <b>O assistente propõe; quem decide é você.</b> Toda ação que mexe em dinheiro, estoque
          ou cadastro passa por confirmação de uma pessoa da sua equipe, dentro dos limites que
          você definir — inclusive o teto de desconto. Ele responde a partir dos seus dados e pode
          errar, como qualquer sistema que gera texto. <b>Conferir antes de confirmar é seu.</b>
        </Destaque>
        <p>
          O canal de WhatsApp depende de fornecedor terceiro e das regras da plataforma. Mudança de
          regra ou bloqueio por parte dela não é descumprimento nosso — mas dá a você direito de
          cancelar sem multa se o canal ficar indisponível por mais de 15 dias seguidos.
        </p>
      </Secao>

      <Secao n={8} titulo="O que é seu, e o que é nosso">
        <p>
          <b>Seu:</b> todo dado que entra no sistema — produtos, vendas, clientes, contas,
          conversas. A gente não vende, não aluga e não usa dado de cliente para treinar modelo de
          IA. Só olhamos quando você pede suporte, e toda ação nossa fica registrada no livro de
          auditoria da sua empresa, visível para você.
        </p>
        <p>
          <b>Nosso:</b> o sistema — código, telas, marca, textos. Contratar dá direito de usar
          enquanto o contrato durar, e mais nada: não dá direito de copiar, revender, hospedar
          cópia nem tirar o código.
        </p>
      </Secao>

      <Secao n={9} titulo="O que fica com você">
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
            consentimento para falar com eles no WhatsApp. Ver a{' '}
            <a href="/privacidade" className="font-semibold text-marca hover:underline">
              Política de Privacidade
            </a>
            .
          </li>
          <li>Não usar o sistema para o que é ilegal, nem para mandar mensagem não pedida em massa.</li>
        </Itens>
      </Secao>

      <Secao n={10} titulo="Disponibilidade, suporte e falhas">
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

      <Secao n={11} titulo="Quando acabar, os dados são seus">
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

      <Secao n={12} titulo="Mudanças nestes termos">
        <p>
          Mudança que afete o que você paga ou o que você recebe é avisada com <b>30 dias</b>, por
          e-mail e dentro do sistema. Continuar usando depois disso vale como aceite; se não
          servir, cancele antes sem multa. Correção de erro de escrita e ajuste que só favoreça
          você valem na hora.
        </p>
        <p>Toda versão anterior fica guardada e pode ser pedida.</p>
      </Secao>

      <Secao n={13} titulo="Foro">
        <p>
          Vale a lei brasileira. Antes de processo, as partes se comprometem a tentar resolver
          direto, por escrito, por 30 dias. Fica eleito o foro de {EMPRESA.foro}.
        </p>
      </Secao>
    </PaginaLegal>
  )
}
