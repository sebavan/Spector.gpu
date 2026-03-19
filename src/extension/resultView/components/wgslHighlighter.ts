/**
 * WGSL syntax highlighter — pure function, no dependencies.
 *
 * Takes raw WGSL source, returns an HTML string with `<span class="wgsl-*">`
 * tokens suitable for `dangerouslySetInnerHTML`.  Processes greedily in a
 * single pass (block comments → line comments → decorators → hex numbers →
 * decimal/float numbers → identifiers → punctuation → fallthrough chars).
 *
 * Correctness invariant: every input character appears exactly once in the
 * output, HTML-escaped.  The function never drops or duplicates characters.
 */

// ── Token sets (pre-built for O(1) lookup) ─────────────────────────────

const KEYWORDS = new Set([
    'fn', 'var', 'let', 'const', 'struct', 'if', 'else', 'for', 'while',
    'loop', 'break', 'continue', 'return', 'switch', 'case', 'default',
    'discard', 'enable', 'alias', 'override', 'diagnostic',
]);

const TYPES = new Set([
    'bool', 'i32', 'u32', 'f32', 'f16',
    'vec2f', 'vec3f', 'vec4f', 'vec2i', 'vec3i', 'vec4i',
    'vec2u', 'vec3u', 'vec4u', 'vec2h', 'vec3h', 'vec4h',
    'mat2x2f', 'mat3x3f', 'mat4x4f', 'mat2x2', 'mat3x3', 'mat4x4',
    'array', 'ptr',
    'sampler', 'sampler_comparison',
    'texture_1d', 'texture_2d', 'texture_3d', 'texture_cube',
    'texture_multisampled_2d', 'texture_depth_2d', 'texture_depth_cube',
    'texture_storage_1d', 'texture_storage_2d', 'texture_storage_3d',
    'texture_external', 'atomic',
]);

const DECORATOR_NAMES = new Set([
    'vertex', 'fragment', 'compute', 'group', 'binding', 'location',
    'builtin', 'workgroup_size', 'id', 'interpolate', 'invariant',
    'must_use', 'size', 'align',
]);

const BUILTIN_VALUES = new Set([
    'vertex_index', 'instance_index', 'position', 'front_facing',
    'frag_depth', 'local_invocation_id', 'global_invocation_id',
    'workgroup_id', 'num_workgroups', 'sample_index', 'sample_mask',
]);

const BUILTIN_FUNCTIONS = new Set([
    'abs', 'acos', 'asin', 'atan', 'atan2', 'ceil', 'clamp', 'cos',
    'cross', 'degrees', 'determinant', 'distance', 'dot', 'exp', 'exp2',
    'floor', 'fract', 'inverseSqrt', 'length', 'log', 'log2', 'max',
    'min', 'mix', 'normalize', 'pow', 'radians', 'reflect', 'refract',
    'round', 'sign', 'sin', 'smoothstep', 'sqrt', 'step', 'tan',
    'transpose', 'trunc', 'select', 'arrayLength',
    'textureSample', 'textureSampleLevel', 'textureSampleCompare',
    'textureLoad', 'textureStore', 'textureDimensions',
    'pack4x8snorm', 'unpack4x8snorm',
    'storageBarrier', 'workgroupBarrier',
]);

// ── Helpers ────────────────────────────────────────────────────────────

function escapeHTML(s: string): string {
    // Only the 3 characters that matter inside element content / attributes.
    // Avoids allocating when there's nothing to escape (common case).
    if (s.indexOf('&') === -1 && s.indexOf('<') === -1 && s.indexOf('>') === -1) {
        return s;
    }
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function wrap(cls: string, text: string): string {
    return `<span class="wgsl-${cls}">${escapeHTML(text)}</span>`;
}

function isIdentStart(ch: string): boolean {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
}

function isIdentChar(ch: string): boolean {
    return isIdentStart(ch) || (ch >= '0' && ch <= '9');
}

function isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
}

// ── Main entry point ───────────────────────────────────────────────────

