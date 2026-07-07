import { describe, it, expect } from 'vitest'
import { fixMojibake } from './fix-mojibake'

// Build mojibake inputs from bytes so the test file itself stays clean
// UTF-8 (no ambiguous stored control chars): take the correct string,
// encode UTF-8, then decode each byte as its cp1252/latin1 char.
const CP1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026,
  0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019,
  0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153,
  0x9e: 0x017e, 0x9f: 0x0178,
}
/** Turn a correct string into its double-encoded (mojibake) form. */
function mojify(correct: string): string {
  const bytes = Buffer.from(correct, 'utf8')
  let out = ''
  for (const b of bytes) out += String.fromCodePoint(CP1252[b] ?? b)
  return out
}

describe('fixMojibake', () => {
  it('round-trips: mojify then fix restores the original', () => {
    for (const s of [
      'Já te envio',
      'Letícia',
      'automáticos',
      '• Kicks',
      'LOGAN — 2024',
      'fotos 📸',
      'AUTOMÁTICO',
      'Citroën',
      'preço à vista, ação, câmbio',
    ]) {
      expect(fixMojibake(mojify(s))).toBe(s)
    }
  })

  it('repairs PARTIAL mojibake (correct accents + mojibaked emoji)', () => {
    // real production case: LLM writes clean accents but echoes a
    // mojibaked camera emoji copied from its (mojibaked) prompt.
    const mixed = 'Chevrolet Onix 2018 manual ' + mojify('📸') + '\n\nQuer ver as fotos?'
    // the accents in this sentence are already correct; only the emoji is broken
    expect(fixMojibake('automático ' + mojify('📸'))).toBe('automático 📸')
    expect(fixMojibake(mixed)).toBe('Chevrolet Onix 2018 manual 📸\n\nQuer ver as fotos?')
    expect(fixMojibake('sábado às 15h ' + mojify('😊') + ' ok')).toBe('sábado às 15h 😊 ok')
  })

  it('leaves already-correct text untouched (no-op)', () => {
    for (const s of [
      'Ele é uma ótima escolha',
      '• item — fim 📸',
      'Argo é ótimo 😊',
      'preço à vista, ação',
      'Hello world 123',
      '',
    ]) {
      expect(fixMojibake(s)).toBe(s)
    }
  })

  it('is idempotent on already-repaired text', () => {
    const once = fixMojibake(mojify('Já vou — ok 📸'))
    expect(once).toBe('Já vou — ok 📸')
    expect(fixMojibake(once)).toBe(once)
  })
})
