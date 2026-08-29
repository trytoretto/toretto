import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { exportTransparentPng, renderPngPreview } from "./exportFrame";
import { ExportPreview } from "./ExportPreview";

const APP_WIDTH = 1440;
const APP_HEIGHT = 900;
const SURFACE_TAGS = new Set(["MAIN", "HEADER", "ASIDE", "NAV", "SECTION", "ARTICLE", "BUTTON", "DIALOG"]);
const TOOLBAR_BUTTON = "h-7 cursor-pointer whitespace-nowrap rounded-md border border-white/10 bg-white/[0.035] px-2.5 text-[11px] font-medium leading-none text-[#9ca5a3] transition-colors hover:bg-white/[0.07] hover:text-[#f2f5f4]";
const TOOLBAR_ACTIVE = "!border-[#66e4b3]/35 !bg-[#66e4b3]/10 !text-[#dff9ee]";
const MODE_BUTTON = "h-7 cursor-pointer bg-white/[0.035] px-2.5 text-[11px] font-medium leading-none text-[#9ca5a3] transition-colors hover:bg-white/[0.07] hover:text-[#f2f5f4]";
const SOURCE_BUTTON = "h-7 cursor-pointer whitespace-nowrap rounded-md border border-[#66e4b3] bg-[#66e4b3] px-2.5 text-[11px] font-semibold leading-none text-[#102019] transition-colors hover:border-[#8aefc8] hover:bg-[#8aefc8]";

function wrapAngle(angle) {
  return ((angle + 180) % 360 + 360) % 360 - 180;
}

function spatialWeight(element, computed) {
  if (element.hasAttribute("data-toretto-root")) return 0;
  const structuralWeight = element.dataset.component || SURFACE_TAGS.has(element.tagName)
    ? 1
    : element.children.length > 0
      ? 0.62
      : 0.22;
  const zIndex = Number(computed.zIndex);
  if (!Number.isFinite(zIndex) || zIndex === 0) return structuralWeight;
  const stackingWeight = Math.sign(zIndex) * (1.5 + Math.log10(Math.abs(zIndex) + 1));
  return structuralWeight + stackingWeight;
}

