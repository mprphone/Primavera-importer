export function stripAccents(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^ -~]/g, ' ')
}

export function padRight(s: string, len: number): string {
  const t = s ?? ''
  return (t.length >= len) ? t.slice(0, len) : (t + ' '.repeat(len - t.length))
}

export function padLeft(s: string, len: number): string {
  const t = s ?? ''
  return (t.length >= len) ? t.slice(t.length - len) : (' '.repeat(len - t.length) + t)
}

export function setRange(base: string, start: number, len: number, value: string): string {
  const left = base.slice(0, start)
  const mid = padRight(value, len)
  const right = base.slice(start + len)
  return left + mid + right
}

export function setRightAlignedFieldEndingAt(base: string, endIndex: number, fieldLen: number, value: string): string {
  const start = endIndex - fieldLen + 1
  const left = base.slice(0, start)
  const mid = padLeft(value, fieldLen)
  const right = base.slice(endIndex + 1)
  return left + mid + right
}

export function toAmountString(amount: number): string {
  // Always dot decimal; keep 2 decimals.
  const fixed = amount.toFixed(2)
  return fixed
}

export function normalizeForMatch(s: string): string {
  return stripAccents(s).toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
}
