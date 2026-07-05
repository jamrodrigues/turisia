# 06 — Revisão crítica: gaps encontrados e onde foram tratados

> Segunda passada sobre o plano, confrontando código real do wacrm + cenário de produção real (clientes brasileiros,
> WhatsApp não-oficial). Cada gap indica ONDE foi incorporado no plano.

## Gaps GRAVES (quebrariam em produção) — já incorporados

| # | Gap | Risco se ignorado | Tratado em |
|---|-----|-------------------|-----------|
| 1 | **Mensagens de grupo** (`@g.us`) chegam pelo uazapi | Bot responde dentro de grupos do cliente | Fase 01 §1.7.1 |
| 2 | **Áudio sem transcrição** | IA "cega" para voz — clínica é caso de uso pesado de áudio | Fase 02 §2.6 |
| 3 | **Sem debounce** de rajadas de mensagens | 4 msgs curtas → 4 respostas picadas da IA | Fase 02 §2.5 + migration 034 |
| 4 | **Janela 24h da Meta** codificada no envio/broadcast | Envio manual/broadcast bloqueado sem motivo no uazapi | Fase 01 §1.7.5-6 |
| 5 | **`fromMe` do celular do dono** | Dono responde pelo aparelho e o bot fala por cima | Fase 01 §1.7.7 (grava + cala bot) |
| 6 | **Tipos fora do CHECK** (`sticker`, `contact`, `poll`) | INSERT falha → mensagem perdida silenciosamente | Fase 01 §1.7.2 |
| 7 | **Reentrega de webhook** (dedup) | Mensagens duplicadas no inbox e IA respondendo 2x | Fase 01 §1.7.8 + índice na 034 |
| 8 | **Mídia recebida em URL externa** do servidor uazapi | Histórico com mídia quebrada quando a URL expira | Fase 01 §1.7.3 (Storage, infra da 023) |
| 9 | **Broadcast era 100% template-Meta** | Broadcasts inoperantes no uazapi | Fase 01 §1.7.6 (texto livre + rate-limit) |

## Gaps MENORES / operacionais — decididos aqui (não precisam de seção própria)

1. **Realtime do inbox** — o wacrm usa Supabase Realtime para o inbox atualizar ao vivo. Mensagens inseridas via
   service role (webhook uazapi) publicam igual, **desde que** a publicação realtime das tabelas
   `messages`/`conversations` esteja habilitada no projeto novo do cliente. Adicionado ao checklist por cliente.
2. **Indicador "digitando..."** — uazapi tem endpoint de presença. Humaniza o bot (enviar presence antes da
   resposta + delay proporcional ao tamanho do texto). **Fica para Fase 06** (polish), não bloqueia MVP.
3. **LGPD / dados de saúde** — a clínica trafega dado sensível. Mitigado pela arquitetura (1 projeto Supabase por
   cliente, RLS, segredos cifrados). Ações mínimas: contrato com cláusula de tratamento de dados, retenção
   definida, e **não** logar corpo de mensagens em produção (só ids). Revisar `console.log` do webhook antes do
   go-live (o log de payload cru do §1.6 é só para o passo de mapeamento — REMOVER depois).
4. **Backups** — Supabase online já faz backup diário (plano pago: PITR). Anotar no inventário de clientes qual
   plano/retention cada projeto tem. Clínica: recomendar plano com PITR.
5. **Merge de upstream** — o wacrm evolui (v0.7.0 hoje). Manter o remote `upstream` no fork e avaliar merge por
   release. Como nossas mudanças são concentradas (adapter + dispatcher + rotas novas), conflitos tendem a ser
   pequenos. Processo documentado junto ao `deploy/UPGRADE.md` (Fase 04.4).
6. **Rate-limit na rota do webhook uazapi** — o wacrm já tem rate limiting nas rotas; aplicar o mesmo middleware à
   rota nova. (Fase 01, junto do §1.4 — lembrete.)
7. **Timeout do n8n** — round-trip síncrono CRM→n8n tem `maxDuration=60` do route handler como teto. Fluxos de
   agendamento com múltiplas tools podem passar de 25s. Se acontecer: mudar o cliente para o modo assíncrono já
   previsto (Fase 02 §2.3 alternativa) — endpoint `agent-reply`. Monitorar duração no n8n desde o dia 1.
8. **Nome/pushName do contato** — uazapi manda `senderName`; usar para criar o contato com nome legível (o Meta
   manda `profile.name`). Já coberto pelo mapeamento §1.6, só não esquecer o campo.
9. **Fuso horário** — agendamentos da clínica: garantir TZ `America/Sao_Paulo` no fluxo n8n e nas datas gravadas
   (timestamptz sempre; conversão na exibição). Aplicar no §5.1.

## O que segue explicitamente FORA do escopo (decisão, não esquecimento)

- Multi-tenant single-deploy (`org_id`) — arquitetura atual é 1 deploy/cliente; revisitar com 10+ clientes.
- Pagamento integrado (Stripe) — Fase 06, após faturar manual.
- Migração de histórico de conversas antigas do n8n atual para o CRM — começa do zero; histórico velho fica no
  WhatsApp do aparelho.
- Atendimento por múltiplos números no mesmo cliente — 1 número/instância por cliente no MVP.

## Veredicto da revisão

Plano cobre: fork→adapter→IA/handoff→papéis→provisionamento→onboarding→comercial, com os 9 gaps graves fechados.
Riscos residuais monitoráveis: (a) formato do payload uazapi (passo de captura obrigatório na Fase 01 §1.6);
(b) timeout n8n síncrono (fallback assíncrono pronto no plano); (c) antiban uazapi (diretrizes Fase 06.5).
