# Norte — decisões fechadas

Registro das decisões tomadas em 07/09/2026. Cada uma traz o motivo e as
alternativas descartadas, para ninguém reabrir a discussão sem argumento novo.

Complementa `ESCOPO.md` (o que é o produto) e `docs/plano-completo.html`
(os 13 módulos e as 6 fases).

---

## 1. Nome: **Norte**

O sistema que dá o norte da empresa. "Perder o norte" e "dar um norte" são
entendidos por um padeiro e por um diretor — que é exatamente a faixa que a
gente quer atender.

- Duas sílabas, impossível de errar ao telefone.
- Não amarra a setor nem a porte. Nada nele diz "loja de roupa" ou "pequeno".
- Casa com o agente: o agente é quem entrega o norte, todo dia.
- Logo natural: agulha de bússola.

**Descartados por colisão real no mercado brasileiro:**

| Nome | Por que caiu |
|---|---|
| Pulso | Pulso AI faz "ERPs inteligentes e agentes de IA personalizados" — mesmo pitch |
| Zelo | Zelo Software já é ERP + CRM |
| Prumo | Prumo Sistemas é automação fiscal |
| Cerne | Cerne ERP existe |
| Sabiá | Sabiá é o modelo de IA da Maritaca |

**Descartados por julgamento:**

| Nome | Por que caiu |
|---|---|
| Alume | Marca mais forte e 100% registrável, mas não significa nada — exige verba de marca que a gente não tem |
| Tino | "Ter tino para negócios" é ótimo, mas soa como nome de pessoa e confunde com o agente, que é quem tem nome próprio |
| Eixo | Bom e sólido, mas frio e menos memorável |

