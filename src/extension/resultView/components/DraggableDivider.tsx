import React, { useCallback, useRef } from 'react';

interface DraggableDividerProps {
    onDrag: (deltaX: number) => void;
}

export function DraggableDivider({ onDrag }: DraggableDividerProps) {
    const draggingRef = useRef(false);
    const lastXRef = useRef(0);
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const dividerRef = useRef<HTMLDivElement | null>(null);

    const cleanup = useCallback(() => {
        draggingRef.current = false;
        if (overlayRef.current) {
            overlayRef.current.remove();
            overlayRef.current = null;
        }
        dividerRef.current?.classList.remove('dragging');
    }, []);

    const onMouseMove = useCallback((e: MouseEvent) => {
        if (!draggingRef.current) return;
        const dx = e.clientX - lastXRef.current;
        lastXRef.current = e.clientX;
        if (dx !== 0) onDrag(dx);
    }, [onDrag]);

    const onMouseUp = useCallback(() => {
        cleanup();
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }, [cleanup, onMouseMove]);

    const onMouseDown = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        draggingRef.current = true;
        lastXRef.current = e.clientX;
        dividerRef.current?.classList.add('dragging');

        // Full-viewport overlay prevents text selection and iframe interference
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:9999;cursor:col-resize;';
        document.body.appendChild(overlay);
        overlayRef.current = overlay;

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }, [onMouseMove, onMouseUp]);

    return (
        <div
            ref={dividerRef}
            className="divider-v"
            onMouseDown={onMouseDown}
        />
    );
}
