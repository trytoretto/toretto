import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const APP_WIDTH = 1440;
const APP_HEIGHT = 900;
const SURFACE_TAGS = new Set(["MAIN", "HEADER", "ASIDE", "NAV", "SECTION", "ARTICLE", "BUTTON", "DIALOG"]);

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
  const [nodeCount, setNodeCount] = useState(0);
  explosionRef.current = explosion;

  const fitView = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera) return;
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

  useEffect(() => () => window.clearTimeout(scrubTimerRef.current), []);

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

  return (
    <div
      className="spatializer-root"
      ref={rootRef}
      data-exploded={explosion > 0 ? "true" : "false"}
      data-scrubbing-explosion={isScrubbingExplosion ? "true" : "false"}
    >
      <header className="spatializer-toolbar" data-spatializer-ignore="">
        <div className="spatializer-brand"><span>TORETTO</span><small>{nodeCount} live DOM elements</small></div>
        <label className="spatializer-range">
          <span>Explosion <output>{explosion}%</output></span>
          <input type="range" min="0" max="10000" step="5" value={explosion} onInput={handleExplosionInput} />
        </label>
        <label className="spatializer-range spatializer-lens">
          <span>Lens <output>{perspective}px</output></span>
          <input type="range" min="1600" max="12000" step="100" value={perspective} onInput={(event) => setPerspective(Number(event.currentTarget.value))} />
        </label>
        <div className="spatializer-actions">
          <button type="button" className="spatializer-primary" onClick={onOpenSource}>Source…</button>
          <div className="spatializer-mode-group" role="group" aria-label="Navigation mode">
            <button type="button" className={effectiveMode !== "pan" ? "active" : ""} aria-pressed={effectiveMode !== "pan"} onClick={() => setMode("orbit")}>Orbit</button>
            <button type="button" className={effectiveMode === "pan" ? "active" : ""} aria-pressed={effectiveMode === "pan"} onClick={() => setMode("pan")}>Pan</button>
          </div>
          <button type="button" onClick={() => setExplosion(1000)}>Explode ×10</button>
          <button type="button" onClick={() => { setPitch(3); setYaw(-28); setRoll(0); }}>Isometric</button>
          <button type="button" onClick={fitView}>Fit</button>
          <button type="button" onClick={flatten}>Flat</button>
          <button type="button" onClick={reset}>Reset</button>
          <button type="button" onClick={() => void toggleFullscreen()}>{isFullscreen ? "Exit full screen" : "Full screen"}</button>
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
        <div className="spatializer-grid" aria-hidden="true" />
        <div className="spatializer-stage" style={{ transform: stageTransform }}>
          <div className="spatializer-specimen" ref={specimenRef}>
            <div className="spatializer-app-host">{children}</div>
          </div>
        </div>
        <div className="spatializer-hint" data-spatializer-ignore="">
          {effectiveMode === "orbit"
            ? "Drag to orbit · Shift: pan · Option: roll"
            : effectiveMode === "roll"
              ? "Option-drag to roll · Release Option to orbit"
            : mode === "pan"
              ? "Drag to pan · Wheel to zoom"
              : "Release Shift to orbit · Wheel to zoom"}
        </div>
      </main>
    </div>
  );
}
