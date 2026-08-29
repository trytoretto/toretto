import React, { useEffect, useRef, useState } from "react";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 12;

function clampZoom(value) {
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
}

export function ExportPreview({ src, alt }) {
  const dragRef = useRef(null);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });

  useEffect(() => setView({ x: 0, y: 0, zoom: 1 }), [src]);

  const changeZoom = (factor) => {
    setView((current) => ({ ...current, zoom: clampZoom(current.zoom * factor) }));
  };

  const beginPan = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { x: event.clientX, y: event.clientY, startX: view.x, startY: view.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const movePan = (event) => {
    if (!dragRef.current) return;
    setView((current) => ({
      ...current,
      x: dragRef.current.startX + event.clientX - dragRef.current.x,
      y: dragRef.current.startY + event.clientY - dragRef.current.y,
    }));
  };

  const endPan = (event) => {
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const reset = () => setView({ x: 0, y: 0, zoom: 1 });

  return (
    <div
      className="relative grid h-72 cursor-grab touch-none place-items-center overflow-hidden rounded-xl border border-white/10 bg-[linear-gradient(45deg,#252b28_25%,transparent_25%),linear-gradient(-45deg,#252b28_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#252b28_75%),linear-gradient(-45deg,transparent_75%,#252b28_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0px] active:cursor-grabbing"
      onPointerDown={beginPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onDoubleClick={reset}
      onWheel={(event) => {
        event.preventDefault();
        changeZoom(Math.exp(-event.deltaY * 0.0015));
      }}
      aria-label="Export preview. Drag to pan and scroll to zoom."
    >
      <img
        className="pointer-events-none max-h-full max-w-full select-none object-contain will-change-transform"
        style={{ transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})` }}
        src={src}
        alt={alt}
        draggable="false"
      />
      <span className="pointer-events-none absolute start-2 top-2 rounded bg-[#0c100e]/80 px-2 py-1 font-mono text-[8px] text-[#819089] backdrop-blur">Drag to pan · scroll to zoom</span>
      <div className="absolute end-2 bottom-2 flex items-center overflow-hidden rounded-md border border-white/10 bg-[#0c100e]/90 shadow-lg" onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" className="h-7 w-7 text-[12px] text-[#aeb8b4] hover:bg-white/[0.08]" onClick={() => changeZoom(1 / 1.25)} aria-label="Zoom out">−</button>
        <button type="button" className="h-7 min-w-12 border-x border-white/10 px-2 font-mono text-[9px] text-[#8d9994] hover:bg-white/[0.08]" onClick={reset} title="Reset preview">{Math.round(view.zoom * 100)}%</button>
        <button type="button" className="h-7 w-7 text-[12px] text-[#aeb8b4] hover:bg-white/[0.08]" onClick={() => changeZoom(1.25)} aria-label="Zoom in">+</button>
      </div>
    </div>
  );
}
