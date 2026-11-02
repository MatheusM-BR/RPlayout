export interface ReviewedAccount {
  id: string
  username: string
  role: string
  enabled: boolean
  createdAt: string
  channelIds: string[] | null
  stationIps: string[] | null
  revision: number
}
export interface AccountCatalogReview {
  revision: number
  users: ReviewedAccount[]
  bootstrapAllowed: boolean
  canCreate: boolean
}
export interface AccountSessionsReview {
  userId: string
  username: string
  accountRevision: number
  revision: number
  sessions: Array<{createdAt: string; expiresAt: string}>
}
const valid = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error('Revisão de contas inválida; confira novamente.')
  return value
}
export const accountCatalogETag = (review: Pick<AccountCatalogReview, 'revision'>) => `"accounts:catalog:${valid(review.revision)}"`
export const accountETag = (review: AccountCatalogReview, userId: string) => {
  const user = review.users.find(user => user.id === userId)
  if (!user) throw new Error('Conta não pertence à conferência original.')
  return `"accounts:user:${encodeURIComponent(user.id)}:${valid(review.revision)}:${valid(user.revision)}"`
}
export const accountSessionsETag = (review: AccountSessionsReview) => `"accounts:sessions:${encodeURIComponent(review.userId)}:${valid(review.accountRevision)}:${valid(review.revision)}"`
