/**
 * A tiny FIFO mutex for business mutations.
 *
 * The desktop UI and LAN clients share one libSQL connection. Reads can run
 * concurrently, but mutations must be ordered because parts of the existing
 * domain model (notably invoice number allocation and customer upsert) contain
 * read-then-write sequences. Routing every write through this queue prevents
 * two clients from racing those sequences without opening a second database.
 */
export class MutationQueue {
  private tail: Promise<void> = Promise.resolve()
  private queued = 0

  get pending(): number {
    return this.queued
  }

  run<T>(operation: () => Promise<T>): Promise<T> {
    this.queued += 1

    const result = this.tail.then(operation, operation)

    // Keep the internal chain fulfilled even when an individual operation
    // fails, otherwise one rejection would poison every later mutation.
    this.tail = result.then(
      () => undefined,
      () => undefined
    )

    return result.finally(() => {
      this.queued -= 1
    })
  }
}

/** One queue must be imported by both IPC and HTTP dispatchers. */
export const sharedMutationQueue = new MutationQueue()

export function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
  return sharedMutationQueue.run(operation)
}
