/** A read-only mapping of the engine's telemetry segment. */
export interface Segment {
  /** Copies `length` bytes from `offset`. Throws `RangeError` if that would read past the mapping. */
  read(offset: number, length: number): Buffer;
  close(): void;
  readonly byteLength: number;
}

export function open(name: string, byteLength: number): Segment;
export function load(): {
  Segment: new (name: string, byteLength: number) => Segment;
};
