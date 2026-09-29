import { describe, it, expect } from 'vitest'
import { buildClosingFlowNodes, buildUpcomingDays, type HorarioForFlow } from './generate-closing-flow'

const PACOTE_ID = 'pacote-1'
const PACOTE_NAME = 'Passeio de Buggy'
const PRICE = 180

// Fixed reference date so date-list nodes are deterministic across runs.
const NOW = new Date(2026, 8, 28) // 2026-09-28 (Mon)

function byKey(nodes: ReturnType<typeof buildClosingFlowNodes>, key: string) {
  const n = nodes.find((n) => n.node_key === key)
  if (!n) throw new Error(`node ${key} not found`)
  return n
}

function build(horarios: HorarioForFlow[], requirePayment = false) {
  return buildClosingFlowNodes(PACOTE_ID, PACOTE_NAME, PRICE, horarios, requirePayment, NOW)
}

describe('buildUpcomingDays', () => {
  it('labels the first two days Hoje/Amanhã and the rest by weekday, all as ISO values', () => {
    const days = buildUpcomingDays(7, NOW)
    expect(days).toHaveLength(7)
    expect(days[0]).toEqual({ iso: '2026-09-28', label: 'Hoje 28/09' })
    expect(days[1]).toEqual({ iso: '2026-09-29', label: 'Amanhã 29/09' })
    expect(days[2]).toEqual({ iso: '2026-09-30', label: 'Qua 30/09' })
    expect(days[6]).toEqual({ iso: '2026-10-04', label: 'Dom 04/10' })
  })
})

