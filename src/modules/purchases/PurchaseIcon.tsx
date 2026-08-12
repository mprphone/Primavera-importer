import React from 'react'

export type PurchaseIconName =
  | 'documents' | 'pending' | 'exported' | 'selected' | 'import' | 'upload' | 'search' | 'file'
  | 'trash' | 'check' | 'thinking' | 'x'

const paths: Record<PurchaseIconName, React.ReactNode> = {
  documents: <><path d="M6 3.5h9.5a2 2 0 0 1 2 2V18H6a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Z" /><path d="M8 8h5.5M8 11.5h5.5M8 15h3.5" /></>,
  pending: <><circle cx="11" cy="11" r="7.5" /><path d="M11 6.5V11l3 2" /></>,
  exported: <><circle cx="11" cy="11" r="7.5" /><path d="m7.5 11 2.2 2.2 4.8-5" /></>,
  selected: <><path d="M5 4.5h12a1.5 1.5 0 0 1 1.5 1.5v12H6a2.5 2.5 0 0 1-2.5-2.5V6A1.5 1.5 0 0 1 5 4.5Z" /><path d="m8 11 2 2 4-4" /></>,
  import: <><path d="M11 3v11M7.5 10.5 11 14l3.5-3.5" /><path d="M5 17.5h12" /></>,
  upload: <><path d="M11 15V4M7.5 7.5 11 4l3.5 3.5" /><path d="M5 17.5h12" /></>,
  search: <><circle cx="9.5" cy="9.5" r="5.5" /><path d="m14 14 4 4" /></>,
  file: <><path d="M6 3.5h7l4 4V18H6Z" /><path d="M13 3.5V8h4M8.5 12h6M8.5 15h4" /></>,
  trash: <><path d="M5 6.5h12" /><path d="M9 6.5V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2" /><path d="M6.5 6.5 7.2 17a1.5 1.5 0 0 0 1.5 1.4h4.6a1.5 1.5 0 0 0 1.5-1.4l.7-10.5" /><path d="M9.5 9.5v6M12.5 9.5v6" /></>,
  check: <path d="m5.5 11.5 3.5 3.5 7.5-7.5" />,
  thinking: <><circle cx="11" cy="11" r="7.5" /><path d="M8.5 9a2.2 2.2 0 0 1 4.3.5c0 1.5-2 1.7-2 3.3" /><circle cx="10.9" cy="15.3" r="0.6" fill="currentColor" stroke="none" /></>,
  x: <><path d="m6.5 6.5 9 9" /><path d="m15.5 6.5-9 9" /></>,
}

export function PurchaseIcon({ name }: { name: PurchaseIconName }) {
  return <svg className="purchase-icon" viewBox="0 0 22 22" aria-hidden="true">{paths[name]}</svg>
}
