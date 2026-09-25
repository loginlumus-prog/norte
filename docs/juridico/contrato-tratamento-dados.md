# Acordo de Tratamento de Dados Pessoais (DPA)

> **RASCUNHO — revisar com o jurídico.** Minuta de acordo entre o Norte
> (operador) e a loja cliente (controladora). Trechos entre colchetes `[...]`
> precisam ser preenchidos ou decididos. As medidas de segurança da cláusula 6
> foram conferidas no código em 25/09/2026 — **não acrescente medida que o
> sistema não tenha**: acordo que promete o que o código não faz é armadilha
> para quem escreveu.

---

**ACORDO DE TRATAMENTO DE DADOS PESSOAIS**

Anexo aos Termos de Uso do Norte (`/termos`), dos quais faz parte.

**OPERADOR:** [RAZÃO SOCIAL DO NORTE], inscrita no CNPJ sob o nº
[CNPJ], com sede em [ENDEREÇO COMPLETO], doravante **"Norte"**.

**CONTROLADORA:** a empresa identificada no cadastro da conta no Norte, que
aceitou os Termos de Uso, doravante **"Loja"**.

Encarregado do Norte: [NOME DO ENCARREGADO] — privacidade@usenorte.com.br.

## 1. Definições

Os termos "dado pessoal", "tratamento", "controlador", "operador",
"encarregado", "titular", "incidente de segurança" e "transferência
internacional" têm o sentido da Lei nº 13.709/2018 (**LGPD**) e das
resoluções da **ANPD**. **Suboperador** é quem o Norte contrata para tratar
dados em nome da Loja.

## 2. Objeto e papéis

2.1. Este acordo rege o tratamento, pelo Norte, dos dados pessoais que a Loja
coloca no sistema ou que chegam a ele por conta dela — em especial os dados
dos **clientes da Loja**.

2.2. A **Loja é a controladora**: decide quais dados coleta, para que, com
que base legal e por quanto tempo. O **Norte é operador** e trata esses dados
só para prestar o serviço contratado.

2.3. Sobre os dados da **própria Loja enquanto cliente** (cadastro da empresa,
usuários, cobrança), o Norte é controlador, e vale a Política de Privacidade
(`/privacidade`) — não este acordo.

## 3. Dados e titulares

| Titulares | Dados | Finalidade |
|---|---|---|
| Clientes da Loja | Nome, telefone, e-mail, CPF, endereço, data de nascimento, histórico de compra, pontos, parcelas de crediário | Vender, cobrar, fidelizar — a gestão da Loja |
| Clientes da Loja, no WhatsApp | Número, nome de perfil, conteúdo das mensagens (texto e mídia), participação em campanhas | Atender e rodar as campanhas que a Loja montou |
| Equipe da Loja | Nome, e-mail, telefone, papel, conversas com o assistente, registro de ações (livro de auditoria) | Operar o sistema com controle de acesso |
| Fornecedores da Loja | Nome, documento, contato, contas a pagar | Gestão financeira |

A Loja não deve colocar no sistema **dado pessoal sensível** (art. 5º, II, da
LGPD) — saúde, religião, biometria etc. — que não seja necessário ao negócio.
[jurídico: avaliar se proíbe ou só desaconselha]

## 4. Instruções da Loja

4.1. O Norte trata os dados **somente conforme as instruções documentadas da
Loja**. São instruções: estes Termos e este acordo; a configuração que a Loja
faz no sistema (campanhas, recado automático, assistente, integrações); e
pedidos por escrito do dono da conta.

4.2. Se uma instrução parecer violar a LGPD, o Norte avisa a Loja e pode
suspender o cumprimento dela até o esclarecimento.

4.3. O Norte **não** usa os dados da Loja para finalidade própria: não vende,
não aluga, não cede para publicidade e não usa para treinar modelo de IA.

## 5. Confidencialidade

5.1. Só tem acesso aos dados quem precisa para prestar o serviço, e todos
estão obrigados a sigilo, por contrato ou por lei.

