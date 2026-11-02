import type { Bee } from '@ethersphere/bee-js'

export interface BatchStatus {
  usable: boolean
  ttlDays: number
  usagePercent: number
}

// GET /stamps/{id}: works on the node that owns the batch (node W for the shared batch).
export async function batchStatus(bee: Bee, batchId: string): Promise<BatchStatus> {
  throw new Error('TODO(l3): see GUIDE.md, section l3')
}

// GET /stewardship/{ref}: can the network still serve every chunk?
export async function isRetrievable(bee: Bee, reference: string): Promise<boolean> {
  throw new Error('TODO(l3): see GUIDE.md, section l3')
}

// POST /pins/{ref} on another node: it fetches and keeps its own copy.
export async function pinOn(bee: Bee, reference: string): Promise<void> {
  throw new Error('TODO(l3): see GUIDE.md, section l3')
}

// PUT /stewardship/{ref}: re-upload someone else's content under this node's batch. Same address.
export async function adopt(bee: Bee, adoptBatchId: string, reference: string): Promise<void> {
  throw new Error('TODO(l3): see GUIDE.md, section l3')
}
