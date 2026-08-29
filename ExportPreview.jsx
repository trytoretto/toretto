import React, { useEffect, useRef, useState } from "react";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 12;

function clampZoom(value) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

export function ExportPreview({ src, alt }) {
  const paneRef = useRef(null);
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });

  useEffect(() => setView({ x: 0, y: 0, zoom: 1 }), [src]);

  const constrainView = (next) => {
    const pane = paneRef.current;
    const image = imageRef.current;
    if (!pane || !image) return { ...next, x: 0, y: 0 };
    const naturalWidth = image.naturalWidth || 1;
    const naturalHeight = image.naturalHeight || 1;
    const fit = Math.min(
      1,
      pane.clientWidth / naturalWidth,
      pane.clientHeight / naturalHeight,
    );
    const fittedWidth = naturalWidth * fit;
    const fittedHeight = naturalHeight * fit;
    const maxX = Math.abs(fittedWidth * next.zoom - pane.clientWidth) / 2;
    const maxY = Math.abs(fittedHeight * next.zoom - pane.clientHeight) / 2;
    return {
      ...next,
      x: Math.max(-maxX, Math.min(maxX, next.x)),
      y: Math.max(-maxY, Math.min(maxY, next.y)),
    };
  };

  const resistView = (next) => {
    const constrained = constrainView(next);
    return {
      ...next,
      x: constrained.x + (next.x - constrained.x) * 0.16,
      y: constrained.y + (next.y - constrained.y) * 0.16,
    };
  };

  const changeZoom = (factor, anchor = { x: 0, y: 0 }) => {
    setView((current) => {
      const zoom = clampZoom(current.zoom * factor);
      const ratio = zoom / current.zoom;
      return constrainView({
        zoom,
        x: anchor.x + (current.x - anchor.x) * ratio,
        y: anchor.y + (current.y - anchor.y) * ratio,
      });
    });
  };

  const beginPan = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { x: event.clientX, y: event.clientY, startX: view.x, startY: view.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePan = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    setView((current) => resistView({
      ...current,
      x: drag.startX + event.clientX - drag.x,
      y: drag.startY + event.clientY - drag.y,
    }));
  };

  const endPan = (event) => {
    dragRef.current = null;
    setView((current) => constrainView(current));
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const reset = () => setView({ x: 0, y: 0, zoom: 1 });

  return (
    <div
      ref={paneRef}
      className="relative grid h-72 cursor-grab touch-none place-items-center overflow-hidden rounded-xl border border-[#39433f] bg-[linear-gradient(45deg,#252b28_25%,transparent_25%),linear-gradient(-45deg,#252b28_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#252b28_75%),linear-gradient(-45deg,transparent_75%,#252b28_75%)] bg-clip-padding bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px] active:cursor-grabbing"
      onPointerDown={beginPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onDoubleClick={reset}
      onWheel={(event) => {
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        changeZoom(Math.exp(event.deltaY * 0.0015), {
          x: event.clientX - rect.left - rect.width / 2,
          y: event.clientY - rect.top - rect.height / 2,
        });
      }}
      aria-label="Export preview. Drag to pan and scroll to zoom."
    >
      <img
        ref={imageRef}
        className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain object-center will-change-transform"
        style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})` }}
        src={src}
        alt={alt}
        draggable="false"
      />
      <span className="pointer-events-none absolute start-2 top-2 rounded bg-[#0c100e]/80 px-2 py-1 font-mono text-[8px] text-[#819089] backdrop-blur">Drag to pan · scroll to zoom</span>
      <div className="absolute end-2 bottom-2 flex items-center overflow-hidden rounded-md border border-white/10 bg-[#0c100e]/90 shadow-lg" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" className="h-7 w-7 text-[12px] text-[#aeb8b4] hover:bg-white/[0.08]" onClick={() => changeZoom(1 / 1.25)} aria-label="Zoom out">−</button>
        <button type="button" className="h-7 min-w-12 border-x border-white/10 px-2 font-mono text-[9px] text-[#8d9994] hover:bg-white/[0.08]" onClick={reset} aria-label="Reset preview zoom" title="Reset preview">{Math.round(view.zoom * 100)}%</button>
        <button type="button" className="h-7 w-7 text-[12px] text-[#aeb8b4] hover:bg-white/[0.08]" onClick={() => changeZoom(1.25)} aria-label="Zoom in">+</button>
      </div>
    </div>
  );
}