5.2. A equipe do Norte só acessa dados da Loja **a pedido dela** (suporte) ou
para cumprir obrigação legal ou ordem de autoridade.

5.3. O acesso de suporte é feito pelo próprio sistema, com um papel **só de
leitura**, com **prazo e motivo** registrados. **Cada tela aberta, cada ação
tentada e cada planilha baixada nesse acesso gera, sozinha, uma linha no livro
de auditoria da Loja** ("acesso do suporte do Norte"), com o endereço aberto
(sem o que foi digitado em busca), o motivo do acesso e a hora — no máximo uma
linha por tela a cada 10 minutos. Se a linha não puder ser gravada, o acesso é
recusado. A Loja vê essas linhas na tela Auditoria.
[técnico: conceder o acesso de suporte ainda é feito à mão pelo operador, sem
tela; e acesso direto ao banco com credencial administrativa (manutenção,
incidente) não passa por este registro — restringir a esses casos e
registrar à parte]

## 6. Medidas de segurança

O Norte mantém, no mínimo, as medidas abaixo — todas existentes no sistema na
data desta minuta:

**Isolamento entre empresas**
- Toda tabela com dado de cliente carrega a identificação da empresa, e todo
  acesso ao banco passa por uma única função que carimba a empresa da
  requisição antes de qualquer consulta.
- **Segurança em nível de linha** (RLS) do PostgreSQL ligada e **forçada** em
  toda tabela com dado de empresa: mesmo uma consulta sem filtro volta vazia
  para dados de outra empresa. A aplicação usa um papel de banco sem
  privilégio de dono.
- Testes automatizados que tentam vazar dados de uma empresa para outra, de
  vários jeitos, e precisam falhar em todos antes de qualquer publicação.
- A credencial usada antes do login enxerga apenas nove colunas de uma tabela
  (nome, endereço, logo e cor da empresa).

**Acesso**
- Controle de acesso por **capacidade**, conferido **no servidor** em toda
  ação, inclusive nas que a tela já escondeu; ninguém concede papel que não
  tem.
- Senha guardada com **scrypt** (algoritmo lento, com sal) — nunca em texto.
- Convite de equipe guardado só como resumo (SHA-256).
- Freio de tentativas de login: por e-mail e por endereço IP, em janela de 15
  minutos.
- Sessão por cookie com escopo por empresa, conferida contra o banco a cada
  tela.

**Credenciais de terceiros**
- Tokens de WhatsApp da Loja (conexão oficial da Meta e Z-API) e a sessão do
  WhatsApp conectado por QR Code guardados **cifrados** com AES-256-GCM, com a
  chave fora do banco (variável de ambiente do servidor) e presos à empresa
  (o texto cifrado de uma empresa não abre na linha de outra).

**Rastreabilidade**
- **Livro de auditoria** de ações (quem, o quê, quando, antes e depois) que
  só recebe linha nova: alteração e exclusão são revogadas no próprio banco.
  A única escrita permitida em linha antiga é a da anonimização de um cliente
  (cláusula 9.2), feita por uma função do banco que só troca o nome da pessoa
  por "Cliente anonimizado" e tira os dados pessoais — nunca a ação, quem fez,
  o valor ou a data.
- Todo acesso do suporte do Norte registrado no livro da Loja (cláusula 5.3).

**Transporte e navegador**
- Tráfego cifrado (HTTPS), com HSTS; política de segurança de conteúdo (CSP)
  com nonce; proteção contra enquadramento (X-Frame-Options), contra
  adivinhação de tipo (nosniff), Referrer-Policy e Cross-Origin-Opener-Policy.
- Arquivos de mídia das campanhas entregues por endereço assinado e com prazo.

**Conector do WhatsApp por QR Code**
- Conector ↔ Norte autenticados nos dois sentidos (token do lado do Norte;
  assinatura HMAC-SHA256 do pedido inteiro, com carimbo de tempo, do lado do
  conector).
- O conector não grava a sessão em disco e não registra em log texto de
  mensagem, número completo ou segredo.

