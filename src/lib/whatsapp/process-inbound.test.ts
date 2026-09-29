import { describe, it, expect } from 'vitest'
import { buildDispatchMessage, parseSurveyReply, type NormalizedInbound } from './process-inbound'

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

describe('parseSurveyReply', () => {
  it('parses a bare digit with no comment', () => {
    expect(parseSurveyReply('5')).toEqual({ nota: 5, comentario: null })
  })

  it('parses "nota 5" prefix', () => {
    expect(parseSurveyReply('nota 5')).toEqual({ nota: 5, comentario: null })
    expect(parseSurveyReply('Nota: 5')).toEqual({ nota: 5, comentario: null })
  })

  it('keeps the rest of the message as a comment', () => {
    expect(parseSurveyReply('5 - adorei o passeio!')).toEqual({ nota: 5, comentario: 'adorei o passeio!' })
    expect(parseSurveyReply('5, foi ótimo')).toEqual({ nota: 5, comentario: 'foi ótimo' })
  })

  it('accepts any digit 1-5', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(parseSurveyReply(String(n))).toEqual({ nota: n, comentario: null })
    }
  })

  it('rejects a rating outside 1-5', () => {
    expect(parseSurveyReply('6')).toBeNull()
    expect(parseSurveyReply('0')).toBeNull()
    expect(parseSurveyReply('10')).toBeNull()
  })

  it('rejects free text with no leading rating', () => {
    expect(parseSurveyReply('foi muito bom')).toBeNull()
    expect(parseSurveyReply('')).toBeNull()
    expect(parseSurveyReply('oi')).toBeNull()
  })
})
