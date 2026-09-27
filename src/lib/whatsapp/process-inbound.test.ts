import { describe, it, expect } from 'vitest'
import { buildDispatchMessage, type NormalizedInbound } from './process-inbound'

/**
 * The flow engine only understands `text` and `interactive_reply` — no
 * media-consuming node exists. These tests lock the
 * NormalizedInbound → ParsedInbound mapping done by
 * buildDispatchMessage, without touching the database.
 */

function base(overrides: Partial<NormalizedInbound> = {}): NormalizedInbound {
  return {
    accountId: 'acc-1',
    configOwnerUserId: 'user-1',
    fromPhone: '5581999999999',
    pushName: 'Maria',
    waMessageId: 'wamid-1',
    timestamp: new Date('2026-07-26T12:00:00Z'),
    contentType: 'text',
    contentText: null,
    mediaUrl: null,
    mediaMimeType: null,
    interactiveReplyId: null,
    replyToWaMessageId: null,
    ...overrides,
  }
}

describe('buildDispatchMessage', () => {
  it('mídia (com ou sem mediaUrl) sempre degrada para texto — sem node de mídia na engine', () => {
    const msg = buildDispatchMessage(
      base({ contentType: 'image', mediaUrl: null, contentText: '[image não baixado]' }),
    )
    expect(msg.kind).toBe('text')
    if (msg.kind !== 'text') throw new Error('esperava text')
    expect(msg.text).toBe('[image não baixado]')
  })

  it('tap de botão (interactiveReplyId) vence mídia e texto', () => {
    const msg = buildDispatchMessage(
      base({
        interactiveReplyId: 'opt_sim',
        contentText: 'Sim',
        contentType: 'image',
        mediaUrl: 'https://host/chat-media/x.jpg',
      }),
    )
    expect(msg.kind).toBe('interactive_reply')
    if (msg.kind !== 'interactive_reply') throw new Error('esperava interactive_reply')
    expect(msg.reply_id).toBe('opt_sim')
    expect(msg.reply_title).toBe('Sim')
  })

  it('texto puro continua kind:"text" (regressão)', () => {
    const msg = buildDispatchMessage(base({ contentType: 'text', contentText: 'oi' }))
    expect(msg.kind).toBe('text')
    if (msg.kind !== 'text') throw new Error('esperava text')
    expect(msg.text).toBe('oi')
  })

  it('location (sem mediaUrl) não vira media', () => {
    const msg = buildDispatchMessage(base({ contentType: 'location', contentText: '[localização]' }))
    expect(msg.kind).toBe('text')
  })
})
