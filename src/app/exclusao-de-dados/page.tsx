// Como pedir para apagar dados — a página que a Meta pede no App Review
// ("Data deletion instructions URL").
//
// ── para quem ela escreve ────────────────────────────────────
// Duas pessoas diferentes chegam aqui, e o caminho de cada uma é outro:
//
//   1. A LOJA, cliente do Norte. Sobre os dados dela a gente é controlador,
//      e o pedido é resolvido direto.
//   2. O CLIENTE DE UMA LOJA — quem recebeu mensagem pelo WhatsApp de uma
//      loja que usa o Norte. Sobre os dados dele a loja é a controladora e a
//      gente é operador: o primeiro caminho é a loja, mas a porta do nosso
//      encarregado fica aberta também, porque a pessoa nem sempre sabe (nem
//      precisa saber) que sistema a loja usa.
//
// ── o que a página NÃO promete ───────────────────────────────
// Não existe formulário nem botão de "apagar tudo": o pedido é por e-mail, e
// quem executa é gente. Página pública, sem login e sem JavaScript — tem de
// abrir no navegador de quem for conferir, do jeito que estiver.
//
// O cliente final é ANONIMIZADO, não apagado linha a linha: o dono da loja
// faz isso na ficha ("Anonimizar este cliente"), e o nosso suporte, quando o
// pedido chega por e-mail, pelo script scripts/anonimizar-cliente.ts — as
// duas portas chamam src/servidor/anonimizar.ts. A seção 3 descreve o que
// essa função apaga e a seção 4 o que ela guarda; se ela mudar, este texto
// muda junto. O PARAR/VOLTAR está em src/servidor/ofertas.ts.
//
// `<Pendente>` marca o que o jurídico precisa decidir.

import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { PaginaLegal, Secao, Itens, Destaque } from '@/ui/PaginaLegal'
import { EMPRESA } from '@/servidor/legal'

export const metadata: Metadata = {
  title: 'Exclusão de dados · Norte',
  description:
    'Como pedir para apagar os seus dados do Norte — seja você uma loja que usa o sistema ou cliente de uma loja que usa. O que sai, o que a lei manda guardar e em quanto tempo.',
}

/** O que o jurídico ainda precisa decidir. Em vermelho, para ninguém confundir com texto pronto. */
function Pendente({ children }: { children: ReactNode }) {
  return <b className="text-critico">[{children}]</b>
}

const link = 'font-semibold text-marca hover:underline'

