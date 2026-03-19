import { describe, it, expect, vi } from 'vitest';
import { Observable } from '@shared/utils/observable';

describe('Observable', () => {
    it('should add a listener and trigger it with data', () => {
        const obs = new Observable<number>();
        const listener = vi.fn();

        obs.add(listener);
        obs.trigger(42);

        expect(listener).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledWith(42);
    });

    it('should remove a listener so it is no longer called', () => {
        const obs = new Observable<string>();
        const listener = vi.fn();

        obs.add(listener);
        obs.remove(listener);
        obs.trigger('hello');

        expect(listener).not.toHaveBeenCalled();
    });

    it('should not throw when removing a listener that was never added', () => {
        const obs = new Observable<void>();
        const listener = vi.fn();

        expect(() => obs.remove(listener)).not.toThrow();
    });

    it('should call multiple listeners in order', () => {
        const obs = new Observable<number>();
        const order: number[] = [];

        obs.add(() => order.push(1));
        obs.add(() => order.push(2));
        obs.add(() => order.push(3));
        obs.trigger(0);

        expect(order).toEqual([1, 2, 3]);
    });

    it('should handle remove during trigger without crashing or skipping', () => {
        const obs = new Observable<void>();
        const second = vi.fn();
        const first = vi.fn(() => {
            obs.remove(first);
        });

        obs.add(first);
        obs.add(second);
        obs.trigger();

        // Both should be called because trigger snapshots the listener array
        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledOnce();

        // After trigger, only second remains
        expect(obs.listenerCount).toBe(1);
    });

    it('should catch listener exceptions and still call remaining listeners', () => {
        const obs = new Observable<number>();
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const before = vi.fn();
        const thrower = vi.fn(() => { throw new Error('boom'); });
        const after = vi.fn();

        obs.add(before);
        obs.add(thrower);
        obs.add(after);
        obs.trigger(1);

        expect(before).toHaveBeenCalledOnce();
        expect(thrower).toHaveBeenCalledOnce();
        expect(after).toHaveBeenCalledOnce();
        expect(errorSpy).toHaveBeenCalledOnce();

        errorSpy.mockRestore();
    });

    it('should clear all listeners', () => {
        const obs = new Observable<void>();
        obs.add(vi.fn());
        obs.add(vi.fn());

        expect(obs.listenerCount).toBe(2);

        obs.clear();

        expect(obs.listenerCount).toBe(0);
        expect(obs.hasListeners).toBe(false);
    });

    it('should report hasListeners correctly', () => {
        const obs = new Observable<void>();
        expect(obs.hasListeners).toBe(false);

        const listener = vi.fn();
        obs.add(listener);
        expect(obs.hasListeners).toBe(true);

        obs.remove(listener);
        expect(obs.hasListeners).toBe(false);
    });

    it('should report listenerCount correctly', () => {
        const obs = new Observable<void>();
        expect(obs.listenerCount).toBe(0);

        const a = vi.fn();
        const b = vi.fn();
        obs.add(a);
        expect(obs.listenerCount).toBe(1);

        obs.add(b);
        expect(obs.listenerCount).toBe(2);

        obs.remove(a);
        expect(obs.listenerCount).toBe(1);
    });

    it('should allow the same listener to be added multiple times', () => {
        const obs = new Observable<void>();
        const listener = vi.fn();

        obs.add(listener);
        obs.add(listener);
        obs.trigger();

        expect(listener).toHaveBeenCalledTimes(2);
    });

    it('should only remove the first instance of a duplicate listener', () => {
        const obs = new Observable<void>();
        const listener = vi.fn();

        obs.add(listener);
        obs.add(listener);
        obs.remove(listener);
        obs.trigger();

        expect(listener).toHaveBeenCalledOnce();
    });

    it('should not trigger listeners after clear', () => {
        const obs = new Observable<string>();
        const listener = vi.fn();

        obs.add(listener);
        obs.clear();
        obs.trigger('data');

        expect(listener).not.toHaveBeenCalled();
    });
});
