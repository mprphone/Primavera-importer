export function downloadPostingsTxt(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=windows-1252' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
