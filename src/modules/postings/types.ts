export type PostingDraftStatus = 'pending' | 'exported'

export type PostingDraft = {
  movementId: string
  counterAccount: string
  journal: string
  documentType: string
  status: PostingDraftStatus
  exportedAt?: string
  intelligence?: { confidence: number; evidence: string }
}

export type DescriptionPostingModel = {
  key: string
  counterAccount: string
  journal: string
  documentType: string
  updatedAt: string
}