**Inteligência artificial**
- Mensagem de **cliente da Loja nunca é enviada ao modelo de IA**; só as
  conversas da equipe com o assistente.
- O assistente **propõe**; ação que mexe em dinheiro, preço, estoque ou
  cadastro só acontece com a confirmação de uma pessoa da equipe com
  permissão para fazer o mesmo pela tela.

**Pagamento**
- O Norte não recebe nem guarda dado de cartão ou conta bancária.

[técnico: confirmar e descrever a política de **cópias de segurança** do
plano contratado no Supabase (frequência, retenção, onde ficam) antes de
citar qualquer número aqui.]

## 7. Suboperadores

7.1. A Loja autoriza, de forma geral, os suboperadores da tabela abaixo,
mantida atualizada em `/privacidade` (seção "Quem mais toca nos dados"):

| Suboperador | Para quê | Onde |
|---|---|---|
| Supabase | Banco de dados | São Paulo, Brasil |
| [Hospedagem: Oracle Cloud **ou** Vercel **ou** Render — manter só a confirmada] | Rodar o sistema e o conector do WhatsApp | [São Paulo, Brasil / Virgínia, EUA] |
| Anthropic | Modelo de IA do assistente — só conversas da equipe | Estados Unidos |
| Meta Platforms | WhatsApp Business Platform, quando a Loja conecta pelo caminho oficial | Fora do Brasil |
| Z-API | Envio de mensagens, só para a Loja que usa conta própria no Z-API | [a confirmar] |
| [Meio de pagamento] | Cobrança da mensalidade (dados da Loja, não dos clientes dela) | [a definir] |

7.2. Na **conexão por QR Code**, as mensagens passam pela rede do WhatsApp sob
a conta e os termos que a própria Loja aceitou com o WhatsApp.
[jurídico: enquadrar o papel do WhatsApp/Meta nessa conexão]

7.3. O Norte avisa a Loja com **30 dias** de antecedência antes de incluir ou
trocar um suboperador. A Loja pode se opor por motivo razoável ligado à
proteção de dados; não havendo acordo, pode encerrar o contrato sem multa.

7.4. O Norte impõe a cada suboperador obrigações de proteção de dados no
mínimo equivalentes às deste acordo, e responde perante a Loja pelo que o
suboperador fizer, nos limites dos Termos.
[jurídico: conferir se os termos padrão de cada fornecedor atendem]

## 8. Transferência internacional

Parte do tratamento acontece fora do Brasil (Anthropic, Meta, e a rede do
WhatsApp). Essas transferências se apoiam em
**[a definir pelo jurídico: cláusulas-padrão da ANPD — Resolução CD/ANPD nº
19/2024 — ou outro mecanismo do art. 33 da LGPD]**. A transferência para o
modelo de IA acontece só enquanto a Loja mantiver o assistente ligado.

## 9. Direitos dos titulares

9.1. Quem responde aos titulares é a Loja. O Norte ajuda com o que o sistema
permite: consultar, corrigir, desativar, **anonimizar** e exportar cadastros de
clientes pela própria tela, e registrar o aceite e a revogação do aceite para
ofertas no WhatsApp (sim ou não, quando, por qual caminho, quem anotou).

9.2. **Anonimizar** um cliente é feito pela própria Loja, na ficha dele, por
quem configura a empresa ("Anonimizar este cliente", com confirmação
digitada); ou pelo Norte, a pedido da Loja ou do titular, em até **15 dias**.
A anonimização apaga nome, telefone, e-mail, CPF, endereço, data de
nascimento e observações do cadastro; as conversas de WhatsApp com aquele
número; a participação nas campanhas; o nome e o telefone nas encomendas; e o
nome e os dados pessoais nas linhas do livro de auditoria sobre a pessoa.
Vendas, parcelas, vales e pontos continuam existindo, desligados do nome da
pessoa (registro fiscal). O número, reduzido a DDD e oito últimos dígitos,
fica na lista de quem não recebe ofertas da Loja, para ninguém escrever de
novo. Enquanto houver parcela de crediário em aberto ou encomenda por
entregar, a anonimização é recusada até a pendência ser resolvida.

