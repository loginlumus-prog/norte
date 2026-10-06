// Os termos do programa de parceiros.
//
// A mesma regra dos termos de uso: cada cláusula descreve o que o sistema
// REALMENTE faz (src/servidor/parceiros.ts e as funções do banco em
// prisma/sql/rls.sql). Os números saem das constantes — mudou a regra, o
// texto muda junto. Precisa passar por advogado e pela contadora antes de
// valer (a página diz isso enquanto a identidade de quem assina faltar).

import type { Metadata } from 'next'
import { PaginaLegal, Secao, Itens, Destaque } from '@/ui/PaginaLegal'
import { EMPRESA } from '@/servidor/legal'
import { PRECOS } from '@/servidor/planos'
import { mostrar } from '@/servidor/dinheiro'
import {
  ATIVO_DIAS,
  CARENCIA_DIAS,
  DESCONTO_PRIMEIRA_PCT,
  DIA_DO_REPASSE,
  DIAS_DO_LINK,
  FAIXAS,
  MESES_DE_COMISSAO,
  MINIMO_REPASSE,
  NIVEL2_MINIMO_CLIENTES,
  NIVEL2_PCT,
  VERSAO_TERMOS_PARCEIRO,
} from '@/servidor/parceiros'

export const metadata: Metadata = {
  title: 'Termos do programa de parceiros · Norte',
  description: 'Como a indicação é contada, quanto se paga, quando e o que cancela uma comissão.',
}

