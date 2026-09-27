import type { SupabaseClient } from '@supabase/supabase-js'

// ============================================================
// Generates a full "Fechar <pacote>" automated-closing flow graph —
// the same node shape hand-authored for the first one ("Fechar
// Buggy", 2026-09-08) — from a package's own configured horários,
// instead of a human writing the flow_nodes JSON by hand each time.
// This is what makes automated closing scale to the whole catalog
// instead of staying a one-off demo.
//
// Node builder is pure (testable without a DB); the DB write is a
// thin wrapper so the graph shape stays independently verifiable.
// ============================================================

export interface HorarioForFlow {
  id: string
  hora_saida: string
  hora_volta: string | null
  capacidade_pessoas: number
}

export interface FlowNodeSeed {
  node_key: string
  node_type: string
  config: Record<string, unknown>
}

function formatTime(t: string): string {
  return t.slice(0, 5)
}

/**
 * Builds the node graph for a closing flow. Branches on how many
 * active horários the package has:
 *   - 0: no slot picker — data/quantidade only, no capacity check
 *     (create_reservation gets an empty pacote_horario_var_key).
 *   - 1: no picker either — a single set_var wires the one horario in
 *     directly, skipping a "choose between 1 option" prompt.
 *   - 2+: a send_list lets the customer pick, each row landing on its
 *     own set_var node before they converge on the same next step.
 */
export function buildClosingFlowNodes(
  pacoteId: string,
  horarios: HorarioForFlow[],
  /**
   * Insert the Pix charge step between booking and voucher. Only true
   * when the account has an ACTIVE payment_config at generation time
   * (checked by the caller, generateClosingFlowForPacote) — an account
   * with no Mercado Pago token configured gets the pre-Fase-B shape
   * (reserve → voucher immediately), so existing flows regenerated
   * before payments are set up don't suddenly start failing every
   * booking into "payments not configured".
   */
  requirePayment: boolean = false,
): FlowNodeSeed[] {
  const nodes: FlowNodeSeed[] = []

  const afterHorarioKey = 'ask_data'
  let startNext: string

  if (horarios.length === 0) {
    startNext = afterHorarioKey
  } else if (horarios.length === 1) {
    startNext = 'set_horario_0'
    nodes.push({
      node_key: 'set_horario_0',
      node_type: 'set_var',
      config: { var_key: 'pacote_horario_id', value: horarios[0].id, next_node_key: afterHorarioKey },
    })
  } else {
    startNext = 'ask_horario'
    nodes.push({
      node_key: 'ask_horario',
      node_type: 'send_list',
      config: {
        text: 'Show! Qual horário fica melhor?',
        button_label: 'Escolher horário',
        sections: [
          {
            title: 'Horários',
            rows: horarios.map((h, i) => ({
              reply_id: `h_${i}`,
              title: h.hora_volta
                ? `${formatTime(h.hora_saida)}–${formatTime(h.hora_volta)}`
                : formatTime(h.hora_saida),
              description: `até ${h.capacidade_pessoas} pessoas`,
              next_node_key: `set_horario_${i}`,
            })),
          },
        ],
      },
    })
    horarios.forEach((h, i) => {
      nodes.push({
        node_key: `set_horario_${i}`,
        node_type: 'set_var',
        config: { var_key: 'pacote_horario_id', value: h.id, next_node_key: afterHorarioKey },
      })
    })
  }

  nodes.push(
    { node_key: 'start', node_type: 'start', config: { next_node_key: startNext } },
    {
      node_key: 'ask_data',
      node_type: 'collect_input',
      config: {
        prompt_text: 'Pra qual data? (ex: 09/09 ou 09/09/2026)',
        var_key: 'data',
        next_node_key: 'ask_qtd',
      },
    },
    {
      node_key: 'ask_qtd',
      node_type: 'collect_input',
      config: { prompt_text: 'Quantas pessoas vão?', var_key: 'quantidade', next_node_key: 'fazer_reserva' },
    },
    {
      node_key: 'fazer_reserva',
      node_type: 'create_reservation',
      config: {
        pacote_id: pacoteId,
        pacote_horario_var_key: horarios.length > 0 ? 'pacote_horario_id' : '',
        data_var_key: 'data',
        quantidade_var_key: 'quantidade',
        success_next: requirePayment ? 'cobrar_pagamento' : 'enviar_voucher',
        failure_next: 'sem_vagas',
      },
    },
    { node_key: 'enviar_voucher', node_type: 'send_voucher', config: { next_node_key: 'confirmado' } },
    {
      node_key: 'confirmado',
      node_type: 'send_message',
      config: {
        text: 'Reserva confirmada! 🎉 O voucher com todos os detalhes acabou de chegar aqui em cima. Qualquer dúvida, é só chamar!',
        next_node_key: 'fim',
      },
    },
    { node_key: 'fim', node_type: 'end', config: {} },
    {
      node_key: 'sem_vagas',
      node_type: 'send_message',
      config: {
        text: 'Poxa, não temos vaga nesse horário pra essa data 😔 Vou te conectar com um atendente pra ver outras opções.',
        next_node_key: 'transferir',
      },
    },
    {
      node_key: 'transferir',
      node_type: 'handoff',
      config: { note: 'Fechamento automático sem vagas no horário/data pedido.' },
    },
  )

  if (requirePayment) {
    nodes.push(
      {
        node_key: 'cobrar_pagamento',
        node_type: 'create_payment',
        config: { success_next: 'enviar_voucher', failure_next: 'pagamento_falhou' },
      },
      {
        node_key: 'pagamento_falhou',
        node_type: 'send_message',
        config: {
          text: 'Poxa, não consegui gerar a cobrança agora 😔 Vou te conectar com um atendente pra fechar por outro meio.',
          next_node_key: 'transferir_pagamento',
        },
      },
      {
        node_key: 'transferir_pagamento',
        node_type: 'handoff',
        config: { note: 'Fechamento automático: falha ao gerar cobrança Pix.' },
      },
    )
  }

  return nodes
}