describe('buildClosingFlowNodes', () => {
  it('opens with an intro message showing the package name and price', () => {
    const nodes = build([])
    expect(byKey(nodes, 'start').config).toEqual({ next_node_key: 'intro' })
    const intro = byKey(nodes, 'intro')
    expect(intro.node_type).toBe('send_message')
    expect(intro.config.text).toContain(PACOTE_NAME)
    // NBSP-tolerant — Intl.NumberFormat('pt-BR') may insert U+00A0
    // between "R$" and the number depending on the ICU data available.
    expect(intro.config.text).toContain('R$')
    expect(intro.config.text).toContain('180,00')
  })

  it('skips the horário picker entirely with 0 horários — intro goes straight to ask_data', () => {
    const nodes = build([])
    expect(byKey(nodes, 'intro').config).toMatchObject({ next_node_key: 'ask_data' })
    expect(nodes.filter((n) => n.node_type === 'send_list')).toHaveLength(1) // just the date picker
    const reserva = byKey(nodes, 'fazer_reserva')
    expect(reserva.config).toMatchObject({ pacote_id: PACOTE_ID, pacote_horario_var_key: '' })
  })

  it('skips the horário picker with exactly 1 horário — wires it in via a single set_var', () => {
    const horarios: HorarioForFlow[] = [
      { id: 'h1', hora_saida: '08:00:00', hora_volta: '12:00:00', capacidade_pessoas: 16 },
    ]
    const nodes = build(horarios)
    expect(byKey(nodes, 'intro').config).toMatchObject({ next_node_key: 'set_horario_0' })
    expect(byKey(nodes, 'set_horario_0').config).toEqual({
      var_key: 'pacote_horario_id',
      value: 'h1',
      next_node_key: 'ask_data',
    })
    const reserva = byKey(nodes, 'fazer_reserva')
    expect(reserva.config).toMatchObject({ pacote_horario_var_key: 'pacote_horario_id' })
  })

  it('builds a send_list picker with one row + set_var per horário when there are 2+', () => {
    const horarios: HorarioForFlow[] = [
      { id: 'h1', hora_saida: '08:00:00', hora_volta: '12:00:00', capacidade_pessoas: 16 },
      { id: 'h2', hora_saida: '14:00:00', hora_volta: '18:00:00', capacidade_pessoas: 16 },
    ]
    const nodes = build(horarios)
    expect(byKey(nodes, 'intro').config).toMatchObject({ next_node_key: 'ask_horario' })
    const list = byKey(nodes, 'ask_horario')
    expect(list.node_type).toBe('send_list')
    const rows = (list.config.sections as { rows: { reply_id: string; title: string; next_node_key: string }[] }[])[0].rows
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ reply_id: 'h_0', title: '08:00–12:00', next_node_key: 'set_horario_0' })
    expect(rows[1]).toMatchObject({ reply_id: 'h_1', title: '14:00–18:00', next_node_key: 'set_horario_1' })
    expect(byKey(nodes, 'set_horario_0').config).toEqual({
      var_key: 'pacote_horario_id',
      value: 'h1',
      next_node_key: 'ask_data',
    })
    expect(byKey(nodes, 'set_horario_1').config).toEqual({
      var_key: 'pacote_horario_id',
      value: 'h2',
      next_node_key: 'ask_data',
    })
  })

  it('formats a horário with no hora_volta as a bare time', () => {
    const horarios: HorarioForFlow[] = [
      { id: 'h1', hora_saida: '09:00:00', hora_volta: null, capacidade_pessoas: 10 },
      { id: 'h2', hora_saida: '15:00:00', hora_volta: null, capacidade_pessoas: 10 },
    ]
    const nodes = build(horarios)
    const rows = (byKey(nodes, 'ask_horario').config.sections as { rows: { title: string }[] }[])[0].rows
    expect(rows.map((r) => r.title)).toEqual(['09:00', '15:00'])
  })

  it('asks for the date via a 7-day send_list, each row landing on its own set_var into ask_qtd', () => {
    const nodes = build([])
    const list = byKey(nodes, 'ask_data')
    expect(list.node_type).toBe('send_list')
    const rows = (list.config.sections as { rows: { reply_id: string; title: string; next_node_key: string }[] }[])[0].rows
    expect(rows).toHaveLength(7)
    expect(rows[0]).toMatchObject({ reply_id: 'd_0', title: 'Hoje 28/09', next_node_key: 'set_data_0' })
    expect(byKey(nodes, 'set_data_0').config).toEqual({
      var_key: 'data',
      value: '2026-09-28',
      next_node_key: 'ask_qtd',
    })
    expect(byKey(nodes, 'set_data_6').config).toMatchObject({ next_node_key: 'ask_qtd' })
  })

  it('omits the payment step by default (requirePayment=false)', () => {
    const nodes = build([])
    expect(byKey(nodes, 'fazer_reserva').config).toMatchObject({ success_next: 'enviar_voucher' })
    expect(nodes.find((n) => n.node_type === 'create_payment')).toBeUndefined()
  })

  it('inserts the payment step between booking and voucher when requirePayment=true', () => {
    const nodes = build([], true)
    expect(byKey(nodes, 'fazer_reserva').config).toMatchObject({ success_next: 'cobrar_pagamento' })
    const pay = byKey(nodes, 'cobrar_pagamento')
    expect(pay.node_type).toBe('create_payment')
    expect(pay.config).toEqual({ success_next: 'enviar_voucher', failure_next: 'pagamento_falhou' })
    expect(byKey(nodes, 'pagamento_falhou').config).toMatchObject({ next_node_key: 'transferir_pagamento' })
    expect(byKey(nodes, 'transferir_pagamento').node_type).toBe('handoff')
  })

  it('always includes the fixed tail: create_reservation, voucher, confirmado/end, sem_vagas/handoff', () => {
    const nodes = build([])
    const keys = nodes.map((n) => n.node_key)
    expect(keys).toEqual(
      expect.arrayContaining([
        'start',
        'intro',
        'ask_data',
        'ask_qtd',
        'fazer_reserva',
        'enviar_voucher',
        'confirmado',
        'fim',
        'sem_vagas',
        'transferir',
      ]),
    )
    expect(byKey(nodes, 'fazer_reserva').config).toMatchObject({
      success_next: 'enviar_voucher',
      failure_next: 'sem_vagas',
    })
    expect(byKey(nodes, 'sem_vagas').config).toMatchObject({ next_node_key: 'transferir' })
    expect(byKey(nodes, 'transferir').node_type).toBe('handoff')
    expect(byKey(nodes, 'fim').node_type).toBe('end')
  })

  it('the confirmado message offers the catalog as a soft upsell', () => {
    const nodes = build([])
    expect(byKey(nodes, 'confirmado').config.text).toContain('pacotes')
  })

  it('offers a waitlist branch on sem_vagas when the package has real horários', () => {
    const horarios: HorarioForFlow[] = [
      { id: 'h1', hora_saida: '08:00:00', hora_volta: '12:00:00', capacidade_pessoas: 16 },
    ]
    const nodes = build(horarios)
    expect(byKey(nodes, 'sem_vagas').config).toMatchObject({ next_node_key: 'ask_lista_espera' })
    const ask = byKey(nodes, 'ask_lista_espera')
    expect(ask.node_type).toBe('send_buttons')
    const buttons = ask.config.buttons as { reply_id: string; next_node_key: string }[]
    expect(buttons).toEqual([
      { reply_id: 'sim', title: 'Sim, quero', next_node_key: 'entrar_lista_espera' },
      { reply_id: 'nao', title: 'Não, obrigado', next_node_key: 'transferir' },
    ])
    expect(byKey(nodes, 'entrar_lista_espera').config).toEqual({
      pacote_id: PACOTE_ID,
      pacote_horario_var_key: 'pacote_horario_id',
      data_var_key: 'data',
      quantidade_var_key: 'quantidade',
      next_node_key: 'confirmado_lista_espera',
    })
    expect(byKey(nodes, 'confirmado_lista_espera').config).toMatchObject({ next_node_key: 'fim' })
    expect(byKey(nodes, 'transferir').node_type).toBe('handoff')
  })

  it('skips the waitlist offer entirely with 0 horários — sem_vagas goes straight to handoff', () => {
    const nodes = build([])
    expect(byKey(nodes, 'sem_vagas').config).toMatchObject({ next_node_key: 'transferir' })
    expect(nodes.find((n) => n.node_key === 'ask_lista_espera')).toBeUndefined()
    expect(nodes.find((n) => n.node_type === 'join_waitlist')).toBeUndefined()
  })
})