export function highlightWGSL(code: string): string {
    if (code.length === 0) return '';

    const len = code.length;
    // Pre-size to ~1.5× input — a rough upper-bound for span wrapping.
    const parts: string[] = [];
    let i = 0;

    while (i < len) {
        const ch = code[i];

        // ─ Block comment ──────────────────────────────────────────────
        if (ch === '/' && i + 1 < len && code[i + 1] === '*') {
            const start = i;
            i += 2;
            while (i < len && !(code[i] === '*' && i + 1 < len && code[i + 1] === '/')) {
                i++;
            }
            if (i < len) i += 2; // skip closing */
            parts.push(wrap('comment', code.slice(start, i)));
            continue;
        }

        // ─ Line comment ───────────────────────────────────────────────
        if (ch === '/' && i + 1 < len && code[i + 1] === '/') {
            const start = i;
            while (i < len && code[i] !== '\n') i++;
            parts.push(wrap('comment', code.slice(start, i)));
            continue;
        }

        // ─ Decorator (@name) ──────────────────────────────────────────
        if (ch === '@' && i + 1 < len && isIdentStart(code[i + 1])) {
            const start = i;
            i++; // skip @
            while (i < len && isIdentChar(code[i])) i++;
            const name = code.slice(start + 1, i); // without @
            if (DECORATOR_NAMES.has(name)) {
                parts.push(wrap('decorator', code.slice(start, i)));
            } else {
                parts.push(escapeHTML(code.slice(start, i)));
            }
            continue;
        }

        // ─ Hex number ─────────────────────────────────────────────────
        if (ch === '0' && i + 1 < len && (code[i + 1] === 'x' || code[i + 1] === 'X')) {
            const start = i;
            i += 2;
            while (i < len && /[0-9a-fA-F_]/.test(code[i])) i++;
            // optional unsigned suffix
            if (i < len && (code[i] === 'u' || code[i] === 'i')) i++;
            parts.push(wrap('number', code.slice(start, i)));
            continue;
        }

        // ─ Decimal / float number ─────────────────────────────────────
        if (isDigit(ch) || (ch === '.' && i + 1 < len && isDigit(code[i + 1]))) {
            const start = i;
            while (i < len && (isDigit(code[i]) || code[i] === '_')) i++;
            if (i < len && code[i] === '.') {
                i++;
                while (i < len && (isDigit(code[i]) || code[i] === '_')) i++;
            }
            // exponent
            if (i < len && (code[i] === 'e' || code[i] === 'E')) {
                i++;
                if (i < len && (code[i] === '+' || code[i] === '-')) i++;
                while (i < len && isDigit(code[i])) i++;
            }
            // suffix f, h, i, u
            if (i < len && (code[i] === 'f' || code[i] === 'h' || code[i] === 'i' || code[i] === 'u')) i++;
            parts.push(wrap('number', code.slice(start, i)));
            continue;
        }

        // ─ String literal (rare in WGSL, but handle) ──────────────────
        if (ch === '"') {
            const start = i;
            i++; // skip opening quote
            while (i < len && code[i] !== '"' && code[i] !== '\n') {
                if (code[i] === '\\' && i + 1 < len) i++; // skip escaped char
                i++;
            }
            if (i < len && code[i] === '"') i++; // skip closing quote
            parts.push(wrap('string', code.slice(start, i)));
            continue;
        }

        // ─ Identifier / keyword ───────────────────────────────────────
        if (isIdentStart(ch)) {
            const start = i;
            while (i < len && isIdentChar(code[i])) i++;
            const word = code.slice(start, i);

            if (KEYWORDS.has(word)) {
                parts.push(wrap('keyword', word));
            } else if (TYPES.has(word)) {
                parts.push(wrap('type', word));
            } else if (BUILTIN_VALUES.has(word)) {
                parts.push(wrap('builtin', word));
            } else if (BUILTIN_FUNCTIONS.has(word)) {
                parts.push(wrap('function', word));
            } else {
                parts.push(escapeHTML(word));
            }
            continue;
        }

        // ─ Punctuation ────────────────────────────────────────────────
        if ('{}[]();:,.<>+-*/%&|^!=~?'.indexOf(ch) !== -1) {
            parts.push(wrap('punctuation', ch));
            i++;
            continue;
        }

        // ─ Whitespace / other (pass through) ─────────────────────────
        // Batch consecutive whitespace/unknown into a single push to
        // reduce array growth on large inputs.
        const start = i;
        while (i < len && !isIdentStart(code[i]) && !isDigit(code[i]) &&
               code[i] !== '/' && code[i] !== '@' && code[i] !== '"' &&
               code[i] !== '.' &&
               '{}[]();:,.<>+-*/%&|^!=~?'.indexOf(code[i]) === -1) {
            i++;
        }
        parts.push(escapeHTML(code.slice(start, i)));
    }

    return parts.join('');
}