export function Spatializer({ children, onOpenSource }) {
  const rootRef = useRef(null);
  const cameraRef = useRef(null);
  const specimenRef = useRef(null);
  const nodesRef = useRef([]);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const mutationFrameRef = useRef(0);
  const scrubTimerRef = useRef(0);
  const exportTimerRef = useRef(0);
  const exportUrlRef = useRef("");
  const exportPreviewUrlsRef = useRef([]);
  const previewGenerationRef = useRef(0);
  const explosionRef = useRef(0);
  const maxDepthWeightRef = useRef(0);
  const [explosion, setExplosion] = useState(0);
  const [perspective, setPerspective] = useState(5200);
  const [mode, setMode] = useState("orbit");
  const [pitch, setPitch] = useState(0);
  const [yaw, setYaw] = useState(0);
  const [roll, setRoll] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [fitScale, setFitScale] = useState(0.7);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isScrubbingExplosion, setIsScrubbingExplosion] = useState(false);
  const [isAltHeld, setIsAltHeld] = useState(false);
  const [isShiftHeld, setIsShiftHeld] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isPreviewingExport, setIsPreviewingExport] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState("viewport");
  const [scenePadding, setScenePadding] = useState(10);
  const [exportPreviews, setExportPreviews] = useState({});
  const [exportStatus, setExportStatus] = useState("");
  const [pendingExport, setPendingExport] = useState(null);
  const [didSaveExport, setDidSaveExport] = useState(false);
  const [nodeCount, setNodeCount] = useState(0);
  explosionRef.current = explosion;

  const fitView = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera || camera.hasAttribute("data-export-scene")) return;
    const next = Math.min((camera.clientWidth - 24) / APP_WIDTH, (camera.clientHeight - 24) / APP_HEIGHT);
    setFitScale(Math.max(0.2, next));
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const updateNodeDepth = useCallback((amount) => {
    const localGap = amount * 0.3;
    if (amount === 0) {
      const scrollRegion = specimenRef.current?.querySelector("[data-toretto-scroll]");
      if (scrollRegion) scrollRegion.scrollTop = 0;
    }
    const liveNodes = specimenRef.current
      ? [...specimenRef.current.querySelectorAll("[data-spatial-node]")]
      : nodesRef.current.filter((element) => element.isConnected);
    nodesRef.current = liveNodes;
    liveNodes.forEach((element, index) => {
      const z = localGap * Number(element.dataset.spatialWeight || 0);
      element.dataset.spatialOrder = String(index);
      element.style.setProperty("--spatial-local-z", `${z.toFixed(2)}px`);
    });
  }, []);

  const indexDom = useCallback(() => {
    const specimen = specimenRef.current;
    const appShell = specimen?.querySelector("[data-toretto-root]");
    if (!appShell) return;
    const candidates = [appShell, ...appShell.querySelectorAll("*")];
    const nodes = candidates.filter((element) => {
      if (element.matches("svg, svg *")) return false;
      return element.offsetWidth > 3
        && element.offsetHeight > 3
        && getComputedStyle(element).display !== "contents";
    });
    for (const element of nodes) {
      const computed = getComputedStyle(element);
      element.dataset.spatialNode = "";
      element.dataset.spatialWeight = String(spatialWeight(element, computed));
      const clipsDepth = [computed.overflow, computed.overflowX, computed.overflowY]
        .some((value) => value !== "visible" && value !== "clip");
      if (!element.dataset.spatialOriginalOverflow) {
        element.dataset.spatialOriginalOverflow = clipsDepth ? "clip" : "visible";
      }
      if (element.dataset.spatialOriginalOverflow === "clip") element.dataset.spatialClips = "";
    }
    maxDepthWeightRef.current = nodes.reduce((maximum, element) => {
      let depthWeight = 0;
      let current = element;
      while (current && appShell.contains(current)) {
        if (current.hasAttribute("data-spatial-node")) {
          depthWeight += Number(current.dataset.spatialWeight || 0);
        }
        if (current === appShell) break;
        current = current.parentElement;
      }
      return Math.max(maximum, depthWeight);
    }, 0);
    nodesRef.current = nodes;
    setNodeCount(nodes.length);
    updateNodeDepth(explosionRef.current);
  }, [updateNodeDepth]);

  useLayoutEffect(() => {
    indexDom();
    const specimen = specimenRef.current;
    if (!specimen) return undefined;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(mutationFrameRef.current);
      mutationFrameRef.current = requestAnimationFrame(indexDom);
    });
    observer.observe(specimen, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(mutationFrameRef.current);
    };
  }, [indexDom]);

  useEffect(() => updateNodeDepth(explosion), [explosion, updateNodeDepth]);

  useEffect(() => () => {
    window.clearTimeout(scrubTimerRef.current);
    window.clearTimeout(exportTimerRef.current);
    if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);
    exportPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    const handleModifierDown = (event) => {
      if (event.key === "Shift") setIsShiftHeld(true);
      if (event.key === "Alt") setIsAltHeld(true);
    };
    const handleModifierUp = (event) => {
      if (event.key === "Shift") setIsShiftHeld(false);
      if (event.key === "Alt") setIsAltHeld(false);
    };
    const clearModifiers = () => {
      setIsShiftHeld(false);
      setIsAltHeld(false);
    };
    window.addEventListener("keydown", handleModifierDown);
    window.addEventListener("keyup", handleModifierUp);
    window.addEventListener("blur", clearModifiers);
    return () => {
      window.removeEventListener("keydown", handleModifierDown);
      window.removeEventListener("keyup", handleModifierUp);
      window.removeEventListener("blur", clearModifiers);
    };
  }, []);

  useEffect(() => {
    const camera = cameraRef.current;
    if (!camera) return undefined;
    resizeRef.current = new ResizeObserver(fitView);
    resizeRef.current.observe(camera);
    fitView();
    return () => resizeRef.current?.disconnect();
  }, [fitView]);

  useEffect(() => {
    const handleFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === rootRef.current);
      requestAnimationFrame(fitView);
    };
    document.addEventListener("fullscreenchange", handleFullscreen);
    return () => document.removeEventListener("fullscreenchange", handleFullscreen);
  }, [fitView]);

  const flatten = () => {
    explosionRef.current = 0;
    updateNodeDepth(0);
    setExplosion(0);
  };

  const reset = () => {
    flatten();
    setPerspective(5200);
    setPitch(0);
    setYaw(0);
    setRoll(0);
    fitView();
  };

  const toggleFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await rootRef.current?.requestFullscreen();
  };

  const exportFrame = async (scope, padding = scenePadding) => {
    if (!cameraRef.current || isExporting) return;
    setIsExporting(true);
    setExportStatus("");
    setDidSaveExport(false);
    try {
      const result = await exportTransparentPng(cameraRef.current, scope, { scenePadding: padding });
      if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);
      exportUrlRef.current = URL.createObjectURL(result.blob);
      setPendingExport({ ...result, url: exportUrlRef.current });
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : "The frame could not be exported.");
    } finally {
      setIsExporting(false);
      window.clearTimeout(exportTimerRef.current);
      exportTimerRef.current = window.setTimeout(() => setExportStatus(""), 5000);
    }
  };

  const openExport = async () => {
    if (!cameraRef.current) return;
    const generation = previewGenerationRef.current + 1;
    previewGenerationRef.current = generation;
    exportPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    exportPreviewUrlsRef.current = [];
    setExportPreviews({});
    setExportStatus("");
    setExportOpen(true);
    setIsPreviewingExport(true);
    const scopes = ["viewport", "scene"];
    const results = [];
    for (const scope of scopes) {
      try {
        results.push({ status: "fulfilled", value: await renderPngPreview(cameraRef.current, scope, { scenePadding }) });
      } catch (reason) {
        results.push({ status: "rejected", reason });
      }
    }
    if (previewGenerationRef.current !== generation) return;
    const previews = {};
    results.forEach((result, index) => {
      const scope = scopes[index];
      if (result.status === "fulfilled") {
        const url = URL.createObjectURL(result.value.blob);
        exportPreviewUrlsRef.current.push(url);
        previews[scope] = { ...result.value, url };
      } else {
        previews[scope] = { error: result.reason instanceof Error ? result.reason.message : "Preview unavailable." };
      }
    });
    setExportPreviews(previews);
    setIsPreviewingExport(false);
  };

  const closeExport = () => {
    previewGenerationRef.current += 1;
    if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);
    exportUrlRef.current = "";
    exportPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    exportPreviewUrlsRef.current = [];
    setExportPreviews({});
    setPendingExport(null);
    setDidSaveExport(false);
    setExportOpen(false);
    setExportStatus("");
    setIsPreviewingExport(false);
  };

  const backToExportOptions = () => {
    if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);
    exportUrlRef.current = "";
    setPendingExport(null);
    setDidSaveExport(false);
    setExportStatus("");
  };

  const saveExport = async () => {
    if (!pendingExport) return;
    if (typeof window.showSaveFilePicker === "function") {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: pendingExport.filename,
          types: [{ description: "PNG image", accept: { "image/png": [".png"] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(pendingExport.blob);
        await writable.close();
        window.clearTimeout(exportTimerRef.current);
        setDidSaveExport(true);
        setExportStatus(`Saved ${pendingExport.filename}`);
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== "AbortError") {
          setExportStatus(error instanceof Error ? error.message : "The PNG could not be saved.");
        }
      }
      return;
    }

    const link = document.createElement("a");
    link.download = pendingExport.filename;
    link.href = pendingExport.url;
    link.click();
    window.clearTimeout(exportTimerRef.current);
    setDidSaveExport(true);
    setExportStatus(`Download started · ${pendingExport.filename} · check the browser's Downloads`);
  };

  const handleExplosionInput = (event) => {
    setIsScrubbingExplosion(true);
    setExplosion(Number(event.currentTarget.value));
    window.clearTimeout(scrubTimerRef.current);
    scrubTimerRef.current = window.setTimeout(() => setIsScrubbingExplosion(false), 120);
  };

  const beginDrag = (event) => {
    event.preventDefault();
    cameraRef.current?.focus({ preventScroll: true });
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      button: event.button,
    };
    cameraRef.current?.setPointerCapture(event.pointerId);
  };

  const moveDrag = (event) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    const panGesture = mode === "pan" || event.shiftKey || drag.button === 1 || drag.button === 2;
    const rollGesture = !panGesture && event.altKey;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (panGesture) setPan((current) => ({ x: current.x + dx, y: current.y + dy }));
    else if (rollGesture) setRoll((current) => wrapAngle(current + dx * 0.24));
    else {
      setYaw((current) => wrapAngle(current + dx * 0.2));
      setPitch((current) => wrapAngle(current - dy * 0.18));
    }
  };

  const endDrag = (event) => {
    dragRef.current = null;
    if (cameraRef.current?.hasPointerCapture(event.pointerId)) cameraRef.current.releasePointerCapture(event.pointerId);
  };

  const handleWheel = (event) => {
    event.preventDefault();
    if (event.shiftKey) {
      setPan((current) => ({ x: current.x - event.deltaY, y: current.y }));
      return;
    }
    const factor = Math.exp(event.deltaY * 0.0012);
    setZoom((current) => Math.max(0.12, Math.min(4, current * factor)));
  };

  const handleKeyDown = (event) => {
    const panStep = event.shiftKey ? 80 : 28;
    const handled = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "q", "e", "+", "=", "-"].includes(event.key);
    if (handled) event.preventDefault();
    if (event.key === "ArrowLeft") setPan((current) => ({ ...current, x: current.x - panStep }));
    if (event.key === "ArrowRight") setPan((current) => ({ ...current, x: current.x + panStep }));
    if (event.key === "ArrowUp") setPan((current) => ({ ...current, y: current.y - panStep }));
    if (event.key === "ArrowDown") setPan((current) => ({ ...current, y: current.y + panStep }));
    if (event.key.toLowerCase() === "q") setRoll((current) => wrapAngle(current - 8));
    if (event.key.toLowerCase() === "e") setRoll((current) => wrapAngle(current + 8));
    if (event.key === "+" || event.key === "=") setZoom((current) => Math.min(4, current * 1.12));
    if (event.key === "-") setZoom((current) => Math.max(0.12, current / 1.12));
  };

  // Counter-scale the camera as the stack grows toward it. This keeps the
  // exploded specimen framed without changing the relative spacing of layers.
  const depthFit = 1 / (1 + (explosion / 1000) * 0.6);
  const stageScale = fitScale * zoom * depthFit;
  const deepestLayerZ = explosion * 0.3 * maxDepthWeightRef.current * stageScale;
  const rotatedStageZ = (
    APP_WIDTH * Math.abs(Math.sin(yaw * Math.PI / 180))
    + APP_HEIGHT * Math.abs(Math.sin(pitch * Math.PI / 180))
  ) * stageScale * 0.5;
  const safePerspective = Math.max(perspective, deepestLayerZ + rotatedStageZ + 1200);
  const stageTransform = `translate3d(${pan.x}px, ${pan.y}px, 0) rotateZ(${roll}deg) rotateX(${pitch}deg) rotateY(${yaw}deg) scale(${stageScale})`;
  const effectiveMode = mode === "pan" || isShiftHeld ? "pan" : isAltHeld ? "roll" : "orbit";
  const exportPreviewFooter = pendingExport?.scope === "scene" ? (
    <>
      <label className="flex items-center gap-2 text-[10px] font-medium text-[#8e9a94]">
        <span>Scene padding</span>
        <select
          className="h-7 rounded-md border border-white/10 bg-[#0c100e] px-2 text-[10px] text-[#d6dfdb] outline-none focus:border-[#66e4b3]/50"
          value={scenePadding}
          disabled={isExporting}
          onChange={(event) => {
            const padding = Number(event.currentTarget.value);
            setScenePadding(padding);
            void exportFrame("scene", padding);
          }}
        >
          {[0, 10, 16, 32, 64, 128].map((padding) => <option key={padding} value={padding}>{padding}px</option>)}
        </select>
      </label>
      <span className="text-[9px] text-[#65716b]">{isExporting ? "Updating preview…" : "Transparent space around the scene"}</span>
    </>
  ) : null;

  return (
    <div
      className="spatializer-root"
      ref={rootRef}
      data-exploded={explosion > 0 ? "true" : "false"}
      data-scrubbing-explosion={isScrubbingExplosion ? "true" : "false"}
    >
      <header className="spatializer-toolbar" data-spatializer-ignore="">
        <div className="flex shrink-0 items-center gap-3 border-e border-white/10 pe-4">
          <div className="spatializer-brand"><span>TORETTO</span><small>{nodeCount} live DOM elements</small></div>
          <button type="button" className={SOURCE_BUTTON} onClick={onOpenSource}>Source…</button>
          <button type="button" className={`${TOOLBAR_BUTTON} text-[#c7f4e2]`} onClick={() => void openExport()}>Export…</button>
        </div>
        <label className="spatializer-range">
          <span>Explosion <output>{explosion}%</output></span>
          <input type="range" min="0" max="10000" step="5" value={explosion} onInput={handleExplosionInput} />
        </label>
        <label className="spatializer-range spatializer-lens">
          <span>Lens <output>{perspective}px</output></span>
          <input type="range" min="1600" max="12000" step="100" value={perspective} onInput={(event) => setPerspective(Number(event.currentTarget.value))} />
        </label>
        <div className="spatializer-actions flex flex-nowrap justify-end gap-1">
          <div className="inline-flex overflow-hidden rounded-md border border-white/10" role="group" aria-label="Navigation mode">
            <button type="button" className={`${MODE_BUTTON} ${effectiveMode !== "pan" ? TOOLBAR_ACTIVE : ""}`} aria-pressed={effectiveMode !== "pan"} onClick={() => setMode("orbit")}>Orbit</button>
            <button type="button" className={`${MODE_BUTTON} border-s border-white/10 ${effectiveMode === "pan" ? TOOLBAR_ACTIVE : ""}`} aria-pressed={effectiveMode === "pan"} onClick={() => setMode("pan")}>Pan</button>
          </div>
          <button type="button" className={TOOLBAR_BUTTON} onClick={() => setExplosion(1000)}>Explode ×10</button>
          <button type="button" className={TOOLBAR_BUTTON} onClick={() => { setPitch(3); setYaw(-28); setRoll(0); }}>Isometric</button>
          <button type="button" className={TOOLBAR_BUTTON} onClick={fitView}>Fit</button>
          <button type="button" className={TOOLBAR_BUTTON} onClick={flatten}>Flat</button>
          <button type="button" className={TOOLBAR_BUTTON} onClick={reset}>Reset</button>
          <button type="button" className={TOOLBAR_BUTTON} onClick={() => void toggleFullscreen()}>{isFullscreen ? "Exit full screen" : "Full screen"}</button>
        </div>
      </header>
      <main
        className={`spatializer-camera mode-${effectiveMode}`}
        ref={cameraRef}
        style={{ perspective: `${safePerspective}px` }}
        tabIndex={0}
        aria-label="Spatial canvas. Drag to orbit or pan, use the wheel to zoom, and arrow keys to move."
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onContextMenu={(event) => event.preventDefault()}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
      >
        <div className="spatializer-grid" data-export-ignore="" aria-hidden="true" />
        <div className="spatializer-stage" style={{ transform: stageTransform }}>
          <div className="spatializer-specimen" ref={specimenRef}>
            <div className="spatializer-app-host">{children}</div>
          </div>
        </div>
        <div className="spatializer-hint" data-spatializer-ignore="" data-export-ignore="">
          {effectiveMode === "orbit"
            ? "Drag to orbit · Shift: pan · Option: roll"
            : effectiveMode === "roll"
              ? "Option-drag to roll · Release Option to orbit"
            : mode === "pan"
              ? "Drag to pan · Wheel to zoom"
              : "Release Shift to orbit · Wheel to zoom"}
        </div>
      </main>
      {exportOpen && <div className="fixed inset-0 z-[1000] grid place-items-center bg-[#040706]/80 p-6 backdrop-blur-xl" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && closeExport()}><section className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#151a18] text-[#e9efec] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="export-title"><header className="flex items-start justify-between border-b border-white/10 px-5 py-4"><div><span className="font-mono text-[9px] font-bold tracking-[0.12em] text-[#65dcae] uppercase">Frame export</span><h2 className="mt-1 text-base font-semibold" id="export-title">Export transparent PNG</h2></div><button type="button" className="p-1 text-xl leading-none text-[#7e8984] hover:text-white" onClick={closeExport} aria-label="Close">×</button></header>{pendingExport ? <div className="grid gap-4 p-5"><ExportPreview key={`bounded-${pendingExport.url}`} src={pendingExport.url} alt="Final transparent PNG preview" footer={exportPreviewFooter} /><div className="grid gap-1"><strong className="text-xs font-semibold">{pendingExport.scope === "scene" ? "Entire scene" : "Viewport frame"} ready</strong>{didSaveExport ? <a className="w-fit max-w-full truncate font-mono text-[10px] text-[#75e5b9] underline decoration-[#75e5b9]/40 underline-offset-2 hover:text-[#a2f3d3]" href={pendingExport.url} target="_blank" rel="noreferrer" title="Open the exported PNG">{pendingExport.filename} ↗</a> : <span className="truncate font-mono text-[10px] text-[#718079]">{pendingExport.filename}</span>}<span className="text-[10px] text-[#718079]">{pendingExport.width} × {pendingExport.height}px · {pendingExport.pixelRatio.toFixed(2)}× · transparent PNG</span>{exportStatus && <span className="mt-1 text-[10px] text-[#aab5b0]" role="status">{exportStatus}</span>}</div></div> : <div className="grid gap-4 p-5"><p className="m-0 text-[11px] leading-5 text-[#7e8984]">Choose whether to preserve the visible camera crop or include every projected DOM layer. Both exports omit Toretto's canvas grid and use a transparent background.</p><div className="grid grid-cols-2 gap-3">{["viewport", "scene"].map((scope) => { const preview = exportPreviews[scope]; const selected = exportScope === scope; return <button type="button" key={scope} className={`overflow-hidden rounded-xl border text-start transition-colors ${selected ? "border-[#66e4b3]/60 bg-[#66e4b3]/[0.06]" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"}`} aria-pressed={selected} onClick={() => setExportScope(scope)}><div className="flex h-40 items-center justify-center overflow-hidden border-b border-white/10 bg-[linear-gradient(45deg,#252b28_25%,transparent_25%),linear-gradient(-45deg,#252b28_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#252b28_75%),linear-gradient(-45deg,transparent_75%,#252b28_75%)] bg-[length:14px_14px] bg-[position:0_0,0_7px,7px_-7px,-7px_0px]">{preview?.url ? <img className="block h-full w-full object-contain object-center" src={preview.url} alt={`${scope} export preview`} /> : <span className="text-[10px] text-[#66716c]">{preview?.error || (isPreviewingExport ? "Rendering preview…" : "Preview unavailable")}</span>}</div><div className="grid gap-1 p-3"><strong className="text-[11px] font-semibold text-[#e4ebe8]">{scope === "viewport" ? "Viewport frame" : "Entire scene"}</strong><span className="text-[9px] leading-4 text-[#718079]">{scope === "viewport" ? "Exact visible canvas crop" : "Every projected layer, unclipped"}</span>{preview?.captureWidth && <span className="font-mono text-[9px] text-[#5f6c66]">{preview.captureWidth} × {preview.captureHeight} CSS px</span>}</div></button>; })}</div>{exportStatus && <p className="m-0 text-[10px] text-[#ffaaa5]" role="alert">{exportStatus}</p>}</div>}<footer className="flex items-center justify-between border-t border-white/10 px-5 py-3"><span className="text-[9px] text-[#68746e]">PNG · transparent · up to 4× · 16,384px max</span><div className="flex gap-2">{pendingExport ? <><button type="button" className="h-8 rounded-md border border-white/10 px-3 text-[11px] font-medium text-[#9ca5a3] hover:bg-white/[0.06]" onClick={backToExportOptions}>Back</button><button type="button" className="h-8 rounded-md border border-[#66e4b3] bg-[#66e4b3] px-3 text-[11px] font-semibold text-[#102019] hover:bg-[#8aefc8]" onClick={() => void saveExport()}>Save PNG…</button></> : <><button type="button" className="h-8 rounded-md border border-white/10 px-3 text-[11px] font-medium text-[#9ca5a3] hover:bg-white/[0.06]" onClick={closeExport}>Cancel</button><button type="button" className="h-8 rounded-md border border-[#66e4b3] bg-[#66e4b3] px-3 text-[11px] font-semibold text-[#102019] hover:bg-[#8aefc8] disabled:opacity-50" disabled={isPreviewingExport || isExporting} onClick={() => void exportFrame(exportScope)}>{isExporting ? "Rendering…" : "Preview…"}</button></>}</div></footer></section></div>}
    </div>
  );
}
