# Manual do Usuário — Turia

Bem-vindo ao **Turia**, o sistema de gestão completo para sua agência de turismo. Este manual foi elaborado para ajudar funcionários da agência a usar o sistema de forma prática e eficiente.

> **Nota importante:** Este manual não cobre a seção de Fluxos (construtor visual de automações). Essa funcionalidade será documentada separadamente.

---

## 1. Visão Geral

O Turia é uma plataforma integrada que centraliza todas as operações da sua agência de turismo:

- **Contatos** — cadastro e histórico de clientes
- **Reservas** — agendamento de passeios e atividades
- **Pacotes** — catálogo de produtos oferecidos
- **Financeiro** — controle de contas, lançamentos e saldo
- **WhatsApp (Inbox)** — comunicação automática e manual com clientes
- **Pipelines (Negócios)** — gestão de vendas por estágios
- **Broadcasts** — disparos em massa via WhatsApp
- **Agenda Operacional** — coordenação de motoristas, guias e veículos
- **Tarefas** — atribuição de atividades à equipe
- **Automações** — regras simples de trigger → ação (diferentes de Fluxos)
- **Notificações** — avisos de eventos importantes
- **Configurações** — conexão com WhatsApp, IA, pagamentos, perfil da agência

---

## 2. Login e Primeiro Acesso

Ao acessar a plataforma:

1. Abra a página inicial do Turia
2. Insira seu **e-mail** e **senha**
3. Clique em **"Entrar"**

Se esqueceu a senha:
1. Clique em **"Esqueci a senha?"**
2. Insira seu e-mail
3. Clique em **"Enviar link de redefinição"**
4. Acesse o link enviado ao seu e-mail e defina uma nova senha

**Na primeira vez:** Um administrador da agência deverá convidar você. Você receberá um link de convite que permite criar uma conta e se conectar à agência.

---

## 3. Dashboard — Visão Geral da Agência

O Dashboard é a tela inicial depois do login. Exibe:

### Métricas Principais (cartões no topo)
- **Conversas ativas** — número de clientes conversando agora no WhatsApp
- **Novos contatos hoje** — quantos clientes novos foram adicionados
- **Valor de negócios abertos** — soma em reais dos negócios em andamento (não finalizados)
- **Mensagens enviadas hoje** — total de mensagens do WhatsApp

### Gráficos e Tabelas
- **Conversas nos últimos 7/30/90 dias** — gráfico de linha mostrando volume de mensagens
- **Distribuição de negócios** — rosca (donut) mostrando quanto cada estágio tem em valor de negócios
- **Tempo de resposta** — quanto tempo leva para responder clientes (em minutos)
- **Agenda de hoje** — próximas saídas/passeios (motoristas, guias, horários)
- **Feed de atividade** — últimas ações: mensagens recebidas, contatos adicionados, negócios atualizados, broadcasts enviados

Use o Dashboard para monitorar a saúde geral da agência a cada dia.

---

## 4. Contatos

### Visualizar Contatos
1. Clique em **"Contatos"** no menu superior
2. Veja a lista com nome, telefone e informações de cada contato
3. Use a barra de busca para procurar por **nome, telefone ou e-mail**

### Cadastrar Novo Contato
1. Clique em **"Novo contato"** (botão azul)
2. Preencha:
   - **Nome** (obrigatório)
   - **Telefone** (obrigatório)
   - **E-mail** (opcional)
   - **Origem/Fonte** (de onde veio o contato: web, indicação, redes sociais, etc.)
3. Clique em **"Salvar"**

### Editar Contato
1. Clique no contato na lista
2. Modifique os campos necessários
3. Clique em **"Salvar"**

### Tags e Atributos
Você pode adicionar **tags** (etiquetas) aos contatos para organizá-los:
- Ex.: "VIP", "Interessado em mergulho", "Novato"
- Acesse a aba de **tags** quando estiver editando um contato

### Deletar Contato
1. Selecione o contato
2. Clique no ícone de **lixeira**
3. Confirme a exclusão

---

