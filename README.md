# Norte

Sistema de gestão empresarial operado por um agente de IA no WhatsApp.
Atende do balcão de bairro à rede com dezenas de unidades.

## Documentos

| Arquivo | O que é |
|---|---|
| `ESCOPO.md` | O que o produto é e o que não é |
| `DECISOES.md` | Toda decisão fechada, com motivo e alternativas descartadas |
| `docs/plano-completo.html` | Os 13 módulos e as 6 fases de construção |
| `docs/decisoes.html` | As decisões em página navegável |
| `docs/clickup-traduzido.html` | Pesquisa do ClickUp traduzida para o nosso produto |

## Começar a trabalhar

Não precisa de Docker, de banco na nuvem, nem de conta em lugar nenhum.

```bash
npm install
npm run banco      # sobe o Postgres local — deixe esta janela aberta
npm run preparar   # tabelas, travas, duas empresas e gente para entrar
npm run dev        # o sistema, em http://localhost:3000/exemplo
npm run conferir   # prova isolamento e login no banco de verdade
npm test           # checa tipos + 99 testes
```

Contas de exemplo (só no banco local), senha `exemplo-2026`:

| E-mail | Papel |
|---|---|
| `ana@exemplo.com` | Dona — tudo, em todas as unidades |
| `carlos@exemplo.com` | Balcão — vende, presa a uma unidade |
| `contador@exemplo.com` | Contador — só olha o financeiro |
| `antiga@exemplo.com` | Desativada, para testar recusa |

O `npm run banco` sobe um Postgres de verdade (PGlite, compilado para WASM)
falando o protocolo do Postgres na porta 5433. A aplicação conecta com uma
connection string normal, então **não existe uma linha de código diferente
entre desenvolvimento e produção**.

Os dados ficam em `.banco/`. Apagar a pasta = banco novo.

## Estado

**Cadastro inicial e módulos.** A empresa responde o que usa e o sistema
esconde o resto: quem não vende fiado não vê Crediário em lugar nenhum.
Ligar de volta é em Configurações.

**Fase 2 — em andamento.** Catálogo (produto com eixos de variação da própria
empresa + unidade de medida) e estoque com movimento atômico prontos e
conferidos. Tela de produtos no ar.

Venda registrada: estoque, venda e pagamento numa transação só. Dinheiro é
contado em **centavos inteiros** — ver `src/servidor/dinheiro.ts` e o bug que
originou o arquivo.

**Fase 2 fechada.** Balcão e caixa no ar: bipa a etiqueta, Enter lança,
pagamento dividido, troco calculado e o caixa fecha conferindo a gaveta.

**Fase 3 fechada.** Contas a pagar com aviso de vencida, lançamento de
despesa e DRE mensal no formato da contabilidade.

Próximo: Fase 4 — o agente no WhatsApp.

**Fase 1 — Fundação: fechada.** Modelo de dados, isolamento entre empresas,
acesso da aplicação, senhas, login, papéis, convite de equipe, biblioteca de
componentes e os dois temas. Entrar em `/exemplo` já funciona de verdade.

Próximo: Fase 2 — produto, estoque, balcão e caixa.

## As regras que não se quebram

1. **Toda tabela de dado de cliente carrega `org_id`.** Sem exceção.
2. **Ninguém fala com o banco direto.** Tudo passa por `comoOrg()` em
   `src/servidor/banco.ts`. Se você escreveu `prisma.` fora daquele arquivo,
   está errado.
3. **O código pergunta pela capacidade, nunca pelo papel.** `pode(sessao,
   'caixa.operar', unidadeId)` — nunca `if (papel === 'GERENTE')`. Assim criar
   um papel novo não obriga a caçar condição espalhada pelo sistema.
4. **Ninguém concede papel que não tem.** Gerente contrata balconista; só dono
   cria dono. Sem isso, "gerir equipe" viraria caminho para virar dono.
5. **Isolamento tem duas paredes:** a aplicação (`comoOrg`) e o RLS do Postgres
   (`prisma/sql/rls.sql`). A segunda existe para quando a primeira falhar.
6. **`npm test` verde é condição para subir.** Vazamento entre empresas mata o
   negócio no primeiro dia.
7. **Dinheiro se conta em centavos inteiros**, nunca com número quebrado.
   `44,90 × 0,750` dá 33,68 — a conta ingênua dá 33,67, e o centavo some
   toda vez que cai na metade. Reais quebrados só nas beiradas: tela e banco.
