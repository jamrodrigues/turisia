import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildConversationContext } from './context'

/** Minimal fake matching the query chain in buildConversationContext:
 *  from().select().eq().in().order().limit() → { data, error }. */
function fakeDb(rows: unknown[]): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  }
  return chain as unknown as SupabaseClient
}

// Rows now carry content_type — the builder inspects it to keep text,
// transcribed audio, and inbound media placeholders.
const text = (sender_type: string, content_text: string | null) => ({
  sender_type,
  content_type: 'text',
  content_text,
})

describe('buildConversationContext', () => {
  it('maps sender_type to role and returns chronological order', async () => {
    // DB returns newest-first (created_at DESC); the fn reverses it.
    const rows = [
      text('customer', 'third'),
      text('agent', 'second'),
      text('customer', 'first'),
    ]
    const out = await buildConversationContext(fakeDb(rows), 'conv-1')
    expect(out).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'second' },
      { role: 'user', content: 'third' },
    ])
  })

  it('treats bot messages as assistant', async () => {
    const out = await buildConversationContext(
      fakeDb([text('bot', 'auto reply')]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'assistant', content: 'auto reply' }])
  })

  it('drops empty / whitespace-only text messages', async () => {
    const out = await buildConversationContext(
      fakeDb([
        text('customer', '   '),
        text('customer', null),
        text('customer', 'real'),
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'real' }])
  })

  // ---- Item 4: transcribed audio reaches the brain ----
  it('includes transcribed audio (the "[áudio] …" prefix)', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_type: 'audio', content_text: '[áudio] quero um orçamento' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: '[áudio] quero um orçamento' }])
  })

  it('drops an untranscribed audio placeholder', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_type: 'audio', content_text: '[áudio não baixado]' },
        { sender_type: 'customer', content_type: 'audio', content_text: null },
        { sender_type: 'customer', content_type: 'audio', content_text: '   ' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([])
  })

  // ---- Item 5: inbound media placeholders ----
  it('synthesizes a placeholder for customer media without a caption', async () => {
    // Rows are DB-ordered newest-first; the builder reverses them.
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_type: 'document', content_text: '   ' },
        { sender_type: 'customer', content_type: 'video', content_text: '' },
        { sender_type: 'customer', content_type: 'image', content_text: null },
      ]),
      'conv-1',
    )
    expect(out).toEqual([
      { role: 'user', content: '[cliente enviou uma imagem]' },
      { role: 'user', content: '[cliente enviou um vídeo]' },
      { role: 'user', content: '[cliente enviou um documento]' },
    ])
  })

  it('prefixes a captioned customer image', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'customer', content_type: 'image', content_text: 'olha esse carro' },
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: '[imagem] olha esse carro' }])
  })

  it('excludes media sent by the bot/agent (no useful context)', async () => {
    const out = await buildConversationContext(
      fakeDb([
        { sender_type: 'bot', content_type: 'image', content_text: null },
        { sender_type: 'agent', content_type: 'document', content_text: 'contrato.pdf' },
        text('customer', 'e aí?'),
      ]),
      'conv-1',
    )
    expect(out).toEqual([{ role: 'user', content: 'e aí?' }])
  })
})