## 5. Inbox — Conversas de WhatsApp

### Ver Conversas
1. Clique em **"Inbox"** no menu superior
2. À esquerda, veja a lista de contatos com mensagens não lidas (marcadas em negrito)
3. Clique em um contato para ver a conversa

### Responder Mensagem
1. Na parte inferior da conversa, digite sua resposta
2. Clique em **"Enviar"** ou pressione Enter
3. A mensagem será entregue via WhatsApp

### Transferir para Humano
Se a IA estiver respondendo automaticamente e você quiser tomar controle:
1. Clique no botão **"Transferir para humano"** (ou similar)
2. A IA parará de responder; próximas mensagens virão pra você

### Usar IA para Responder
O sistema pode gerar sugestões de respostas:
1. Você verá uma caixa com "Resposta sugerida"
2. Clique para aceitar, ou edite antes de enviar
3. Configure a IA nas **Configurações > IA**

---

## 6. Pacotes — Catálogo de Produtos

### Ver Pacotes
1. Clique em **"Pacotes"** no menu superior
2. Veja cards com foto, nome, preço e duração de cada pacote

### Criar Pacote
1. Clique em **"Novo pacote"** (botão azul)
2. Preencha:
   - **Nome do pacote** (ex.: "Passeio de Buggy pela Praia")
   - **Categoria** (ex.: "Aventura", "Relaxamento", etc.)
   - **Descrição** — o que está incluso, ponto de encontro, o que levar
   - **Preço** (em reais)
   - **Duração** (em minutos ou horas)
   - **Foto de capa** — upload de uma imagem principal
   - **Galeria** — adicione mais fotos/vídeos
3. Clique em **"Salvar"**

### Editar ou Deletar Pacote
1. Abra o pacote (clique no card)
2. Clique em **"Editar"** ou **"Deletar"** (ícones no canto)
3. Confirme a ação

### Horários do Pacote
Ao criar/editar um pacote, defina **horários disponíveis**:
1. Clique em **"Adicionar horário"**
2. Defina **hora de saída** e **hora de volta** (se houver)
3. Especifique **dias da semana** em que está disponível
4. Salve

---

## 7. Reservas — Agendamento de Passeios

### Ver Reservas
1. Clique em **"Reservas"** no menu superior
2. Veja uma **tira de 14 dias** (próximos 2 semanas)
3. Cada dia mostra os passeios reservados naquela data

### Criar Reserva Manual
1. Clique em **"Nova reserva"** (botão azul)
2. Preencha:
   - **Contato** — selecione quem está reservando
   - **Pacote** — qual passeio/atividade
   - **Data** — quando será
   - **Horário** — hora de saída (será preenchida conforme o pacote)
   - **Quantidade de pessoas** — quantas pessoas na reserva
   - **Observações** — anotações especiais (alergias, preferências, etc.)
3. Clique em **"Salvar"**

### Status de Reserva
Cada reserva tem um status:
- **Pendente** — aguardando confirmação
- **Confirmada** — cliente confirmou
- **Cancelada** — não será realizado

Clique na reserva para mudar o status ou adicionar anotações.

### Recibo
1. Abra a reserva
2. Clique em **"Baixar recibo"** (ícone de download)
3. Um PDF será gerado com os detalhes da reserva

> **Importante:** O Turia monitora as reservas para fechar automaticamente pacotes quando todos os assentos estão cheios (funcionalidade de fechamento automático).

---

## 8. Agenda Operacional — Logística de Motoristas, Guias e Veículos

### Motoristas
1. Clique em **"Motoristas"** no menu superior, dentro do grupo **"Logística"**
2. Veja lista de motoristas cadastrados
3. **Novo motorista:** preencha nome, contato, placa do veículo (se aplicável), e clique em "Salvar"
4. **Editar/deletar:** clique nos ícones correspondentes

### Guias
1. Clique em **"Guias"** no menu superior, dentro do grupo **"Logística"**
2. Mesma lógica: visualizar, criar, editar ou deletar
3. Cada guia tem nome e contato (WhatsApp)

