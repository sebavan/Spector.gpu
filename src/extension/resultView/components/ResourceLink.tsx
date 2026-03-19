import React from 'react';
import { useNavigateToResource, type ResourceCategory } from './NavigationContext';

/**
 * Map resource-ID prefixes to their ResourceCategory.
 * Prefix is the part before the underscore+digits, e.g. "buf" from "buf_3".
 *
 * Order doesn't matter — lookup is by exact key after splitting on `_\d+$`.
 */
const PREFIX_TO_CATEGORY: Readonly<Record<string, ResourceCategory>> = {
    buf: 'buffers',
    tex: 'textures',
    tv: 'textureViews',
    smp: 'samplers',
    shd: 'shaderModules',
    rp: 'renderPipelines',
    cp: 'computePipelines',
    bg: 'bindGroups',
    bgl: 'bindGroupLayouts',
};

/** Pre-compiled regex — executed once at module load. */
const RESOURCE_ID_RE = /^(buf|tex|tv|smp|shd|rp|cp|bg|bgl)_\d+$/;

/**
 * Resolve a resource ID string to its category.
 * Returns undefined if the ID doesn't match a known pattern.
 */
export function categoryForId(id: string): ResourceCategory | undefined {
    const sep = id.lastIndexOf('_');
    if (sep < 1) return undefined;
    return PREFIX_TO_CATEGORY[id.substring(0, sep)];
}

/**
 * Clickable resource ID that navigates to the resource in the Resources tab.
 * Falls back to plain text for unknown/unlinked IDs.
 */
export function ResourceLink({ id }: { id: string }) {
    const navigate = useNavigateToResource();

    if (!id || id === 'unknown' || id === 'auto') {
        return <span className="resource-id-plain">{id}</span>;
    }

    const category = categoryForId(id);
    if (!category) {
        return <span className="resource-id-plain">{id}</span>;
    }

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        navigate({ category, id });
    };

    return (
        <span className="resource-link" onClick={handleClick} title={`Go to ${id}`}>
            {id}
        </span>
    );
}

/**
 * If `value` looks like a resource ID, return a ResourceLink element.
 * Otherwise return null. Used by JsonTree for auto-linking.
 */
export function maybeResourceLink(value: string): React.ReactElement | null {
    if (RESOURCE_ID_RE.test(value)) {
        return <ResourceLink id={value} />;
    }
    return null;
}
