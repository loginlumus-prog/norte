# Checklist — verificação de empresa na Meta

> **RASCUNHO — revisar com o jurídico e com a contabilidade.** Lista do que o
> escritório de contabilidade precisa mandar, e do que o dono do Norte precisa
> deixar pronto, para a Meta verificar a empresa e aprovar o Norte como
> provedor de tecnologia (Tech Provider) do WhatsApp Business Platform.

## A regra que reprova mais do que qualquer outra

> **Tudo tem de bater, letra por letra, com o cartão CNPJ.**
>
> Razão social, endereço, telefone — no portfólio empresarial da Meta, no
> rodapé do site, nos Termos, na Política de Privacidade e em cada documento
> enviado. "LTDA" contra "Ltda.", "Rua" contra "R.", "Sala 3" contra "Sl 03",
> um acento a mais ou a menos: a análise é feita por comparação, e diferença é
> motivo de recusa. Na dúvida, **copie do cartão CNPJ** e cole.
>
> Por isso o site lê a identidade de um lugar só: `src/servidor/legal.ts`
> (`EMPRESA`). Preencha lá **copiando do cartão CNPJ**, e o rodapé, os Termos
> e a Política passam a mostrar exatamente o mesmo texto.

## 1. O que a contabilidade manda

Tudo em **PDF legível**, colorido de preferência, sem corte nas bordas, em nome
da **empresa** (não do sócio), e **recente** onde houver data.

- [ ] **Cartão CNPJ** — Comprovante de Inscrição e de Situação Cadastral,
      emitido no site da Receita Federal **nos últimos 30 dias**, situação
      **ATIVA**.
- [ ] **Contrato social consolidado** (ou a última alteração contratual
      consolidada), com o registro da Junta Comercial — ou, se for MEI, o
      **Certificado da Condição de Microempreendedor Individual (CCMEI)**.
- [ ] **Comprovante de endereço em nome da empresa**, de **até 90 dias**, com o
      **mesmo endereço do cartão CNPJ**: conta de luz, água, gás, telefone ou
      internet, ou extrato bancário da conta PJ. [conferir: se a empresa usa
      endereço fiscal/virtual ou de coworking, o comprovante precisa estar no
      nome dela nesse endereço]
- [ ] **Comprovante de telefone da empresa** (conta de telefone em nome da
      empresa), se o telefone for um dos meios de verificação escolhidos.
- [ ] **Inscrição municipal** (se houver) — reforço, não obrigatório.
- [ ] Nome e **CPF** de um sócio ou administrador que possa responder pela
      empresa (a Meta pode pedir que essa pessoa confirme a identidade dela
      na conta pessoal do Facebook).

Não mandar: documento de pessoa física no lugar do da empresa, print de tela,
foto torta de papel, documento de outro CNPJ (filial, empresa do sócio).

## 2. O que o dono do Norte deixa pronto

**Identidade no código** — `src/servidor/legal.ts`, objeto `EMPRESA`:

- [ ] `razaoSocial` — igual ao cartão CNPJ.
- [ ] `cnpj` — no formato `00.000.000/0000-00`.
- [ ] `endereco` — igual ao cartão CNPJ, com CEP.
- [ ] `encarregado` — nome do encarregado de dados (LGPD, art. 41).
- [ ] Publicar. Conferir que a tarja vermelha de "Rascunho" sumiu de
      `/termos`, `/privacidade` e `/exclusao-de-dados`, e que o rodapé da
      página inicial mostra razão social · CNPJ · endereço · e-mail.

**Site e domínio**

- [ ] Site no ar, em **HTTPS**, no domínio próprio (ex.: `usenorte.com.br`).
- [ ] Páginas públicas, abrindo **sem login**:
  - [ ] `https://<domínio>/privacidade` — URL da Política de Privacidade
  - [ ] `https://<domínio>/termos` — URL dos Termos de Serviço
  - [ ] `https://<domínio>/exclusao-de-dados` — URL de instruções de exclusão
        de dados
- [ ] **Verificação do domínio** no portfólio da Meta (registro TXT no DNS ou
      meta tag no site — o registro no DNS é o que não se perde num deploy).
- [ ] **E-mail no domínio** funcionando e lido por alguém (ex.:
      `contato@usenorte.com.br`, `privacidade@usenorte.com.br`): a Meta pode
      mandar o código de verificação para um e-mail **do domínio do site**.

**Portfólio empresarial da Meta** (business.facebook.com)

- [ ] Nome legal da empresa = razão social do cartão CNPJ.
- [ ] Endereço = cartão CNPJ.
- [ ] Telefone comercial que atenda (pode ser verificado por ligação ou SMS).
- [ ] Site = o domínio verificado.
- [ ] Pelo menos **dois administradores** com autenticação em dois fatores —
      se o único admin perder a conta, o portfólio fica sem dono.

**App do Norte na Meta** (developers.facebook.com)

- [ ] Ícone: `public/marca/norte-app-1024.png` (1024×1024); há também a versão
      de 512 em `public/marca/norte-app-512.png`.
- [ ] URL da Política de Privacidade, dos Termos e de exclusão de dados (as
      três acima).
- [ ] Categoria do app e e-mail de contato (o do domínio).
- [ ] App ligado ao portfólio **verificado**.

## 3. Ordem que costuma dar menos volta

1. Contabilidade manda os documentos da seção 1.
2. Preencher `EMPRESA` **copiando do cartão CNPJ**, publicar e conferir o
   rodapé e as três páginas.
3. Portfólio da Meta com os mesmos dados; verificar o domínio.
4. Enviar a verificação de empresa.
5. Com a empresa verificada, pedir a revisão do app (permissões do WhatsApp
   Business) e a verificação de acesso de provedor de tecnologia.

## 4. Motivos de recusa que dá para evitar

- Nome no portfólio diferente do documento (abreviação, nome fantasia no
  lugar da razão social).
- Endereço do comprovante diferente do cartão CNPJ.
- Comprovante velho (mais de 90 dias) ou em nome do sócio.
- Site sem a razão social ou sem o CNPJ visível, ou mostrando dados
  diferentes do documento.
- Política de privacidade que não abre sem login, ou que é de outro site.
- Domínio do e-mail diferente do domínio do site.

## Pendências

- [ ] Confirmar com a contabilidade se a empresa é LTDA, SLU ou MEI (muda o
      documento de constituição).
- [ ] Confirmar o domínio definitivo do site e dos e-mails.
- [ ] Designar o encarregado de dados.
