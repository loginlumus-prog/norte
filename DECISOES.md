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

## 10. O que continua em aberto

- [ ] Confirmar domínio e viabilidade de marca do nome **Norte**
- [ ] Regras de troca por loja (hoje são provisórias, do varejo genérico)
- [ ] Qual emissor de nota fiscal: Focus NFe ou Nuvem Fiscal
- [ ] Qual gateway da nossa mensalidade: Asaas, Iugu ou Vindi