function keywordsForCategory(category: string): string[] {
  return [
    `reservar ${category}`,
    `fechar ${category}`,
    `quero o ${category}`,
    `reservar o ${category}`,
    `fechar o ${category}`,
    `quero reservar o ${category}`,
  ]
}

/**
 * Creates (or, if one already exists for this package's category,
 * regenerates) the account's "Fechar <pacote>" flow — full delete +
 * reinsert of its nodes, since the graph is fully derived from the
 * package's current horários and there's nothing hand-edited to
 * preserve. Idempotent: safe to call again after the agency changes
 * horários (e.g. adds a new slot).
 *
 * Uses the caller's own (RLS-scoped) Supabase client — flows/
 * flow_nodes grant direct agent+ writes (017_account_sharing.sql), no
 * server route needed, same convention as the rest of this session's
 * account-scoped writes.
 */
export async function generateClosingFlowForPacote(
  supabase: SupabaseClient,
  args: { pacoteId: string; accountId: string; userId: string },
): Promise<{ flowId: string; flowName: string }> {
  const { pacoteId, accountId, userId } = args

  const { data: pacote, error: pacoteErr } = await supabase
    .from('pacotes')
    .select('id, name, category')
    .eq('id', pacoteId)
    .eq('account_id', accountId)
    .maybeSingle()
  if (pacoteErr || !pacote) throw new Error('Pacote não encontrado')
  const category = (pacote.category as string | null)?.trim().toLowerCase()
  if (!category) {
    throw new Error('Defina uma categoria pro pacote antes de gerar o fechamento automático')
  }

  const { data: horariosRaw, error: horariosErr } = await supabase
    .from('pacote_horarios')
    .select('id, hora_saida, hora_volta, capacidade_pessoas')
    .eq('pacote_id', pacoteId)
    .eq('is_active', true)
    .order('hora_saida')
  if (horariosErr) throw new Error('Falha ao carregar horários do pacote')
  const horarios = (horariosRaw ?? []) as HorarioForFlow[]

  // payment_config SELECT is admin+-only (062, same posture as
  // ai_configs/whatsapp_config) — an agent generating this flow won't
  // be able to read it and always gets requirePayment: false. That's
  // the safe default (skips charging rather than risking a
  // misconfigured charge), not a security gap; an admin regenerating
  // the flow after activating payments is the expected path.
  const { data: paymentConfig } = await supabase
    .from('payment_config')
    .select('is_active')
    .eq('account_id', accountId)
    .maybeSingle()
  const requirePayment = !!paymentConfig?.is_active

  const flowName = `Fechar ${pacote.name as string}`
  const trigger_config = { keywords: keywordsForCategory(category), match_type: 'contains', case_sensitive: false }

  // Reuse an existing flow for this topic if one exists (regardless of
  // status — regenerating a draft/archived one just refreshes it),
  // rather than creating a duplicate the unique-active-per-topic index
  // (061) would reject anyway once activated.
  const { data: existing } = await supabase
    .from('flows')
    .select('id')
    .eq('account_id', accountId)
    .eq('ai_topic', category)
    .maybeSingle()

  let flowId: string
  if (existing) {
    flowId = existing.id as string
    const { error: updErr } = await supabase
      .from('flows')
      .update({
        name: flowName,
        description: `Gerado automaticamente a partir dos horários de "${pacote.name}".`,
        status: 'active',
        trigger_type: 'keyword',
        trigger_config,
        entry_node_id: 'start',
      })
      .eq('id', flowId)
    if (updErr) throw new Error('Falha ao atualizar o fluxo')
    const { error: delErr } = await supabase.from('flow_nodes').delete().eq('flow_id', flowId)
    if (delErr) throw new Error('Falha ao limpar os passos antigos do fluxo')
  } else {
    const { data: inserted, error: insErr } = await supabase
      .from('flows')
      .insert({
        account_id: accountId,
        user_id: userId,
        name: flowName,
        description: `Gerado automaticamente a partir dos horários de "${pacote.name}".`,
        status: 'active',
        trigger_type: 'keyword',
        trigger_config,
        entry_node_id: 'start',
        ai_topic: category,
      })
      .select('id')
      .single()
    if (insErr || !inserted) throw new Error('Falha ao criar o fluxo')
    flowId = inserted.id as string
  }

  const nodes = buildClosingFlowNodes(pacoteId, horarios, requirePayment)
  const { error: nodesErr } = await supabase
    .from('flow_nodes')
    .insert(nodes.map((n) => ({ flow_id: flowId, ...n })))
  if (nodesErr) throw new Error('Falha ao criar os passos do fluxo')

  return { flowId, flowName }
}
