import React, { useState, useCallback, useMemo } from 'react';
import { maybeResourceLink } from './ResourceLink';

interface JsonTreeProps {
    data: unknown;
    depth?: number;
    label?: string;
}

const MAX_DEPTH = 10;

export function JsonTree({ data, depth = 0, label }: JsonTreeProps) {
    const [expanded, setExpanded] = useState(depth < 3);

    const toggle = useCallback(() => setExpanded(prev => !prev), []);

    if (depth > MAX_DEPTH) return <span className="json-truncated">…</span>;

    if (data === null) return <JsonLeaf label={label} value="null" className="json-null" />;
    if (data === undefined) return <JsonLeaf label={label} value="undefined" className="json-undefined" />;
    if (typeof data === 'boolean') return <JsonLeaf label={label} value={String(data)} className="json-boolean" />;
    if (typeof data === 'number') return <JsonLeaf label={label} value={String(data)} className="json-number" />;
    if (typeof data === 'string') {
        const link = maybeResourceLink(data);
        if (link) {
            return (
                <div className="json-leaf" style={{ marginLeft: 16 }}>
                    {label != null && <span className="json-key">{label}: </span>}
                    {link}
                </div>
            );
        }
        return <JsonLeaf label={label} value={`"${data}"`} className="json-string" />;
    }

    if (Array.isArray(data)) {
        if (data.length === 0) return <JsonLeaf label={label} value="[]" className="json-array" />;
        return (
            <div className="json-node" style={depth > 0 ? { marginLeft: 16 } : undefined}>
                <span className="json-toggle" onClick={toggle}>
                    {expanded ? '▼' : '▶'}
                </span>
                {label != null && <span className="json-key">{label}: </span>}
                <span className="json-bracket">Array[{data.length}]</span>
                {expanded && (
                    <div className="json-children">
                        {data.map((item, i) => (
                            <JsonTree key={i} data={item} depth={depth + 1} label={String(i)} />
                        ))}
                    </div>
                )}
            </div>
        );
    }

    if (typeof data === 'object') {
        const obj = data as Record<string, unknown>;
        const entries = Object.entries(obj);
        if (entries.length === 0) return <JsonLeaf label={label} value="{}" className="json-object" />;

        // Serialized GPU object with tracking ID — render as compact link
        if (obj.__type && typeof obj.__type === 'string' && obj.__id && typeof obj.__id === 'string') {
            const link = maybeResourceLink(obj.__id as string);
            const objLabel = obj.label ? ` "${obj.label}"` : '';
            return (
                <div className="json-leaf" style={{ marginLeft: 16 }}>
                    {label != null && <span className="json-key">{label}: </span>}
                    <span className="json-string">{obj.__type as string}{objLabel} </span>
                    {link || <span className="json-string">{obj.__id as string}</span>}
                </div>
            );
        }

        return (
            <div className="json-node" style={depth > 0 ? { marginLeft: 16 } : undefined}>
                <span className="json-toggle" onClick={toggle}>
                    {expanded ? '▼' : '▶'}
                </span>
                {label != null && <span className="json-key">{label}: </span>}
                <span className="json-bracket">{`{${entries.length}}`}</span>
                {expanded && (
                    <div className="json-children">
                        {entries.map(([key, value]) => (
                            <JsonTree key={key} data={value} depth={depth + 1} label={key} />
                        ))}
                    </div>
                )}
            </div>
        );
    }

    return <JsonLeaf label={label} value={String(data)} className="json-unknown" />;
}

function JsonLeaf({ label, value, className }: { label?: string; value: string; className: string }) {
    return (
        <div className="json-leaf" style={{ marginLeft: 16 }}>
            {label != null && <span className="json-key">{label}: </span>}
            <span className={className}>{value}</span>
        </div>
    );
}
