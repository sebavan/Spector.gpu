import { describe, it, expect } from 'vitest';
import { IdGenerator, globalIdGenerator } from '@shared/utils/idGenerator';

describe('IdGenerator', () => {
    it('should return incrementing IDs with the given prefix', () => {
        const gen = new IdGenerator();

        expect(gen.next('cmd')).toBe('cmd_1');
        expect(gen.next('cmd')).toBe('cmd_2');
        expect(gen.next('cmd')).toBe('cmd_3');
    });

    it('should maintain independent counters for different prefixes', () => {
        const gen = new IdGenerator();

        expect(gen.next('buffer')).toBe('buffer_1');
        expect(gen.next('texture')).toBe('texture_1');
        expect(gen.next('buffer')).toBe('buffer_2');
        expect(gen.next('texture')).toBe('texture_2');
        expect(gen.next('pipeline')).toBe('pipeline_1');
    });

    it('should reset all counters', () => {
        const gen = new IdGenerator();

        gen.next('a');
        gen.next('a');
        gen.next('b');

        gen.reset();

        expect(gen.next('a')).toBe('a_1');
        expect(gen.next('b')).toBe('b_1');
    });

    it('should handle empty string prefix', () => {
        const gen = new IdGenerator();

        expect(gen.next('')).toBe('_1');
        expect(gen.next('')).toBe('_2');
    });
});

describe('globalIdGenerator', () => {
    it('should be an instance of IdGenerator', () => {
        expect(globalIdGenerator).toBeInstanceOf(IdGenerator);
    });

    it('should function as a singleton', () => {
        globalIdGenerator.reset(); // clean state for this test
        const id1 = globalIdGenerator.next('global');
        const id2 = globalIdGenerator.next('global');

        expect(id1).toBe('global_1');
        expect(id2).toBe('global_2');

        globalIdGenerator.reset();
    });
});