### Veículos
1. Clique em **"Veículos"** no menu superior, dentro do grupo **"Logística"**
2. Cadastre:
   - **Modelo** (ex.: "Van Sprinter")
   - **Placa**
   - **Capacidade** (quantas pessoas cabem)
3. Gerencie como os outros recursos

### Saídas (Operacional)
1. Clique em **"Agenda Operacional"** no menu superior, dentro do grupo **"Logística"**
2. Veja a agenda de saídas agendadas
3. **Alocar reserva:** ao confirmar uma reserva, ela aparece aqui e você a aloca a um motorista/guia/veículo

---

## 9. Pipelines — Gestão de Negócios (CRM)

### Ver Pipeline
1. Clique em **"Pipelines"** no menu superior, dentro do grupo **"CRM & Automação"**
2. Veja **colunas** para cada estágio de negócio (ex.: "Leads", "Propostas", "Vendidos")
3. Cada card é um negócio (deal)

### Criar Negócio
1. Clique em **"Novo negócio"** (botão azul)
2. Preencha:
   - **Título** (ex.: "Empresa XYZ - 50 pessoas")
   - **Valor** (em reais)
   - **Moeda** (selecione BRL por padrão)
   - **Estágio** (qual coluna começa)
   - **Descrição/Notas** (dados extras)
3. Clique em **"Salvar"**

### Mover Negócio Entre Estágios
1. Simplesmente **arraste o card** da coluna de origem para a coluna de destino
2. O sistema atualiza automaticamente

### Editar ou Deletar
1. Clique no card de negócio
2. Modifique os dados ou delete
3. Salve

### Filtros e Análises
Na página de pipelines você vê:
- **Valor total** do pipeline
- **Valor médio** por deal
- **Distribuição** por estágio (gráfico)

---

## 10. Broadcasts — Disparos em Massa

### Envio Simples (Quick Send)
1. Clique em **"Broadcasts"** > **"Envio Rápido"** (ou similar)
2. Preencha:
   - **Nome do envio** (ex.: "Promoção Julho")
   - **Mensagem** — texto que será enviado a cada contato
3. Clique em **"Enviar"** (ou "Agendar", se quiser data/hora específica)

### Novo Disparo Completo
Para disparos com múltiplas etapas (seleção de público, personalização, etc.):
1. Clique em **"Novo disparo"**
2. Passo 1: **Selecione o público** — quais contatos receberão (todos, com tag, filtrados)
3. Passo 2: **Personalize a mensagem** — use variáveis como {{contato.nome}}, {{contato.telefone}}
4. Passo 3: **Agenda** — envie agora ou agende para data/hora
5. Clique em **"Enviar"**

### Status de Broadcast
- **Rascunho** — não foi enviado, ainda editando
- **Agendado** — pronto para enviar em data específica
- **Enviando** — está sendo enviado agora
- **Enviado** — concluído
- **Falhou** — houve erro (verifique contatos/conexão com WhatsApp)

### Visualizar Resultados
1. Clique no broadcast na lista
2. Veja:
   - Número de **destinatários**
   - Quantos **entregues**, **lidos**, **responderam**
   - Taxa de sucesso

---

## 11. Financeiro — Contas e Lançamentos

### Contas
1. Clique em **"Financeiro"** no menu superior
2. Na aba **"Contas"**, veja saldo de cada conta bancária/caixa
3. **Nova conta:**
   - Nome (ex.: "Conta Corrente BB")
   - Saldo inicial
4. Clique em **"Salvar"**

### Lançamentos (Transações)
1. Na aba **"Lançamentos"**, registre entradas e saídas:
   - **Tipo** — entrada (+) ou saída (-)
   - **Valor** (em reais)
   - **Descrição** (ex.: "Pagamento Mercado Pago - Reserva #123")
   - **Data**
   - **Conta** — em qual conta foi feito
2. Clique em **"Registrar"**

### Visualizar Saldo
- Cada conta mostra seu saldo atual
- Lançamentos ficam registrados com data e descrição
- Use para auditorias e reconciliação com sua banca

