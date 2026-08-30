import React from "react";
import { ANIMATION_FORMATS } from "./exportAnimation";
import { ExportPreview } from "./ExportPreview";

const SECONDARY_BUTTON = "h-8 rounded-md border border-white/10 px-3 text-[11px] font-medium text-[#9ca5a3] hover:bg-white/[0.06] disabled:cursor-default disabled:opacity-40";
const PRIMARY_BUTTON = "h-8 rounded-md border border-[#66e4b3] bg-[#66e4b3] px-3 text-[11px] font-semibold text-[#102019] hover:bg-[#8aefc8] disabled:cursor-default disabled:opacity-50";

function ScopeCard({ scope, selected, preview, busy, onSelect }) {
  return <button
    type="button"
    className={`overflow-hidden rounded-xl border text-start transition-colors ${selected ? "border-[#66e4b3]/60 bg-[#66e4b3]/[0.06]" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"}`}
    aria-pressed={selected}
    onClick={onSelect}
  >
    <div className="flex h-36 items-center justify-center overflow-hidden border-b border-white/10 bg-[linear-gradient(45deg,#252b28_25%,transparent_25%),linear-gradient(-45deg,#252b28_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#252b28_75%),linear-gradient(-45deg,transparent_75%,#252b28_75%)] bg-[length:14px_14px] bg-[position:0_0,0_7px,7px_-7px,-7px_0px]">
      {preview?.url
        ? <img className="block h-full w-full object-contain object-center" src={preview.url} alt={`${scope} export preview`} />
        : <span className="text-[10px] text-[#66716c]">{preview?.error || (busy ? "Rendering preview…" : "Preview unavailable")}</span>}
    </div>
    <div className="grid gap-1 p-3">
      <strong className="text-[11px] font-semibold text-[#e4ebe8]">{scope === "viewport" ? "Canvas frame" : "Entire scene"}</strong>
      <span className="text-[9px] leading-4 text-[#718079]">{scope === "viewport" ? "Exact visible Canvas crop" : "Every projected layer, unclipped"}</span>
      {preview?.captureWidth && <span className="font-mono text-[9px] text-[#5f6c66]">{preview.captureWidth} × {preview.captureHeight} CSS px</span>}
    </div>
  </button>;
}

function FormatCard({ id, selected, available, onSelect }) {
  const format = ANIMATION_FORMATS[id];
  const descriptions = {
    mp4: "Universal playback · opaque",
    webm: "Web playback · transparent",
    pngSequence: "Lossless frames · transparent",
    prores4444: "Production master · transparent",
  };
  return <button
    type="button"
    className={`grid gap-1 rounded-lg border p-3 text-start transition-colors ${selected ? "border-[#66e4b3]/60 bg-[#66e4b3]/[0.06]" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"} disabled:cursor-not-allowed disabled:opacity-35`}
    disabled={!available}
    aria-pressed={selected}
    onClick={onSelect}
  >
    <span className="flex items-center justify-between gap-2"><strong className="text-[11px] text-[#e4ebe8]">{format.label}</strong>{format.transparent && <span className="rounded-full bg-[#66e4b3]/10 px-1.5 py-0.5 font-mono text-[7px] font-bold tracking-wide text-[#75e5b9] uppercase">Alpha</span>}</span>
    <span className="text-[9px] text-[#718079]">{descriptions[id]}</span>
  </button>;
}

