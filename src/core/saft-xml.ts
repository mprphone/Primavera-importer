import { strFromU8, unzipSync } from 'fflate'

export function directChild(element: Element, name: string) {
  return Array.from(element.children).find(child => child.localName === name)
}

export function text(element: Element, name: string) {
  return directChild(element, name)?.textContent?.trim() ?? ''
}

export function descendants(element: Element, name: string) {
  return Array.from(element.getElementsByTagNameNS('*', name))
}

function decodeXml(bytes: Uint8Array) {
  const prefix = new TextDecoder('ascii').decode(bytes.slice(0, 180))
  const encoding = /encoding=["']([^"']+)/i.exec(prefix)?.[1]?.toLowerCase() ?? 'utf-8'
  if (encoding.includes('1252') || encoding.includes('8859-1')) return new TextDecoder('windows-1252').decode(bytes)
  return strFromU8(bytes)
}

export async function xmlFromFile(file: File) {
  if (file.size > 100 * 1024 * 1024) throw new Error('O ficheiro SAF-T excede o limite de 100 MB.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const isZip = file.name.toLowerCase().endsWith('.zip') || (bytes[0] === 0x50 && bytes[1] === 0x4b)
  if (!isZip) return decodeXml(bytes)
  const entries = unzipSync(bytes)
  const xmlEntry = Object.entries(entries).find(([name]) => name.toLowerCase().endsWith('.xml'))
  if (!xmlEntry) throw new Error('O ZIP não contém um ficheiro SAF-T em formato XML.')
  if (xmlEntry[1].byteLength > 150 * 1024 * 1024) throw new Error('O XML do SAF-T excede o limite de 150 MB.')
  return decodeXml(xmlEntry[1])
}

export function parseSaftDocument(xml: string): XMLDocument {
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  const parserError = document.getElementsByTagName('parsererror')[0]
  if (parserError) throw new Error('O ficheiro não é um SAF-T XML válido.')
  return document
}
