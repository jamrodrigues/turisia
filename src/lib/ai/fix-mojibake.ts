/**
 * Repair UTF-8-as-Windows-1252 mojibake (e.g. "JÃ¡", "â€”", "ðŸ“¸").
 *
 * Some upstream sources — notably the client's pre-existing n8n workflow,
 * whose stored strings and httpRequest reads are double-encoded, and the
 * LLM that echoes mojibaked emoji straight out of that prompt — hand us
 * text whose UTF-8 bytes were decoded through Windows-1252 and re-saved
 * as UTF-8. That renders as garbled accents/emoji on WhatsApp.
 *
 * The corruption is often PARTIAL: one message can mix correct accents
 * (from the LLM's own generation) with a mojibaked emoji (copied from
 * the prompt). So we repair sequence-by-sequence rather than all-or-
 * nothing: scan for runs that look like a mojibaked multi-byte UTF-8
 * character (a lead byte followed by the right number of continuation
 * bytes, all cp1252-encodable) and decode just those, leaving every
 * other character untouched.
 *
 * SAFETY: a real, already-correct char is only rewritten if it forms a
 * STRICT-valid UTF-8 sequence with the chars that follow it — which
 * clean text almost never does (e.g. "é " → byte E9 then space 0x20 is
 * not a continuation byte, so "é" is emitted as-is). Running it on
 * correct text is effectively a no-op.
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
  // (0x81/0x8D/0x8F/0x90/0x9D) which pass through as U+0081…U+009D and
  // appear in mojibake like "Á" (UTF-8 C3 81 → "Ã"+U+0081).
  if (cp >= 0x80 && cp <= 0xff) return cp
  return null // anything ≥ U+0100 has no cp1252 byte
}

/** Expected UTF-8 sequence length for a lead byte, or 0 if not a lead. */
function leadLen(b: number): number {
  if (b >= 0xc2 && b <= 0xdf) return 2
  if (b >= 0xe0 && b <= 0xef) return 3
  if (b >= 0xf0 && b <= 0xf4) return 4
  return 0
}

export function fixMojibake(input: string): string {
  if (!input) return input
  const chars = Array.from(input) // code-point units
  let out = ''
  let i = 0
  while (i < chars.length) {
    const b0 = cp1252Byte(chars[i].codePointAt(0)!)
    const len = b0 === null ? 0 : leadLen(b0)

    if (len > 0 && i + len <= chars.length) {
      const bytes = [b0 as number]
      let ok = true
      for (let j = 1; j < len; j++) {
        const bj = cp1252Byte(chars[i + j].codePointAt(0)!)
        if (bj === null || bj < 0x80 || bj > 0xbf) {
          ok = false
          break
        }
        bytes.push(bj)
      }
      if (ok) {
        try {
          out += utf8Strict.decode(new Uint8Array(bytes))
          i += len
          continue
        } catch {
          // not a real UTF-8 sequence → fall through, emit as-is
        }
      }
    }

    out += chars[i]
    i += 1
  }
  return out
}
