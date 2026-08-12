// Windows-1252 difere de Latin-1 só nesta faixa (0x80-0x9F); fora dela os bytes coincidem com o
// code point Unicode. O ficheiro de importação do ERP Evolution é de largura fixa em bytes — declarar
// "charset=windows-1252" num Blob não transcodifica nada (JS guarda Blobs de string em UTF-8), por
// isso qualquer caractere multi-byte desalinhava a contagem de bytes e o ERP Evolution lia tudo errado
// ("Índice fora dos limites da matriz"). Por isso convertemos byte a byte antes de criar o Blob.
const WIN1252_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
}

function encodeWindows1252(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code <= 0x7f || (code >= 0xa0 && code <= 0xff)) bytes[i] = code
    else bytes[i] = WIN1252_EXTRA[code] ?? 0x3f
  }
  return bytes
}

export function downloadPurchaseTxt(filename: string, content: string) {
  const blob = new Blob([encodeWindows1252(content).buffer as ArrayBuffer], { type: 'text/plain;charset=windows-1252' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
