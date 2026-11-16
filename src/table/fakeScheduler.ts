import type { Scheduler } from './controller';

/** A manual clock for tests: timers fire only when the test runs them. */
export class FakeScheduler implements Scheduler {
  private t = 0;
  private queue: Array<{ at: number; fn: () => void; id: number }> = [];
  private nextId = 1;

  setTimeout(fn: () => void, ms: number) {
    const id = this.nextId++;
    this.queue.push({ at: this.t + ms, fn, id });
    return id;
  }

  clearTimeout(h: unknown) {
    this.queue = this.queue.filter((x) => x.id !== h);
  }

  now() {
    return this.t;
  }

  pending() {
    return this.queue.length;
  }

  /** Runs the next timer. Returns false if none is waiting. */
  runNext(): boolean {
    this.queue.sort((a, b) => a.at - b.at);
    const next = this.queue.shift();
    if (!next) return false;
    this.t = next.at;
    next.fn();
    return true;
  }
}
