/**
 * Random number sources.
 *
 * `secureRng` uses crypto.getRandomValues with rejection sampling, so every
 * integer in [0, n) is exactly equally likely (no modulo bias). It is used for
 * all real shuffles. `seededRng` is a small deterministic generator used only
 * in tests and simulations where we want reproducible runs.
 */
export interface Rng {
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
  /** Uniform float in [0, 1). */
  float(): number;
}

const TWO_32 = 0x1_0000_0000;

function getCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('crypto.getRandomValues is not available in this environment');
  }
  return c;
}

class SecureRng implements Rng {
  private buf = new Uint32Array(256);
  private idx = 256;

  private next32(): number {
    if (this.idx >= this.buf.length) {
      getCrypto().getRandomValues(this.buf);
      this.idx = 0;
    }
    return this.buf[this.idx++];
  }

  int(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > TWO_32) {
      throw new Error(`Bad range ${maxExclusive}`);
    }
    // Reject values in the incomplete final block so the result is unbiased.
    const limit = TWO_32 - (TWO_32 % maxExclusive);
    let x = this.next32();
    while (x >= limit) x = this.next32();
    return x % maxExclusive;
  }

  float(): number {
    return this.next32() / TWO_32;
  }
}

export const secureRng: Rng = new SecureRng();

/** Deterministic PRNG (mulberry32). For tests and simulations only — never for real deals. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / TWO_32;
  };
  return {
    int: (n: number) => Math.floor(next() * n),
    float: next,
  };
}

/** Fisher–Yates shuffle. Returns a new array; the input is not modified. */
export function shuffle<T>(items: readonly T[], rng: Rng = secureRng): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}
