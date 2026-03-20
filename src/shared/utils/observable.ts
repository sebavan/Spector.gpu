export type Listener<T> = (data: T) => void;

export class Observable<T> {
    private _listeners: Listener<T>[] = [];

    public add(listener: Listener<T>): void {
        this._listeners.push(listener);
    }

    public remove(listener: Listener<T>): void {
        const index = this._listeners.indexOf(listener);
        if (index !== -1) {
            this._listeners.splice(index, 1);
        }
    }

    public trigger(data: T): void {
        // Copy array to handle remove-during-trigger
        const listeners = this._listeners.slice();
        for (const listener of listeners) {
            try {
                listener(data);
            } catch (e) {
                console.error('[Spector.GPU] Observable listener error:', e);
            }
        }
    }

    public clear(): void {
        this._listeners.length = 0;
    }

    public get hasListeners(): boolean {
        return this._listeners.length > 0;
    }

    public get listenerCount(): number {
        return this._listeners.length;
    }
}