export function ExportDialog({
  kind,
  setKind,
  format,
  setFormat,
  fps,
  setFps,
  scale,
  setScale,
  scope,
  setScope,
  duration,
  capabilities,
  previews,
  isPreviewing,
  isExporting,
  progress,
  status,
  pending,
  didSave,
  previewFooter,
  onClose,
  onBack,
  onPreview,
  onSave,
}) {
  const isAnimation = kind === "animation";
  const animationPlayable = pending && new Set(["mp4", "webm"]).has(pending.format);
  const formatAvailable = (id) => capabilities?.available !== false
    && (id === "pngSequence" || capabilities?.ffmpeg !== false);
  const footerSummary = isAnimation
    ? `${ANIMATION_FORMATS[format].label} · ${fps} fps · ${duration.toFixed(2)}s · ${ANIMATION_FORMATS[format].transparent ? "transparent" : "opaque"}`
    : "PNG · transparent · up to 4× · 16,384px max";

  return <div className="fixed inset-0 z-[1000] grid place-items-center bg-[#040706]/80 p-6 backdrop-blur-xl" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#151a18] text-[#e9efec] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <header className="flex items-start justify-between border-b border-white/10 px-5 py-4">
        <div><span className="font-mono text-[9px] font-bold tracking-[0.12em] text-[#65dcae] uppercase">Export</span><h2 className="mt-1 text-base font-semibold" id="export-title">{pending ? `${isAnimation ? "Animation" : "Frame"} ready` : "Export the scene"}</h2></div>
        <button type="button" className="p-1 text-xl leading-none text-[#7e8984] hover:text-white" onClick={onClose} aria-label="Close">×</button>
      </header>

      {pending ? <div className="grid gap-4 p-5">
        {isAnimation ? <div className="grid min-h-64 place-items-center overflow-hidden rounded-xl border border-white/10 bg-[linear-gradient(45deg,#252b28_25%,transparent_25%),linear-gradient(-45deg,#252b28_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#252b28_75%),linear-gradient(-45deg,transparent_75%,#252b28_75%)] bg-[length:14px_14px] bg-[position:0_0,0_7px,7px_-7px,-7px_0px]">
          {animationPlayable
            ? <video className="max-h-[360px] max-w-full" src={pending.url} controls loop playsInline />
            : previews.viewport?.url
              ? <div className="relative grid h-full w-full place-items-center"><img className="max-h-[360px] max-w-full object-contain" src={previews.viewport.url} alt="Animation poster frame" /><span className="absolute bottom-3 rounded bg-black/70 px-2 py-1 font-mono text-[8px] text-[#b7c2bd]">Preview in a compatible editor</span></div>
              : <span className="text-[10px] text-[#718079]">Encoded animation ready</span>}
        </div> : <ExportPreview key={`bounded-${pending.url}`} src={pending.url} alt="Final transparent PNG preview" footer={previewFooter} />}
        <div className="grid gap-1">
          <strong className="text-xs font-semibold">{isAnimation ? ANIMATION_FORMATS[pending.format].label : pending.scope === "scene" ? "Entire scene" : "Canvas frame"} ready</strong>
          {didSave ? <a className="w-fit max-w-full truncate font-mono text-[10px] text-[#75e5b9] underline decoration-[#75e5b9]/40 underline-offset-2 hover:text-[#a2f3d3]" href={pending.url} target="_blank" rel="noreferrer" title="Open the export">{pending.filename} ↗</a> : <span className="truncate font-mono text-[10px] text-[#718079]">{pending.filename}</span>}
          {isAnimation
            ? <span className="text-[10px] text-[#718079]">{pending.frameCount} frames · {pending.fps} fps · {pending.duration.toFixed(2)}s · {pending.transparent ? "transparent" : "opaque"}</span>
            : <span className="text-[10px] text-[#718079]">{pending.width} × {pending.height}px · {pending.pixelRatio.toFixed(2)}× · transparent PNG</span>}
          {status && <span className="mt-1 text-[10px] text-[#aab5b0]" role="status">{status}</span>}
        </div>
      </div> : <div className="grid gap-4 p-5">
        <div className="inline-flex w-fit overflow-hidden rounded-lg border border-white/10" aria-label="Export type">
          {[['frame', 'Still frame'], ['animation', 'Animation']].map(([value, label]) => <button type="button" key={value} className={`h-8 px-3 text-[10px] font-semibold transition-colors ${kind === value ? "bg-[#66e4b3]/12 text-[#dff9ee]" : "bg-white/[0.025] text-[#84908a] hover:bg-white/[0.06]"}`} aria-pressed={kind === value} onClick={() => setKind(value)}>{label}</button>)}
        </div>

        {isAnimation ? <>
          <p className="m-0 text-[11px] leading-5 text-[#7e8984]">Render the timeline one exact Canvas frame at a time, then encode it locally. Transparent formats preserve the alpha channel.</p>
          <div className="grid grid-cols-2 gap-2">{Object.keys(ANIMATION_FORMATS).map((id) => <FormatCard key={id} id={id} selected={format === id} available={formatAvailable(id)} onSelect={() => setFormat(id)} />)}</div>
          <div className="flex items-end gap-3 rounded-lg border border-white/[0.07] bg-black/10 p-3">
            <label className="grid gap-1 font-mono text-[8px] font-bold tracking-wide text-[#6f7b75] uppercase"><span>Frame rate</span><select className="h-8 rounded-md border border-white/10 bg-[#0c100e] px-2 text-[10px] text-[#d6dfdb] outline-none" value={fps} onChange={(event) => setFps(Number(event.currentTarget.value))}>{[24, 30, 60].map((value) => <option key={value} value={value}>{value} fps</option>)}</select></label>
            <label className="grid gap-1 font-mono text-[8px] font-bold tracking-wide text-[#6f7b75] uppercase"><span>Resolution</span><select className="h-8 rounded-md border border-white/10 bg-[#0c100e] px-2 text-[10px] text-[#d6dfdb] outline-none" value={scale} onChange={(event) => setScale(Number(event.currentTarget.value))}>{[1, 2, 4].map((value) => <option key={value} value={value}>{value}× Canvas</option>)}</select></label>
            <span className="pb-2 text-[9px] text-[#65716b]">{Math.max(2, Math.round(duration * fps))} frames</span>
          </div>
          {capabilities?.available === false
            ? <p className="m-0 text-[10px] text-[#ffaaa5]">Animation encoding requires the local Toretto studio service.</p>
            : capabilities?.ffmpeg === false && format !== "pngSequence" && <p className="m-0 text-[10px] text-[#ffaaa5]">FFmpeg is unavailable. Choose PNG sequence.</p>}
        </> : <>
          <p className="m-0 text-[11px] leading-5 text-[#7e8984]">Preserve the visible Canvas crop or include every projected DOM layer. Both omit Toretto’s Canvas grid and use a transparent background.</p>
          <div className="grid grid-cols-2 gap-3">{["viewport", "scene"].map((value) => <ScopeCard key={value} scope={value} selected={scope === value} preview={previews[value]} busy={isPreviewing} onSelect={() => setScope(value)} />)}</div>
        </>}
        {isExporting && <div className="grid gap-1"><div className="h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-[#66e4b3] transition-[width]" style={{ width: `${progress}%` }} /></div><span className="font-mono text-[8px] text-[#718079]">{status}</span></div>}
        {!isExporting && status && <p className="m-0 text-[10px] text-[#ffaaa5]" role="alert">{status}</p>}
      </div>}

      <footer className="flex items-center justify-between border-t border-white/10 px-5 py-3">
        <span className="text-[9px] text-[#68746e]">{footerSummary}</span>
        <div className="flex gap-2">{pending ? <><button type="button" className={SECONDARY_BUTTON} onClick={onBack}>Back</button><button type="button" className={PRIMARY_BUTTON} onClick={onSave}>Save {isAnimation ? ANIMATION_FORMATS[pending.format].label : "PNG"}…</button></> : <><button type="button" className={SECONDARY_BUTTON} disabled={isExporting} onClick={onClose}>Cancel</button><button type="button" className={PRIMARY_BUTTON} disabled={isPreviewing || isExporting || (isAnimation && !formatAvailable(format))} onClick={onPreview}>{isExporting ? "Rendering…" : "Preview…"}</button></>}</div>
      </footer>
    </section>
  </div>;
}