export default function TermosParceiros() {
  return (
    <PaginaLegal
      titulo="Termos do programa de parceiros"
      resumo={`Quem indica o Norte recebe parte das mensalidades das lojas que trouxe. Aqui está como isso é contado, quanto é, quando é pago e o que cancela. Versão de ${VERSAO_TERMOS_PARCEIRO}.`}
    >
      <Secao n={1} titulo="O que é o programa">
        <p>
          O parceiro divulga o Norte e, quando uma empresa se cadastra por ele e paga a mensalidade, recebe uma parte do
          valor pago. Participar é grátis, não exige compra, meta nem exclusividade.
        </p>
        <p>
          Ser parceiro não cria vínculo de emprego, sociedade, representação comercial exclusiva nem mandato. O parceiro não
          fala em nome do Norte, não negocia preço nem promete o que o Norte não oferece.
        </p>
      </Secao>

      <Secao n={2} titulo="Como a indicação é contada">
        <Itens>
          <li>
            Cada parceiro tem um link (com o código dele) e o próprio código. Quem abre o link fica marcado no navegador por{' '}
            {DIAS_DO_LINK} dias; vale o primeiro link aberto.
          </li>
          <li>A empresa também pode digitar o código no cadastro. O código digitado vale mais que o do link.</li>
          <li>A indicação é registrada no momento em que a empresa é criada, e é para sempre: não muda de dono depois.</li>
          <li>Não vale indicar a si mesmo: o código não conta quando o e-mail do dono da empresa é o mesmo do parceiro.</li>
          <li>Empresa que já existia no Norte antes do link não vira indicação.</li>
        </Itens>
      </Secao>

      <Secao n={3} titulo="O que a empresa indicada ganha">
        <p>
          O mesmo teste de {PRECOS.diasDeTeste} dias de toda empresa nova e, quando assinar, {DESCONTO_PRIMEIRA_PCT}% de
          desconto na primeira mensalidade paga.
        </p>
      </Secao>

      <Secao n={4} titulo="Quanto o parceiro recebe">
        <p>Uma porcentagem de cada mensalidade paga pelas empresas que ele indicou, conforme quantas delas estão pagando:</p>
        <Itens>
          {FAIXAS.map((f, i) => {
            const prox = FAIXAS[i + 1]
            return (
              <li key={f.pct}>
                {prox ? `de ${Math.max(1, f.de)} a ${prox.de - 1}` : `${Math.max(1, f.de)} ou mais`} empresas pagando: {f.pct}%
              </li>
            )
          })}
        </Itens>
        <p>
          “Pagando” é a empresa que pagou uma mensalidade nos últimos {ATIVO_DIAS} dias. A faixa usada é a do dia em que o
          pagamento é registrado, já contando a empresa que pagou.
        </p>
        <p>
          A porcentagem vale sobre o valor efetivamente pago (com desconto, quando houver), sem pacotes de respostas,
          implantação ou serviços avulsos, e só pelas primeiras {MESES_DE_COMISSAO} mensalidades de cada empresa, contadas a
          partir do primeiro mês pago.
        </p>
      </Secao>

      <Secao n={5} titulo="O segundo nível">
        <p>
          O parceiro pode convidar outros parceiros pelo link de convite do painel. Sobre as mensalidades das empresas
          indicadas por quem ele convidou, recebe {NIVEL2_PCT}%, nas mesmas condições da cláusula 4 — sem diminuir o que o
          convidado recebe.
        </p>
        <Destaque>
          O programa tem só dois níveis. Ninguém recebe por cadastrar parceiro, nem paga para entrar. Só mensalidade paga por
          empresa de verdade gera dinheiro.
        </Destaque>
        <p>
          Os {NIVEL2_PCT}% só são gerados enquanto o parceiro tiver pelo menos {NIVEL2_MINIMO_CLIENTES} empresa indicada por ele
          mesmo pagando.
        </p>
      </Secao>

      <Secao n={6} titulo="Quando e como é pago">
        <Itens>
          <li>A comissão fica {CARENCIA_DIAS} dias em carência depois do pagamento da empresa, e então é liberada.</li>
          <li>
            Todo dia {DIA_DO_REPASSE}, o que estiver liberado é pago por Pix na chave cadastrada no painel, a partir de{' '}
            {mostrar(MINIMO_REPASSE * 100)}. Abaixo disso, acumula para o mês seguinte.
          </li>
          <li>O Pix vai só para a chave do próprio parceiro, com CPF ou CNPJ cadastrado. Chave errada é responsabilidade de quem a digitou.</li>
          <li>
            O parceiro responde pelos impostos sobre o que recebe. O Norte pode reter na fonte o que a lei mandar e pedir nota
            fiscal ou recibo (RPA), conforme o caso.
          </li>
        </Itens>
      </Secao>

      <Secao n={7} titulo="O que cancela uma comissão">
        <Itens>
          <li>Pagamento da empresa devolvido, estornado ou contestado: a comissão dele é cancelada (é para isso que existe a carência).</li>
          <li>Autoindicação, conta falsa, empresa de fachada, compra de clique ou cadastro.</li>
          <li>
            Anúncio com o nome ou a marca do Norte em buscador, ou página que se passe pelo Norte; promessa de preço, desconto
            ou recurso que não existe; mensagem em massa para quem não pediu (spam).
          </li>
        </Itens>
        <p>Nesses casos o Norte pode bloquear a conta e cancelar as comissões ligadas à irregularidade.</p>
      </Secao>

      <Secao n={8} titulo="Seus dados">
        <p>
          Guardamos nome, e-mail, WhatsApp, chave Pix e CPF ou CNPJ para identificar você e pagar as comissões, e só para
          isso. Do lado das empresas indicadas, o parceiro vê só o nome da empresa, a situação (em teste, pagando, parou) e o
          que ganhou com ela. Dos parceiros que convidou, vê só o primeiro nome e quantas empresas eles indicaram.
        </p>
      </Secao>

      <Secao n={9} titulo="Mudanças e saída">
        <p>
          O Norte pode mudar as regras com aviso de 30 dias no painel. O que já foi gerado segue a regra do dia em que foi
          gerado. O parceiro pode sair quando quiser, escrevendo para {EMPRESA.email}; o que estiver liberado é pago no
          repasse seguinte.
        </p>
      </Secao>
    </PaginaLegal>
  )
}
