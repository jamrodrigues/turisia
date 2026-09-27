import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { retrieveActivePacotes, matchPacoteMedia } from './pacotes'

function makeDb(rows: Record<string, unknown>[] | null, error: unknown = null) {
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: rows, error }),
            }),
          }),
        }),
      }),
    }),
  }
  return db as unknown as SupabaseClient
}

function makeMediaDb(rows: Record<string, unknown>[] | null, error: unknown = null) {
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => Promise.resolve({ data: rows, error }),
        }),
      }),
    }),
  }
  return db as unknown as SupabaseClient
}

describe('retrieveActivePacotes', () => {
  it('returns [] when the account has no packages', async () => {
    expect(await retrieveActivePacotes(makeDb([]), 'acct')).toEqual([])
  })

  it('returns [] on a query error instead of throwing', async () => {
    expect(await retrieveActivePacotes(makeDb(null, new Error('boom')), 'acct')).toEqual([])
  })

  it('formats name, category, price (pt-BR comma) and duration', async () => {
    const rows = [
      {
        name: 'Passeio de Buggy',
        category: 'buggy',
        description: null,
        price: 180.5,
        duration_minutes: 150,
      },
    ]
    const out = await retrieveActivePacotes(makeDb(rows), 'acct')
    expect(out).toEqual(['Passeio de Buggy (buggy) — R$ 180,50 · 2.5h'])
  })

  it('appends the description on its own line when present', async () => {
    const rows = [
      {
        name: 'Mergulho',
        category: null,
        description: 'Batismo de mergulho com instrutor.',
        price: 250,
        duration_minutes: 60,
      },
    ]
    const out = await retrieveActivePacotes(makeDb(rows), 'acct')
    expect(out).toEqual([
      'Mergulho — R$ 250,00 · 1h\nBatismo de mergulho com instrutor.',
    ])
  })

  it('omits duration when not set', async () => {
    const rows = [
      { name: 'City Tour', category: null, description: null, price: 90, duration_minutes: null },
    ]
    const out = await retrieveActivePacotes(makeDb(rows), 'acct')
    expect(out).toEqual(['City Tour — R$ 90,00'])
  })

  it('appends a sorted horarios line with capacity when slots exist', async () => {
    const rows = [
      {
        name: 'Passeio de Buggy',
        category: 'buggy',
        description: null,
        price: 180,
        duration_minutes: null,
        pacote_horarios: [
          { hora_saida: '14:00:00', hora_volta: '18:00:00', capacidade_pessoas: 16 },
          { hora_saida: '08:00:00', hora_volta: '12:00:00', capacidade_pessoas: 16 },
        ],
      },
    ]
    const out = await retrieveActivePacotes(makeDb(rows), 'acct')
    expect(out).toEqual([
      'Passeio de Buggy (buggy) — R$ 180,00\n' +
        'Horários disponíveis: 08:00–12:00 (até 16 pessoas), 14:00–18:00 (até 16 pessoas)',
    ])
  })

  it('omits the horarios line when there are no slots', async () => {
    const rows = [
      {
        name: 'City Tour',
        category: null,
        description: null,
        price: 90,
        duration_minutes: null,
        pacote_horarios: [],
      },
    ]
    const out = await retrieveActivePacotes(makeDb(rows), 'acct')
    expect(out).toEqual(['City Tour — R$ 90,00'])
  })
})

describe('matchPacoteMedia', () => {
  const buggy = {
    name: 'Passeio de Buggy pela Praia',
    category: 'buggy',
    pacote_media: [{ media_type: 'image', url: 'https://x/buggy.jpg', position: 0 }],
  }
  const mergulho = {
    name: 'Mergulho Batismo',
    category: 'mergulho',
    pacote_media: [{ media_type: 'video', url: 'https://x/mergulho.mp4', position: 0 }],
  }

  it('returns null for an empty message', async () => {
    expect(await matchPacoteMedia(makeMediaDb([buggy]), 'acct', '  ')).toBeNull()
  })

  it('returns null on a query error', async () => {
    expect(
      await matchPacoteMedia(makeMediaDb(null, new Error('boom')), 'acct', 'buggy'),
    ).toBeNull()
  })

  it('matches by category keyword and returns the cover media', async () => {
    const out = await matchPacoteMedia(
      makeMediaDb([buggy, mergulho]),
      'acct',
      'quanto custa o passeio de buggy?',
    )
    expect(out).toEqual({ mediaType: 'image', url: 'https://x/buggy.jpg' })
  })

  it('matches by a significant word in the package name', async () => {
    const out = await matchPacoteMedia(makeMediaDb([mergulho]), 'acct', 'tem mergulho amanhã?')
    expect(out).toEqual({ mediaType: 'video', url: 'https://x/mergulho.mp4' })
  })

  it('returns null when the message matches more than one package (ambiguous)', async () => {
    const jangada = {
      name: 'Passeio de Jangada',
      category: 'barco',
      pacote_media: [{ media_type: 'image', url: 'https://x/jangada.jpg', position: 0 }],
    }
    const catamara = {
      name: 'Passeio de Catamarã',
      category: 'barco',
      pacote_media: [{ media_type: 'image', url: 'https://x/catamara.jpg', position: 0 }],
    }
    const out = await matchPacoteMedia(
      makeMediaDb([jangada, catamara]),
      'acct',
      'tem passeio de barco?',
    )
    expect(out).toBeNull()
  })

  it('returns null when the matched package has no media', async () => {
    const noMedia = { name: 'City Tour', category: 'city tour', pacote_media: [] }
    const out = await matchPacoteMedia(makeMediaDb([noMedia]), 'acct', 'tem city tour?')
    expect(out).toBeNull()
  })
})