export default function ExclusaoDeDados() {
  const assunto = encodeURIComponent('Exclusão de dados')
  const email = EMPRESA.encarregadoEmail

  return (
    <PaginaLegal
      titulo="Exclusão de dados"
      resumo="Como pedir para apagar os seus dados do Norte — seja você uma loja que usa o sistema, seja cliente de uma loja que usa. O que sai, o que a lei manda guardar, e em quanto tempo."
    >
      <Secao n={1} titulo="Quem pede, e para quem">
        <Itens>
          <li>
            <b>Você é uma loja que usa o Norte.</b> Os dados da sua empresa e da sua conta são
            tratados por nós, e o pedido vem direto para cá.
          </li>
          <li>
            <b>Você é cliente de uma loja que usa o Norte</b> — por exemplo, recebeu mensagem pelo
            WhatsApp dela. Quem decide sobre os seus dados é a <b>loja</b>: o primeiro caminho é
            pedir a ela. Você também pode escrever direto para o nosso encarregado: a gente avisa a
            loja e responde a você.
          </li>
        </Itens>
        <Destaque>
          Só quer parar de receber mensagem de campanha? Mande <b>PARAR</b> sozinho numa mensagem
          para a loja. A campanha em andamento acaba na hora, você recebe uma única confirmação, e
          o seu número entra na lista de quem não recebe ofertas daquela loja{' '}
          <b>de forma permanente</b>: nenhuma campanha começa de novo para você. Se mudar de ideia,
          é só mandar <b>VOLTAR</b>. Isso não apaga os seus dados — para isso, siga a seção 2.
        </Destaque>
      </Secao>

      <Secao n={2} titulo="Como pedir">
        <p>
          Escreva para{' '}
          <a href={`mailto:${email}?subject=${assunto}`} className={link}>
            {email}
          </a>{' '}
          com o assunto <b>Exclusão de dados</b>, dizendo:
        </p>
        <Itens>
          <li>
            <b>Se você é uma loja</b>: o nome da empresa, o endereço dela no Norte e o CNPJ ou CPF.
            Escreva do e-mail de um dono cadastrado.
          </li>
          <li>
            <b>Se você é cliente de uma loja</b>: o número de WhatsApp que recebeu as mensagens, o
            seu nome e, se souber, o nome da loja.
          </li>
          <li>Se quer apagar tudo ou só uma parte — por exemplo, só as conversas.</li>
        </Itens>
        <p>
          Para ter certeza de que é você mesmo, a gente pode pedir uma confirmação pelo mesmo
          e-mail ou pelo mesmo número de WhatsApp. É só isso: nenhum documento a mais do que o
          necessário para confirmar quem pediu.
        </p>
      </Secao>

      <Secao n={3} titulo="O que é apagado">
        <p className="font-semibold text-tinta">Se você é uma loja</p>
        <p>
          Tudo o que a sua empresa pôs no sistema: cadastro da empresa e das lojas, equipe,
          produtos, estoque, clientes, vendas, contas, conversas de WhatsApp, fotos, vídeos e
          áudios das campanhas, a configuração do assistente e a sessão do WhatsApp. Antes de
          apagar, você tem <b>30 dias</b> para exportar o que é seu, se quiser — o pedido de
          exclusão também encerra o contrato, e segue o que os{' '}
          <a href="/termos" className={link}>
            Termos de uso
          </a>{' '}
          dizem sobre o fim dele.
        </p>
        <p className="font-semibold text-tinta">Se você é cliente de uma loja</p>
        <p>
          O seu cadastro naquela loja é <b>anonimizado</b>: o nome vira &quot;Cliente
          anonimizado&quot;, e telefone, e-mail, CPF, endereço, data de nascimento e as anotações
          da loja sobre você são apagados. Também são apagadas as conversas de WhatsApp com a loja,
          a sua participação nas campanhas (inclusive o que você respondeu nelas), o seu nome e
          telefone nas encomendas e o seu nome no livro de auditoria da loja. A própria loja pode
          fazer isso na hora, pela sua ficha; se o pedido chegar a nós, a gente faz a mando dela.
        </p>
        <p>
          Compra que você fez — e os pontos e vales ligados a ela — continua existindo no registro
          da loja, porque a lei manda, mas <b>desligada do seu nome</b>. Enquanto houver parcela de
          crediário em aberto ou encomenda por entregar, a anonimização espera: sem o contato,
          ninguém consegue resolver.
        </p>
      </Secao>

      <Secao n={4} titulo="O que fica, porque a lei manda">
        <Itens>
          <li>
            <b>Registro fiscal e de venda</b> da loja — nota, venda, pagamento — pelo prazo das
            obrigações fiscais <Pendente>jurídico: confirmar o prazo (CTN, arts. 173 e 174)</Pendente>
            , e só para isso.
          </li>
          <li>
            <b>Registro de acesso</b> ao sistema (data, hora e endereço IP), por 6 meses, como
            manda o Marco Civil da Internet (art. 15).{' '}
            <Pendente>técnico: confirmar onde esse registro é guardado hoje</Pendente>
          </li>
          <li>
            <b>Valor em aberto</b>, como parcela de crediário, enquanto a dívida existir — é
            direito da loja cobrar.
          </li>
          <li>
            <b>O seu número na lista de quem não recebe ofertas</b> daquela loja, reduzido a DDD e
            oito últimos dígitos, com a data. É o mínimo para ninguém escrever de novo para quem
            pediu para ser esquecido.
          </li>
          <li>
            <b>O livro de auditoria</b>, que só recebe linha nova e é o que prova quem fez o quê,
            fica enquanto a conta da loja existir, e sai junto com ela. Quando um cliente é
            anonimizado, as linhas sobre ele perdem o nome e os dados pessoais; fica o que foi
            feito, por quem e quando.{' '}
            <Pendente>jurídico: confirmar a base legal para manter o livro de auditoria</Pendente>
          </li>
          <li>
            <b>Cópias de segurança</b>: o dado apagado sai delas no ciclo normal, em até{' '}
            <b>90 dias</b>.
          </li>
        </Itens>
        <p>
          <b>O que não está com a gente, a gente não consegue apagar.</b> Mensagem já entregue fica
          no celular de quem recebeu e no WhatsApp da loja. E o que passou pelo WhatsApp é guardado
          pela Meta conforme os termos dela.
        </p>
      </Secao>

      <Secao n={5} titulo="Em quanto tempo">
        <Itens>
          <li>
            <b>Até 15 dias</b> para responder ao pedido, dizendo o que foi feito ou o que falta.
          </li>
          <li>
            <b>Loja</b>: o dado sai em até <b>90 dias</b> depois do fim do prazo de exportação.
          </li>
          <li>
            <b>Cliente de uma loja</b>: a gente avisa a loja no mesmo dia útil e apaga conforme a
            decisão dela, dentro do mesmo prazo de 15 dias.{' '}
            <Pendente>jurídico: definir o que fazer se a loja não responder</Pendente>
          </li>
          <li>
            <b>Cópias de segurança</b>: em até 90 dias, no ciclo normal delas.
          </li>
        </Itens>
      </Secao>

      <Secao n={6} titulo="Desconectar o WhatsApp da loja">
        <p>Desconectar é imediato e não precisa de pedido:</p>
        <Itens>
          <li>
            <b>No Norte</b>: na tela <b>Assistente</b>, no bloco do WhatsApp, toque em{' '}
            <b>Desconectar</b> e confirme. A sessão guardada do WhatsApp é apagada na hora, e o
            Norte para de mandar e receber mensagens por aquele número.
          </li>
          <li>
            <b>Pelo celular</b>, na conexão por QR Code: no WhatsApp da loja, abra{' '}
            <b>Aparelhos conectados</b>, toque na sessão do Norte e escolha <b>Desconectar</b>.
          </li>
          <li>
            <b>Na conexão oficial</b>: além do botão no Norte, você pode remover o acesso do Norte
            à conta de WhatsApp nas configurações da sua conta empresarial na Meta.
          </li>
        </Itens>
        <p>
          Desconectar não apaga as conversas já gravadas — elas são da loja e continuam no
          histórico. Para apagá-las, peça pela seção 2.
        </p>
      </Secao>

      <Secao n={7} titulo="Contato">
        <p>
          Encarregado pelo tratamento de dados:{' '}
          {EMPRESA.encarregado ? <b>{EMPRESA.encarregado}</b> : <Pendente>a designar</Pendente>} —{' '}
          <a href={`mailto:${email}?subject=${assunto}`} className={link}>
            {email}
          </a>
          .
        </p>
        <p>
          Outros assuntos: <b>{EMPRESA.email}</b>.
          {EMPRESA.razaoSocial && EMPRESA.cnpj && (
            <>
              {' '}
              O Norte é operado por <b>{EMPRESA.razaoSocial}</b>, CNPJ {EMPRESA.cnpj}
              {EMPRESA.endereco ? `, ${EMPRESA.endereco}` : ''}.
            </>
          )}
        </p>
        <p className="text-[13px] text-tinta-3">
          Veja também a{' '}
          <a href="/privacidade" className={link}>
            Política de Privacidade
          </a>{' '}
          e os{' '}
          <a href="/termos" className={link}>
            Termos de uso
          </a>
          .
        </p>
      </Secao>
    </PaginaLegal>
  )
}
