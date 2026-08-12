import { Entity } from '../../core/entities'
import { InputRow } from '../../core/generator'

export type ParsedRow = InputRow & {
  suggested?: Entity
  suggestedScore?: number
}
