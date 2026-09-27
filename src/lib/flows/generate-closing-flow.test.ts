import { describe, it, expect } from 'vitest'
import { buildClosingFlowNodes, type HorarioForFlow } from './generate-closing-flow'

const PACOTE_ID = 'pacote-1'

function byKey(nodes: ReturnType<typeof buildClosingFlowNodes>, key: string) {
  const n = nodes.find((n) => n.node_key === key)
  if (!n) throw new Error(`node ${key} not found`)
  return n
}

describe('buildClosingFlowNodes', () => {
  it('skips the picker entirely with 0 horários — start goes straight to ask_data', () => {
    const nodes = buildClosingFlowNodes(PACOTE_ID, [])
    expect(byKey(nodes, 'start').config).toEqual({ next_node_key: 'ask_data' })
    expect(nodes.find((n) => n.node_type === 'send_list')).toBeUndefined()
    const reserva = byKey(nodes, 'fazer_reserva')
    expect(reserva.config).toMatchObject({ pacote_id: PACOTE_ID, pacote_horario_var_key: '' })
  })

  it('skips the picker with exactly 1 horário — wires it in via a single set_var', () => {
    const horarios: HorarioForFlow[] = [
      { id: 'h1', hora_saida: '08:00:00', hora_volta: '12:00:00', capacidade_pessoas: 16 },
    ]
    const nodes = buildClosingFlowNodes(PACOTE_ID, horarios)
    expect(byKey(nodes, 'start').config).toEqual({ next_node_key: 'set_horario_0' })
    expect(nodes.find((n) => n.node_type === 'send_list')).toBeUndefined()
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
    const nodes = buildClosingFlowNodes(PACOTE_ID, horarios)
    expect(byKey(nodes, 'start').config).toEqual({ next_node_key: 'ask_horario' })
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
    const nodes = buildClosingFlowNodes(PACOTE_ID, horarios)
    const rows = (byKey(nodes, 'ask_horario').config.sections as { rows: { title: string }[] }[])[0].rows
    expect(rows.map((r) => r.title)).toEqual(['09:00', '15:00'])
  })

  it('omits the payment step by default (requirePayment=false)', () => {
    const nodes = buildClosingFlowNodes(PACOTE_ID, [])
    expect(byKey(nodes, 'fazer_reserva').config).toMatchObject({ success_next: 'enviar_voucher' })
    expect(nodes.find((n) => n.node_type === 'create_payment')).toBeUndefined()
  })

  it('inserts the payment step between booking and voucher when requirePayment=true', () => {
    const nodes = buildClosingFlowNodes(PACOTE_ID, [], true)
    expect(byKey(nodes, 'fazer_reserva').config).toMatchObject({ success_next: 'cobrar_pagamento' })
    const pay = byKey(nodes, 'cobrar_pagamento')
    expect(pay.node_type).toBe('create_payment')
    expect(pay.config).toEqual({ success_next: 'enviar_voucher', failure_next: 'pagamento_falhou' })
    expect(byKey(nodes, 'pagamento_falhou').config).toMatchObject({ next_node_key: 'transferir_pagamento' })
    expect(byKey(nodes, 'transferir_pagamento').node_type).toBe('handoff')
  })

  it('always includes the fixed tail: create_reservation, voucher, confirmado/end, sem_vagas/handoff', () => {
    const nodes = buildClosingFlowNodes(PACOTE_ID, [])
    const keys = nodes.map((n) => n.node_key)
    expect(keys).toEqual(
      expect.arrayContaining([
        'start',
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
})
