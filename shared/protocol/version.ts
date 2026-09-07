/** Bumped on any breaking change to commands, events or the shm layout. */
export const PROTOCOL_VERSION = 1 as const;

export function isCompatibleProtocol(engineMajor: number): boolean {
  return engineMajor === PROTOCOL_VERSION;
}
