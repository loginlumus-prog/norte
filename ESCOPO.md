# Sistema de gestão + agente de WhatsApp (white-label)

> Nome de trabalho: **gestor**. Trocar quando o nome comercial for definido
> (renomear a pasta basta — nada depende do nome ainda).

Fora do OneDrive de propósito: o watcher do dev se perde com a sincronização
e o CSS para de recarregar (aconteceu no projeto da loja).

---

## 1. O que é

Sistema de gestão para comércio pequeno, **sem site/e-commerce**, onde o dono
opera e consulta a empresa conversando com um agente de IA no WhatsApp.

## 2. O que NÃO é

- Não é loja online. Sem vitrine, catálogo público, carrinho, checkout, frete.
- Não é gestor de projeto genérico (kanban/gantt/doc). Esse mercado já tem dono.
- Não é chatbot de atendimento. O agente **age** no sistema, não só responde.

---

## 3. Decisões fechadas

| # | Decisão | Motivo |
|---|---|---|
| 1 | Sem site. Só sistema. | Tira ~metade do código e quase todo o custo variável e de suporte. |
| 2 | Crediário **fica**, como módulo ligável. | É a ação que gera recibo em dinheiro. Sem ela o agente vira relatório. |
| 3 | Agente é criado e batizado pelo cliente. | White-label. "Donna" é marca do cliente atual, não do produto. |
| 4 | Instrução personalizada **nunca** define permissão. | Segurança. Ver seção 6. |
| 5 | Toda ação do agente emite recibo em R$. | O que não vira número no fim do mês não sustenta renovação. |
| 6 | `tenant_id` desde a primeira tabela. | Ver seção 4. |
| 7 | NF-e terceirizada (Focus NFe / NFE.io). | Não construir integração com SEFAZ. |

## 4. Multi-tenant desde a primeira linha

O sistema da loja é single-tenant (`store_config` tem 1 linha, `id = "default"`,
e a loja está escrita na mão em 55 arquivos). Adaptar aquilo depois seriam
**6 a 10 semanas**.

Começando do zero, isso custa quase nada — desde que seja feito desde o começo:

- `tenant_id` em **toda** tabela, sem exceção.
- RLS por tenant em toda tabela, escrita junto com a tabela (nunca depois).
- Nada de `MODA_ATIVA` / URL / cor / PIN escrito no código. Tudo em config por tenant.
- **Teste de isolamento antes do primeiro cliente pago.** O projeto atual tem
  0 testes; aqui não dá — vazamento entre tenants mata a empresa no primeiro dia.

## 5. Núcleo × módulos

**Núcleo (todo cliente):** produtos · estoque · PDV/venda de balcão · caixa ·
financeiro/DRE · despesas · funcionários e permissões · livro de auditoria ·
WhatsApp + agente.

**Módulos (liga/desliga por tenant):** crediário (devedores, parcelas, juros,
cobrança, acordo, link de pagamento) · nota fiscal · conciliação de maquininha ·
metas e ranking de vendedor.

Degrau de preço: núcleo ≈ R$349/mês · com crediário ≈ R$697/mês. (a validar)

## 6. Regras invioláveis do agente

1. **Instrução ≠ permissão.** Texto livre define personalidade e política de
   conversa. Permissão é caixinha marcada na tela, com teto numérico, no banco.
   Motivo: texto pode ser sobrescrito por quem manda mensagem no WhatsApp.
2. **Mexeu em dinheiro, preço ou estoque → propõe, humano confirma.**
   Padrão `propor_*` + `confirmar_alteracao`, que já funciona hoje.
3. **Teto em tudo:** desconto máximo, valor máximo de link, gasto de IA por dia,
   mensagens por dia.
4. **Tudo assinado.** Toda ação vai pro livro de auditoria com antes/depois,
   valor e quem fez (humano ou agente).
5. **Só carrega as ferramentas que o tenant ligou.** Mandar 22 ferramentas sempre
   encarece cada mensagem sem motivo.

## 7. Ações do agente, por prioridade

Ordem = quanto dinheiro gera e quão fácil é provar o número.