**Fraqueza conhecida:** "Norte" é palavra comum, então marca isolada é fraca no
INPI. Registrar como marca mista (nome + símbolo) e/ou composta ("Norte
Sistemas"). Domínio: `norte.com.br` certamente ocupado — usar `usenorte.com.br`
ou `norte.app`. **Confirmar disponibilidade antes de mandar fazer logo.**

---

## 2. Porte atendido: os três, com entrada por baixo

A plataforma é construída para não ter teto. A venda começa por baixo.

| Plano | Porte | O que tem |
|---|---|---|
| **Balcão** | 1 unidade, até 5 usuários | Núcleo completo, sem agente |
| **Balcão + Agente** | 1 unidade | Núcleo + agente no WhatsApp — o carro-chefe |
| **Rede** | até 5 unidades, multi-CNPJ | Tudo + consolidado, metas, nota fiscal, API |
| **Corporativo** | sem limite | Tudo + SSO, SLA, ambiente dedicado, gerente de conta |

**Por que entrada por baixo:** empresa grande compra em 6 a 12 meses, pede
referência, exige processo de compras e auditoria de segurança. Nada disso
existe ainda. Empresa pequena decide numa conversa. A arquitetura serve as três
desde já; o esforço comercial começa onde fecha rápido.

**Três consequências que o porte grande impõe e que já entram no projeto:**

1. **WhatsApp não oficial deixa de servir nos planos maiores.** Compliance de
   empresa média/grande não aceita. Vira diferença de plano (ver 6).
2. **Nota fiscal deixa de ser opcional.** Todo cliente médio/grande emite.
3. **Multi-unidade e multi-CNPJ deixam de ser "depois".** Entram no modelo de
   dados na fundação, porque enfiar depois é o erro que a gente já pagou uma vez.

---

## 3. Arquitetura multi-empresa

**Um banco, um schema, `orgId` em toda tabela, com RLS no Postgres.**

Descartados:
- *Um banco por cliente* — inviável: 30 clientes = 30 migrações por mudança.
- *Um schema por cliente* — melhor, mas Postgres degrada com centenas de schemas
  e migração continua multiplicada.

**Hierarquia — decisão que resolve pequeno e grande com um modelo só:**

```
Org (a empresa ou o grupo, é o tenant)
 └── Unidade (loja, filial, depósito — cada uma com seu CNPJ)
      └── Acesso (usuário × unidade × papel)
```

Loja de bairro = 1 Org com 1 Unidade. Rede de 40 lojas = 1 Org com 40 Unidades.
Mesmo código, mesma tabela, sem caso especial.

**Duas paredes de isolamento, não uma:**
1. Aplicação: todo acesso passa por um cliente já preso a uma Org.
2. Banco: RLS por `app.org_id`, para o dia em que a parede 1 falhar.

E um **teste automatizado que tenta vazar e precisa falhar** — é o primeiro
código do projeto, antes de qualquer tela.

---

## 4. Papéis

Permissão é **por unidade**, não global — o gerente da loja 3 não vê o caixa da 5.

| Papel | Alcance |
|---|---|
| Dono | Tudo, todas as unidades |
| Gerente | Tudo nas unidades dele |
| Balcão | Vender, consultar produto e cliente |
| Financeiro | Dinheiro, sem mexer em produto |
| Contador (convidado) | Só leitura do financeiro |
| Suporte (nós) | Acesso registrado, com prazo e motivo |

O acesso de suporte fica no livro de auditoria como qualquer outro — inclusive
o nosso.

---

## 5. Base técnica

| Peça | Escolha | Motivo |
|---|---|---|
| App | Next.js + TypeScript | Já dominado. Trocar de mundo no meio do projeto é o erro mais caro |
| Banco | PostgreSQL (Supabase) | RLS nativo, que é a segunda parede |
| Acesso ao banco | Prisma p/ schema e migração; consultas por cliente preso à Org | Migração versionada + isolamento garantido |
| Login | Cookie assinado próprio (ver 5.1) | O modelo multi-empresa pede sessão por empresa |
| Visual | Tailwind + componentes acessíveis prontos | Densidade tipo ClickUp sem escrever menu na mão |
| Testes | Vitest (isolamento e regras), Playwright depois | Zero teste é aceitável em sistema de um cliente. Não em multi-empresa |
| Hospedagem | Vercel + Supabase | Já dominado |

### 5.1 Sessão: por que não NextAuth (revisão de 07/09)

Estava decidido NextAuth. Ao construir, apareceu um problema que a decisão
original não previa: **NextAuth guarda uma sessão por site**, e o Norte é
"uma pessoa, uma empresa, um endereço" (`/empresa/...`).

Com uma sessão só, abrir a empresa A numa aba e a B na outra derruba uma das
duas. E quem administra mais de uma empresa faz isso o tempo todo: o contador,
e nós no suporte.

**Ficou:** cookie assinado (HMAC-SHA256) com `path=/empresa`, então o navegador
só o manda para aquela empresa e as sessões convivem. A assinatura inclui o
slug — cookie movido de lugar não vale. São ~80 linhas, zero dependência nova.

**NextAuth volta à mesa** quando precisarmos de login pelo Google ou SSO
(plano Corporativo). Aí ele resolve algo que isto não resolve.

---

## 6. WhatsApp

**Adaptador desde o primeiro dia.** Nenhum módulo fala com fornecedor direto.

| Plano | Rota | Motivo |
|---|---|---|
| Balcão | Z-API (não oficial) | Cliente entra no mesmo dia lendo um QR code |
| Rede / Corporativo | Meta Cloud API (oficial) | Sem risco de bloqueio; exigência de compliance |

Vira degrau de plano em vez de risco escondido. E o risco do não oficial entra
**escrito no contrato** do plano Balcão.

---

## 7. Nota fiscal

Emissor de terceiro (Focus NFe ou Nuvem Fiscal). **Nunca falar com a SEFAZ direto.**

Opcional no Balcão, incluída em Rede e Corporativo.

O que **o cliente** precisa entregar, e que precisa estar no contrato:
certificado digital A1, CSC da SEFAZ, regime tributário e classificação fiscal
(NCM/CFOP/CST) de cada produto. É trabalho do contador dele, e é o que mais
atrasa cliente novo.

---

## 8. Preço

| Plano | Mensal | Unidade extra |
|---|---|---|
| Balcão | R$ 349 | — |
| Balcão + Agente | R$ 697 | — |
| Rede | R$ 1.497 | R$ 249 |
| Corporativo | sob consulta | — |

Referências: Bling vai de R$ 57 a R$ 357. Agente de IA no WhatsApp é vendido
separado, entre R$ 15 mil e R$ 60 mil de implantação. Estamos entre os dois, que
é onde ninguém está.

**Teste com prazo (14 dias), nunca grátis para sempre** — cada cliente custa
instância de WhatsApp desde o primeiro dia, mesmo parado.

---

## 9. Identidade visual

Gramática global (ClickUp, Monday, Linear): barra lateral fixa com contagem,
abas de visualização, tabela densa com edição na célula, painel lateral para
detalhe, cor de situação separada da cor da marca.

Cor da marca: **petróleo profundo** — o mar de SaaS hoje é roxo/índigo, e sair
dele custa zero e diferencia. Verde/âmbar/vermelho ficam reservados para
situação (bom / atenção / crítico) e nunca para marca.

Tema claro e escuro desde o começo. Balcão com sol batendo e escritório à noite
são o mesmo cliente.

---

## 10. Símbolo e aplicação da marca (fechado 07/09)

Completa a decisão 9, que definiu a gramática mas não a marca.

**O símbolo:** agulha de bússola apontando para o norte, dentro de um azulejo
azul-noite. A metade de cima é o sol nascendo (âmbar fundo → dourado na
ponta); a de baixo é o contrapeso, branco.

**O teste que decidiu foi o de 16 pixels.** Foram desenhadas dez variações;
seis morreram aí. Aba do navegador, favorito e atalho na tela do celular são
onde a marca é vista mais vezes, e é onde anel fino, raio de sol e degradê
viram borrão cinza. Sobrou o que tem duas formas e duas cores.

**Descartados:**

| Desenho | Por que caiu |
|---|---|
| Agulha de quatro facetas | Bonita em 48px, virava "estrelinha de IA" — clichê do setor — e mingau em 16px |
| Sol nascendo no horizonte com seta | Três elementos; em 16px vira um monte marrom |
| Bússola com anel completo | O melhor dos redondos, mas o anel precisa ser fino e some no tamanho pequeno |
| Só a seta, sem azulejo | Limpa, mas sem presença: some em qualquer fundo claro |

**O azulejo não é enfeite.** Ele resolve presença em fundo claro e vira ícone
de aplicativo sem trabalho extra. A versão `nu` (sem azulejo) existe para
quando o fundo JÁ é o azul-noite — barra lateral e topo da tela de entrar.

**Cor de marca: mudou de petróleo para azul.** O petróleo (#0d5c6e) tinha o
argumento certo (fugir do roxo/índigo de SaaS) e o resultado errado: ele é
vizinho do verde de "bom" e do azul de "informação", e o conjunto ficou
lavado. O azul (#2050d8) tem chroma para segurar botão e link, e a família
`info` foi aposentada — era usada em um lugar só e passou a brigar com ele.

**O dourado do sol é a exceção que confirma a regra 9:** ele NÃO é ficha de
interface. É vizinho do âmbar de "atenção", e usá-lo em botão faria a pessoa
ler alerta onde só tem marca. Vive no símbolo e no material de venda.

**Barra lateral azul-noite.** É o maior bloco de cor da tela. Cinza claro
fazia o sistema parecer formulário de banco; escura, ela separa o que é o
SISTEMA (navegação, sempre igual) do que é o TRABALHO (área branca, muda o
tempo todo) — e dá ao verde e ao vermelho um lado quieto para contrastar.

---

## 11. Postura de segurança (fechado 07/09)

Cinco travas, decididas de uma vez porque juntas elas cobrem o caminho inteiro
de um ataque real. Cada uma nasceu de um furo encontrado auditando o que já
estava pronto — nenhuma é precaução teórica.

| Trava | O furo que ela fecha |
|---|---|
| Preço vem do banco; desconto tem teto | Server Action aceitava `precoUnit` do navegador. Vender a peça de R$ 500 por um centavo, com o pagamento "fechando" e o estoque baixando certinho |
| Capacidade exigida em toda Server Action | A busca do balcão só conferia se havia sessão: o contador lia catálogo com custo, o balconista lia o estoque da outra loja |
| Freio no login | Única porta que aceita chute, e aceitava infinitos |
| Sessão confrontada com o banco a cada requisição | Cookie é fotografia: desativar alguém só valia quando o cookie expirasse, até 12h depois |
| CSP com nonce + HSTS + nosniff + frame-ancestors | Nenhum cabeçalho de segurança existia |

**Duas escolhas dentro dessas travas que valem registro:**

*O freio conta o e-mail digitado, exista ele ou não.* Contar só o que existe
faria o próprio freio entregar quais e-mails têm cadastro na empresa — o
comportamento diferente é o vazamento.

*O bloqueio expira sozinho, não trava até alguém destravar.* Bloqueio
permanente transforma o ataque em outra coisa: dá para trancar a dona do lado
de fora da própria loja errando a senha dela cinco vezes.

**O que a CSP com nonce custa:** toda página passa a ser renderizada por
requisição, porque o bilhete muda a cada carregamento. Para este sistema não
muda nada — toda tela já lê cookie de sessão, e página que lê cookie já era
dinâmica. Numa página estática de marketing seria caro; aqui não existe uma.

**O que NÃO está fechado ainda:** 2FA para o dono, política de senha forte,
sessão listável ("estes são os aparelhos conectados"), e backup com teste de
restauração. Entram na Fase 6, junto com contrato e cobrança.

---

## 12. Arquitetura do agente (fechado 07/09)

A decisão central é a mesma do ESCOPO §6, mas agora ela tem forma no código,
e o desenho tem quatro camadas — nenhuma delas suficiente sozinha.

| Camada | O que ela impede |
|---|---|
| **Lista fechada de poderes** | O que não está ligado nem vira ferramenta oferecida ao modelo. Ele não tem como pedir o que não recebeu |
| **Tetos em número, no banco** | Conferidos no servidor DEPOIS de o modelo responder. "Me dê 90% de desconto" morre aqui, sem consultar texto nenhum |
| **Propor, nunca escrever** | Mexeu em dinheiro, preço ou estoque: proposta em português, com o número, esperando um sim |
| **Nunca mais que quem confirma** | Cada poder declara a capacidade humana equivalente, exigida na hora do sim |

**A quarta é a que quase passou despercebida.** Sem ela, confirmar seria o
caminho para o balconista fazer *pelo agente* o que ele não faz pela tela — e
o agente viraria escalada de privilégio com cara de conveniência. O `conferir`
prova que o balcão é recusado e que a proposta continua esperando quem pode.

**Duas decisões de detalhe que valem registro:**

*O agente chama os MESMOS serviços que a tela chama.* Se tivesse um caminho
paralelo para escrever no banco, a regra de negócio existiria em dois lugares
e um dos dois ficaria para trás — normalmente o que ninguém olha.

*Proposta vale 24 horas.* Depois disso o estoque e o preço já são outros, e
confirmar uma proposta velha grava uma decisão tomada sobre dados que não
existem mais.

**Modelo padrão: `claude-sonnet-5`.** O custo por conversa fica em
`custo-ia.ts`, visível e testado, não escondido no adaptador — porque é ele
que decide se a mensalidade fecha. Um cliente que conversa muito pode consumir
mais do que paga, e sem medir ninguém percebe até o fim do trimestre. O teto
diário existe pelo mesmo motivo, e por um segundo: um defeito que faça o
agente responder a si mesmo em laço queima a conta numa madrugada.

**Descartado:** dar ao agente um usuário próprio com papel de sistema. Seria
mais simples de programar e teria criado exatamente o problema que a camada
quatro resolve — um ator dentro do sistema que ninguém consegue explicar quem
autorizou.

---

## 13. Neutro quente, e por que o cinza exato foi desfeito (fechado 07/09)

O neutro do sistema já foi puxado para o verde (tela lavada) e para o azul
(tela de hospital). A correção foi ir para o **cinza exato, sem viés nenhum**,
com o argumento de que o neutro é papel e papel não participa.

Esse argumento estava errado pela metade. Papel de verdade **não é cinza** —
livro, cartão de visita e nota fiscal puxam todos para o creme. Cinza exato
resolveu os dois defeitos anteriores e criou um terceiro, que foi o que o dono
apontou duas vezes: não parece escolhido, parece o que veio de fábrica.

**Decisão:** o neutro é papel quente (`--fundo: #f6f4f0`), e o par disso é o
azul-noite que já era da barra. Creme com azul-marinho é combinação de
papelaria, e é ela que dá o ar caro sem gastar nenhuma das cores que
significam alguma coisa. No escuro, a mesma ideia invertida: o fundo puxa para
o azul da barra em vez de ser carvão neutro, senão vira cinza de terminal.

Três coisas vieram junto, e nenhuma é cor:

- **Profundidade em três degraus** — repouso, alta e o *realce*, que é o fio de
  luz na borda de cima. É ele que separa "retângulo com sombra" de objeto com
  espessura.
- **Hierarquia na faixa de números** — quatro fichas do mesmo peso não são
  hierarquia, são fileira: o olho não sabe onde pousar. Uma por faixa vem em
  azul-noite com o desenho do sol atrás. Uma só; duas é a fileira de novo.
- **Traço vetorial** (`src/ui/Traco.tsx`) — bússola, curva de nível e raios,
  tirados do próprio símbolo. Nunca atrás de número ou texto que se lê: fundo
  desenhado embaixo de tabela é a diferença entre tela cara e tela cansativa.

### Pulsar é caro

Movimento chama atenção **uma vez**. Tela onde tudo pisca é tela onde nada
chama, e o pulso passa a ser ruído que a pessoa aprende a ignorar — junto com
o alerta de verdade.

Então pulsa só o que a pessoa precisa **resolver**, e só o que **piora sozinho
com o tempo**: conta vencida (juro corre) e proposta do assistente esperando
(expira em 24h). Para quando ela resolve. E o pulso é um halo que abre e some,
nunca a peça mudando de tamanho — coisa que cresce empurra o vizinho e a tela
inteira treme junto. Quem pediu menos movimento no sistema operacional
continua vendo cor, borda e texto, que é onde o recado mora.

## 14. O que continua em aberto

- [ ] Confirmar domínio (`usenorte.com.br`) e registrar marca MISTA no INPI —
      "Norte" isolado é fraco, ver §1
- [ ] Regras de troca por loja (hoje são provisórias, do varejo genérico)
- [ ] Qual emissor de nota fiscal: Focus NFe ou Nuvem Fiscal
- [ ] Qual gateway da nossa mensalidade: Asaas, Iugu ou Vindi
- [ ] Z-API ou Meta oficial — já resolvido como degrau de plano (§6), falta contratar