---

## 12. Tarefas

### Ver Tarefas
1. Clique em **"Tarefas"** no menu superior, dentro do grupo **"CRM & Automação"**
2. Veja lista com:
   - Descrição da tarefa
   - Responsável (quem vai fazer)
   - Status (pendente, concluído)
   - Data limite

### Criar Tarefa
1. Clique em **"Nova tarefa"** (botão azul)
2. Preencha:
   - **Descrição** (ex.: "Ligar para cliente Maria")
   - **Responsável** — quem fará a tarefa
   - **Data limite**
   - **Prioridade** (alta, média, baixa)
3. Clique em **"Salvar"**

### Concluir ou Reabrir
1. Clique na tarefa na lista
2. Mude o **status** de "Pendente" para "Concluído"
3. Você pode **reabrir** uma tarefa concluída clicando novamente

### Filtros
Use os filtros para encontrar tarefas:
- Por responsável
- Por status
- Por prioridade

---

## 13. Automações — Regras Simples (Diferentes de Fluxos)

**Automações** são **diferentes de Fluxos**. Enquanto Fluxos são estruturas visuais complexas, Automações são **regras simples de trigger → ação**.

### Ver Automações
1. Clique em **"Automações"** no menu superior, dentro do grupo **"CRM & Automação"**
2. Veja lista de regras ativas e iativas

### Criar Automação
1. Clique em **"Nova automação"** (botão azul)
2. Escolha um **trigger** (evento que ativa a regra):
   - Novo contato criado
   - Mensagem recebida com palavra-chave (ex.: "oi", "olá")
   - Data/hora específica (cron)
3. Configure a **ação** (o que fazer):
   - Enviar mensagem automática
   - Atribuir tag
   - Criar tarefa
   - Enviar para agente (humano)
4. Clique em **"Salvar"**

### Ativar/Desativar
- Clique no toggle **"Ativo"** para ligar ou desligar uma automação
- Automações desativadas não serão executadas

### Ver Histórico
- Clique em uma automação e vá para a aba **"Logs"**
- Veja todas as vezes que foi disparada, para quais contatos e se foi bem-sucedida

---

## 14. Configurações — Conexões e Perfil

### WhatsApp (uazapi)
1. Clique em **"Configurações"** > **"WhatsApp"**
2. Você verá a **conexão com uazapi** (integradora de WhatsApp Business)
3. Se não estiver conectado:
   - Clique em **"Conectar WhatsApp"**
   - Siga as instruções para vincular sua conta de WhatsApp Business
4. Uma vez conectado, o sistema pode enviar e receber mensagens automaticamente

### IA (Inteligência Artificial)
1. Clique em **"Configurações"** > **"IA"**
2. Escolha o **modo do robô**: Desligado, Simples ou Avançado (fluxo n8n)
3. No modo Simples, configure:
   - **Provedor** — OpenAI ou Anthropic (Claude)
   - **Modelo** e **Chave de API** — sua própria chave do provedor escolhido
   - **Chave de embeddings** (opcional) — ativa busca semântica na base de conhecimento
   - **Contexto do negócio e instruções** — texto explicando pro robô como sua agência funciona, o tom de voz e o que ele pode/não pode prometer
   - **Ativar assistente de IA** e **Responder automaticamente mensagens recebidas** (dois interruptores separados)
   - **Máximo de respostas automáticas por conversa** — depois desse número o bot fica quieto e espera um humano
4. Clique em **"Testar chave"** pra confirmar que a chave funciona antes de salvar
5. Clique em **"Salvar"**

> Não existe um limite de gasto mensal configurável no sistema — o custo de IA depende do seu provedor (OpenAI/Anthropic) e é cobrado diretamente por eles, fora do Turia.

