import type { Bee } from '@ethersphere/bee-js'

export interface BatchStatus {
  usable: boolean
  ttlDays: number
  usagePercent: number
}

// GET /stamps/{id}: works on the node that owns the batch (node W for the shared batch).
export async function batchStatus(bee: Bee, batchId: string): Promise<BatchStatus> {
  const batch = await bee.stamp.get(batchId)
  return { usable: batch.usable, ttlDays: Math.floor(batch.duration.toDays()), usagePercent: Math.round(batch.usage * 100) }
}

// GET /stewardship/{ref}: can the network still serve every chunk?
export async function isRetrievable(bee: Bee, reference: string): Promise<boolean> {
  return bee.data.isRetrievable(reference)
}

// POST /pins/{ref} on another node: it fetches and keeps its own copy.
export async function pinOn(bee: Bee, reference: string): Promise<void> {
  await bee.pin.add(reference)
}

// PUT /stewardship/{ref}: re-upload someone else's content under this node's batch. Same address.
export async function adopt(bee: Bee, adoptBatchId: string, reference: string): Promise<void> {
  await bee.pin.reuploadData(adoptBatchId, reference)
}
