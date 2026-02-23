export class PipelineContext {
  private store = new Map<string, unknown>();
  private timings = new Map<string, number>();
  private logs: Array<{ agent: string; message: string; timestamp: Date }> = [];

  readonly startedAt = new Date();
  readonly nonInteractive: boolean;

  constructor(options: { nonInteractive?: boolean } = {}) {
    this.nonInteractive = options.nonInteractive ?? false;
  }

  set<T>(key: string, value: T): void {
    this.store.set(key, value);
  }

  get<T>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  require<T>(key: string): T {
    const value = this.store.get(key);
    if (value === undefined) {
      throw new Error(`PipelineContext: required key "${key}" not found`);
    }
    return value as T;
  }

  setTiming(agent: string, label: string, ms: number): void {
    this.timings.set(`${agent}:${label}`, ms);
  }

  getTiming(agent: string, label: string): number | undefined {
    return this.timings.get(`${agent}:${label}`);
  }

  getAllTimings(): Record<string, number> {
    return Object.fromEntries(this.timings);
  }

  log(agent: string, message: string): void {
    this.logs.push({ agent, message, timestamp: new Date() });
  }

  getLogs(): Array<{ agent: string; message: string; timestamp: Date }> {
    return [...this.logs];
  }

  elapsed(): number {
    return Date.now() - this.startedAt.getTime();
  }
}