### Pagamentos (Pix via Mercado Pago)
1. Clique em **"Configurações"** > **"Pagamentos"**
2. Preencha:
   - **Access Token** — o token de acesso da sua conta Mercado Pago (em "Suas integrações → Credenciais" no painel do Mercado Pago)
   - **Chave secreta do webhook** — configurada em "Suas integrações → Webhooks" no Mercado Pago, apontando pra URL que o próprio formulário mostra
   - **Cobrança automática ativa** — interruptor que liga/desliga a cobrança dentro dos fluxos de fechamento automático
3. Clique em **"Salvar"**

O pagamento hoje é **só via Pix** (gerado automaticamente pelo Mercado Pago) — não há opção de cartão de crédito nem chave Pix cadastrada manualmente.

### Perfil da Agência
1. Clique em **"Configurações"** > **"Perfil"**
2. Atualize:
   - **Nome da agência**
   - **CNPJ**
   - **Telefone**
   - **E-mail**
   - **Endereço**
   - **Logo** (upload de imagem)
   - **Redes sociais**
3. Clique em **"Salvar"**

Essas informações aparecem em recibos, confirmações e outros documentos enviados aos clientes.

---

## 15. Papéis e Permissões

O Turia tem quatro níveis de acesso, do mais alto pro mais baixo:

- **Owner** (Dono) — acesso total, incluindo as únicas duas ações exclusivas dele: excluir a conta e transferir a propriedade pra outro membro
- **Admin** — igual ao Owner no dia a dia: edita configurações da conta inteira (WhatsApp, IA, pagamentos, perfil da agência), convida e remove membros; só não pode excluir a conta nem transferir a propriedade
- **Agent** (Agente) — opera o dia a dia: envia mensagens, cadastra contatos, move negócios no pipeline, cria reservas, dispara broadcasts, edita automações; não acessa configurações da conta
- **Viewer** (Visualizador) — só visualiza dados em todo o sistema, não pode editar nada

### Convidar Novo Usuário
1. Clique em **"Configurações"** > **"Membros"** ou **"Usuários"**
2. Clique em **"Convidar"**
3. Insira:
   - **E-mail** do novo funcionário
   - **Papel** (admin, agente, visualizador)
4. Clique em **"Enviar convite"**
5. O funcionário receberá um link de confirmação no e-mail

### Remover Usuário
1. Na lista de membros, localize o usuário
2. Clique em **"Deletar"** ou **"Remover acesso"**
3. Confirme

---

## 16. Notificações

1. Clique em **"Notificações"** no menu superior
2. Veja todos os alertas da plataforma:
   - Novas mensagens de clientes
   - Reservas confirmadas/canceladas
   - Broadcasts enviados
   - Erros de sistema
3. Clique em uma notificação para ir direto à ação relacionada

---

## 17. Dicas e Boas Práticas

### Dashboard Diário
- Acesse o Dashboard todo dia para monitorar conversas ativas e novos contatos

### Responda Rápido
- Clientes precisam de respostas rápidas; use o Inbox para gerenciar WhatsApp

### Mantenha Contatos Organizados
- Use tags para separar clientes (VIP, em definição, etc.)

### Fechamento de Pacotes
- O sistema fecha automaticamente pacotes cheios; monitore a Agenda para confirmar que motoristas, guias e veículos foram atribuídos

### Revise Broadcasts
- Antes de enviar um broadcast em massa, revise a lista de contatos e a mensagem

### Backup de Dados Críticos
- Informações de reservas e pagamentos são críticas; peça ao admin para fazer backups regulares

---

## 18. Suporte e Ajuda

Se encontrar dúvidas ou problemas:

1. **Consulte este manual** — muitas respostas estão aqui
2. **Contacte seu admin** — ele tem acesso a mais configurações e pode resolver problemas de permissão
3. **Verifique notificações** — o sistema avisa sobre erros e limitações
4. **Teste com dados fictícios** — não tenha medo de criar contatos/tarefas de teste

---

## Conclusão

O Turia centraliza toda a gestão da sua agência em um único lugar. Comece pelo Dashboard e Inbox, depois explore Contatos, Pacotes e Reservas conforme precisar. Com o tempo, você descobrirá fluxos de trabalho que funcionam melhor para seu time.

Bom trabalho!