9.2-A. Quem manda **PARAR** pelo WhatsApp sai da campanha em andamento e entra
na lista de quem não recebe ofertas da Loja de forma permanente; só sai dela
mandando **VOLTAR**. A Loja não desfaz o PARAR pela tela. O sistema só deixa
sair oferta começada pela Loja (modelo fora da janela de conversa) para quem
tem o aceite registrado e não está na lista.

9.3. Se um titular procurar o Norte diretamente, o Norte avisa a Loja no mesmo
dia útil e responde ao titular informando o caminho, sem decidir no lugar dela.
[jurídico: o que fazer se a Loja não responder]

## 10. Incidentes de segurança

10.1. O Norte comunica à Loja qualquer incidente que envolva os dados dela em
até **[48 horas / 2 dias úteis]** depois de tomar conhecimento, com o que se
sabe até ali: o que aconteceu, que dados e titulares foram afetados, o que já
foi feito e o que a Loja precisa fazer. Informação que chegar depois é enviada
assim que existir.

10.2. A comunicação à ANPD e aos titulares cabe à Loja, como controladora
(Resolução CD/ANPD nº 15/2024); o Norte fornece o que for preciso para isso,
no prazo que permita à Loja cumprir o dela.
[jurídico: confirmar a divisão e os prazos]

## 11. Fim do contrato

11.1. Encerrado o contrato, a Loja tem **30 dias** para exportar os dados.

11.2. Passado esse prazo, o Norte **apaga** os dados da Loja em até **90
dias**, inclusive das cópias de segurança, conforme o ciclo delas.

11.3. Fica apenas o que a lei obriga a guardar, pelo prazo legal e só para
isso. [jurídico: listar — registro de acesso (Marco Civil, art. 15, 6 meses);
registros fiscais do próprio Norte]

11.4. A Loja pode pedir **declaração** de que a exclusão foi feita.

## 12. Auditoria

12.1. O Norte disponibiliza à Loja, mediante pedido, as informações
necessárias para demonstrar o cumprimento deste acordo — descrição das medidas
da cláusula 6, lista de suboperadores e registros de incidentes que a
envolvam.

12.2. Auditoria presencial ou por terceiro independente é possível com
**[30] dias** de aviso, no máximo **uma vez por ano** (salvo após incidente ou
por ordem da ANPD), em horário comercial, sem acesso a dados de outras
empresas, com o custo por conta de quem pede. [jurídico: ajustar]

## 13. Responsabilidade

A responsabilidade de cada parte segue a LGPD (arts. 42 a 45) e, no que a lei
permitir limitar, a cláusula de responsabilidade dos Termos de Uso.

## 14. Vigência e prevalência

Este acordo vale enquanto durar o contrato e, depois dele, pelo tempo em que o
Norte ainda tiver dados da Loja. Em conflito com os Termos de Uso sobre
proteção de dados, prevalece este acordo.

---

## Pendências consolidadas

- [ ] Identidade do Norte: razão social, CNPJ, endereço, encarregado.
- [ ] Hospedagem confirmada (e tirar as outras da tabela da cláusula 7).
- [ ] Mecanismo de transferência internacional (cláusula 8).
- [ ] Papel do WhatsApp/Meta na conexão por QR Code (7.2).
- [ ] Prazo de aviso de incidente (10.1) e divisão com a ANPD (10.2).
- [ ] Política de cópias de segurança do Supabase (cláusula 6).
- [x] Registro de acesso de suporte (5.3) e ferramenta de anonimização (9.2)
      — existem no sistema desde 25/09/2026.
- [ ] Tela (ou procedimento escrito) para conceder o acesso de suporte, e
      regra para o acesso administrativo direto ao banco (5.3).
- [ ] Localização do Z-API.
- [ ] Regras de auditoria (12.2).
