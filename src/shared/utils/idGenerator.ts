export class IdGenerator {
    private _counters: Map<string, number> = new Map();

    public next(prefix: string): string {
        const count = (this._counters.get(prefix) ?? 0) + 1;
        this._counters.set(prefix, count);
        return `${prefix}_${count}`;
    }

    public reset(): void {
        this._counters.clear();
    }
}

// Global singleton for the capture engine
export const globalIdGenerator = new IdGenerator();