8. **Estoque se mexe só por `mexerEstoque()`.** A conta (`quantidade + delta`)
   acontece dentro do banco, nunca na memória — senão duas vendas ao mesmo
   tempo perdem uma baixa. E o histórico é a verdade: `conferirSaldos()`
   acusa se o saldo divergir da soma.
9. **Cor sempre com palavra ou sinal junto.** Etiqueta tem bolinha E texto;
   comparação tem seta E percentual. Quem não distingue verde de vermelho
   (8% dos homens) precisa ler exatamente a mesma coisa.
10. **Situação (verde/âmbar/vermelho) nunca vira cor de marca.** Se a marca
   fosse verde, "no prazo" e "logo da empresa" competiriam pelo olho.
11. **O livro de auditoria só recebe.** Sem UPDATE, sem DELETE, e a tentativa
   levanta erro em vez de falhar em silêncio.

### Onde ficam as coisas

| Arquivo | Responsabilidade |
|---|---|
| `src/servidor/banco.ts` | A parede 1: `comoOrg()`. Único lugar que fala com o banco |
| `src/servidor/permissao.ts` | Quem pode o quê. Puro, sem I/O |
| `src/servidor/senha.ts` | Guardar e conferir senha (scrypt) |
| `src/servidor/autenticacao.ts` | Entrar no sistema |
| `src/servidor/convite.ts` | Convidar gente para a equipe |
| `src/servidor/sessao.ts` | Cookie de sessão, com escopo por empresa |
| `src/servidor/pagina.ts` | `exigirEntrada()` — toda tela de dentro começa por ela |
| `src/servidor/estoque.ts` | Movimento de estoque, atômico. A conta acontece no banco |
| `src/servidor/modulos.ts` | O que cada empresa usa, e o que cada ramo já deixa pronto |
| `src/servidor/dinheiro.ts` | Centavos inteiros. Nenhuma conta de dinheiro sai daqui |
| `src/servidor/venda.ts` | Registrar venda: estoque + venda + pagamento, ou nada |
| `src/servidor/caixa.ts` | Abrir, movimentar e fechar o caixa do turno |
| `src/servidor/financeiro.ts` | Contas a pagar, lançamentos e o DRE |
| `src/servidor/unidade.ts` | Qual loja a pessoa está olhando, e quais ela alcança |
| `src/servidor/painel.ts` | Os números do painel, uma consulta por assunto |
| `src/servidor/planos.ts` | Cotas por plano e o que custa a loja extra |
| `src/ui/` | Componentes: Botão, Campo, Aviso, Situação, Cartão, Tabela, Estrutura |
| `src/app/globals.css` | As fichas de cor e os dois temas |
| `src/ui/painel.tsx` | Número, gráfico, ranque e a tira de contagens coloridas |

### Ao criar tabela nova

Ela precisa de `org_id`, e o `rls.sql` precisa rodar de novo — ele liga a
proteção por varredura, então tabela nova entra sozinha. O terceiro teste
(`RLS está ligado e forçado em toda tabela com org_id`) reprova se esquecerem.

## Limitações conhecidas do banco local

O PGlite é um Postgres de **um backend só**. Duas consequências, ambas só no
desenvolvimento:

- **Sem concorrência real.** Várias conexões são multiplexadas por cima de um
  backend, então transações simultâneas não se comportam como num Postgres de
  verdade. Por isso `POOL_MAX=1` no `.env`. Qualquer coisa sensível a
  concorrência precisa ser validada no banco hospedado.
- **`npm run conferir` quer banco novo.** Ele cria convite, venda e gente; na
  segunda rodada seguida sobra estado do anterior. E o freio de login deixa
  contas bloqueadas por 15 minutos de propósito — a segunda rodada reprova
  justamente porque a defesa funcionou. Rode `npm run banco` de novo (a pasta
  `.banco/` some) antes de conferir outra vez.
- **Conexão não sobrevive a transação abortada.** Postgres de verdade recupera;
  este não. Por isso o `npm run conferir` só faz leitura — checagem do tipo
  "esta escrita tem que dar erro" envenenaria a conexão e as seguintes
  passariam pelo motivo errado. Essas ficam no `npm test`, que fala com o
  PGlite direto e não sofre disso.

Quando houver banco hospedado (Neon é o plano — ver `DECISOES.md`), as
checagens de escrita voltam para o `conferir`.

## Pilha

Next.js · TypeScript · PostgreSQL · Prisma 7 · Vitest · PGlite (dev e testes)

> Prisma 7 tirou a `url` do `schema.prisma`. Ela vive em `prisma.config.ts`
> para migração, e o cliente da aplicação usa adapter.