| Ordem | Ação | Recibo que ela emite |
|---|---|---|
| 1 | Cobrar crediário vencido | "recuperei R$ X esse mês" |
| 2 | Trazer cliente sumido | "trouxe N clientes, R$ X em compras" |
| 3 | Destravar estoque parado | "destravei R$ X em peça encalhada" |
| 4 | Avisar ruptura do que vende | "evitei ruptura em N itens" |
| 5 | Relatório 2x/dia | (não é recibo, é hábito — mantém o agente vivo) |
| 6 | Divergência de caixa | "achei R$ X de diferença" |
| 7 | Conta a pagar vs. saldo | "avisei N vencimentos" |
| 8 | Meta/ranking do vendedor de manhã | muda comportamento |

## 8. Portar, não reescrever

Código já validado em produção no projeto da loja
(`C:\Users\dealt\OneDrive\Documentos\LOJADEROUPA\src\lib\`).
Portar com adaptação para multi-tenant — **não refazer do zero**:

| Arquivo | Tam. | O que é |
|---|---|---|
| `donna-whatsapp.ts` | 75 KB | O agente inteiro: ferramentas, fila, pausa p/ humano |
| `comprovante.ts` | 36 KB | Comprovantes |
| `crediario.ts` | 28 KB | Dívida, parcela, acordo |
| `dre-pdf.ts` | 28 KB | DRE em PDF |
| `etiqueta.ts` | 25 KB | Etiqueta 33x22 (Elgin L42 Pro) |
| `financeiro.ts` | 20 KB | Financeiro |
| `caixa.ts` | 18 KB | Caixa, movimento, fechamento |
| `donna.ts` | 17 KB | Agente do painel |
| `dre-blocos.ts` | 14 KB | Blocos do DRE |
| `estoque.ts` + `estoque-baixa.ts` | 15 KB | Grade cor x tamanho, baixa atômica |
| `conciliacao.ts` | 12 KB | Taxa de maquininha |
| `assinatura*.ts` | 16 KB | Livro de auditoria |
| `juros.ts` | 6 KB | Juros do parcelamento |

Junto vem o conhecimento que custou caro descobrir: baixa de estoque tem que
travar a linha; número da equipe não pode entrar na fila de cobrança; as 5
armadilhas do PDV offline; a chave da parcela.

---

## 8.1 Catálogo: o que o modelo assume (decidido 07/09)

O produto NAO tem "cor" e "tamanho" no codigo. A empresa nomeia os proprios
eixos: a loja de roupa cria Cor e Tamanho, a sapataria cria Numeracao, a
sorveteria cria Sabor. Com colunas fixas, a sapataria ja entraria torta.

Todo produto tem pelo menos UMA variacao, mesmo quando nao varia. Sem isso,
estoque e venda teriam dois caminhos ("as vezes e no produto, as vezes na
variacao") — que e onde bug de estoque nasce.

Unidade de medida no produto (un, kg, L, par...), porque vender 0,340 kg de
sorvete e vender 1 blusa precisam caber na mesma venda.

**Fora da v1, e nao se promete:** ficha tecnica (um sundae consome 100 g de
sorvete + 30 g de calda, e o insumo precisa baixar junto) e validade/lote.
Sao modulo proprio, nao nucleo. Entram com nome e fase se food service virar
alvo de verdade.

---

## 9. Pendências de decisão (bloqueiam a venda, não o código)

- [ ] **Quem é o cliente?** Uma frase, com nome. Sem isso não se vende.
      ("comércio de bairro, 1 a 3 lojas, 2 a 10 funcionários, vende no balcão e
      no WhatsApp, vende fiado" — confirmar ou trocar)
- [ ] **Nome comercial** do produto.
- [ ] **NF-e entra na v1?** Cortar o nicho aumenta a cobrança por NF, não diminui.
- [ ] **WhatsApp:** Z-API (R$55-100/mês por loja, não oficial, risco de banimento
      em escala) ou API oficial da Meta (cobra por conversa, exige verificação do
      Meta Business de cada cliente). Decidir antes de passar de ~15 clientes.
- [ ] **Preço** dos dois degraus.
