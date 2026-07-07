/**
 * Repair UTF-8-as-Windows-1252 mojibake (e.g. "JÃ¡", "â€”", "ðŸ“¸").
 *
 * Some upstream sources — notably the client's pre-existing n8n workflow,
 * whose stored strings AND httpRequest reads were already double-encoded —
 * hand us text whose UTF-8 bytes were decoded through Windows-1252 and
 * re-saved as UTF-8. That renders as garbled accents/emoji when sent to
 * WhatsApp. This reverses that specific transform.
 *
 * SAFETY: only applied when the string is fully re-encodable to a
 * cp1252 byte stream AND those bytes are STRICT-valid UTF-8 that differs
 * from the input. Clean text never satisfies this:
 *   - "é" (U+00E9) → byte 0xE9 → lone byte, invalid UTF-8 → left as-is.
 *   - "•" (U+2022 → cp1252 0x95), "—", real emoji (>U+00FF, no cp1252
 *     byte) → not encodable / invalid → left as-is.
 * So running it on already-correct text is a no-op.
 */

// Windows-1252 0x80–0x9F → Unicode. The rest (0xA0–0xFF) is identity.
const CP1252_HIGH: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
}

const utf8Strict = new TextDecoder('utf-8', { fatal: true })

/** Reverse a codepoint to its single cp1252 byte, or null if it has none. */
function cp1252Byte(cp: number): number | null {
  if (cp <= 0x7f) return cp
  if (cp in CP1252_HIGH) return CP1252_HIGH[cp]
  // 0xA0–0xFF identity, PLUS the five cp1252-undefined 0x80–0x9F slots
  // (0x81/0x8D/0x8F/0x90/0x9D) which pass through as U+0081…U+009D. Those
  // appear in mojibake like "Á" (UTF-8 C3 81 → "Ã"+U+0081), so they must
  // round-trip back to their byte. Everything ≥U+0100 has no cp1252 byte.
  if (cp >= 0x80 && cp <= 0xff) return cp
  return null
}

/**
 * Return the de-mojibaked string, or the input unchanged when it isn't
 * (recognizable) mojibake.
 */
export function fixMojibake(input: string): string {
  if (!input) return input
  const bytes: number[] = []
  for (const ch of input) {
    const b = cp1252Byte(ch.codePointAt(0)!)
    if (b === null) return input // contains a char no mojibake would produce
    bytes.push(b)
  }
  let decoded: string
  try {
    decoded = utf8Strict.decode(new Uint8Array(bytes))
  } catch {
    return input // bytes aren't valid UTF-8 → wasn't double-encoded
  }
  // Only accept when it actually changed AND introduced no replacement
  // chars (strict decode already guarantees the latter).
  return decoded !== input ? decoded : input
}
