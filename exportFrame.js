import { toBlob } from "html-to-image";

const MAX_SCALE = 4;
const MAX_DIMENSION = 16384;
const MAX_PIXELS = 120_000_000;
const DEFAULT_SCENE_PADDING = 10;
const captureLocks = new WeakMap();
let sceneCaptureId = 0;

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

async function freezeCamera(camera) {
  let lock = captureLocks.get(camera);
  if (!lock) {
    const animations = camera.getAnimations({ subtree: true });
    lock = {
      count: 0,
      animations: animations.map((animation) => ({
        animation,
        wasRunning: animation.playState === "running",
      })),
    };
    captureLocks.set(camera, lock);
    camera.dataset.exportFreeze = "";
    lock.animations.forEach(({ animation }) => animation.pause());
  }
  lock.count += 1;
  await nextPaint();

  return () => {
    lock.count -= 1;
    if (lock.count > 0) return;
    delete camera.dataset.exportFreeze;
    lock.animations.forEach(({ animation, wasRunning }) => {
      if (wasRunning && animation.playState === "paused") animation.play();
    });
    captureLocks.delete(camera);
  };
}

function exportScale(width, height, maximum = MAX_SCALE) {
  return Math.min(
    maximum,
    MAX_DIMENSION / width,
    MAX_DIMENSION / height,
    Math.sqrt(MAX_PIXELS / (width * height)),
  );
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

export function measureProjectedSceneBounds(camera) {
  const cameraRect = camera.getBoundingClientRect();
  const rectangles = [...camera.querySelectorAll(".spatializer-specimen [data-spatial-node]")]
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => (
      rect.width > 0
      && rect.height > 0
      && [rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)
    ));

  if (!rectangles.length) throw new Error("No visible DOM layers were found to export.");

  return rectangles.reduce((bounds, rect) => ({
    left: Math.min(bounds.left, rect.left - cameraRect.left),
    top: Math.min(bounds.top, rect.top - cameraRect.top),
    right: Math.max(bounds.right, rect.right - cameraRect.left),
    bottom: Math.max(bounds.bottom, rect.bottom - cameraRect.top),
  }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
}

function createSceneCapture(camera, padding) {
  const bounds = measureProjectedSceneBounds(camera);
  const width = Math.ceil(bounds.right - bounds.left + padding * 2);
  const height = Math.ceil(bounds.bottom - bounds.top + padding * 2);
  if (width > 100_000 || height > 100_000) {
    throw new Error("The projected scene is too large to encode as one PNG. Reduce explosion or zoom out first.");
  }

  const stage = camera.querySelector(".spatializer-stage");
  if (!stage) throw new Error("The spatial stage could not be prepared for export.");

  const originalCameraWidth = camera.clientWidth;
  const originalCameraHeight = camera.clientHeight;
  const cameraStyleText = camera.getAttribute("style");
  const stageStyleText = stage.getAttribute("style");
  const cameraStyle = getComputedStyle(camera);
  const [originX, originY] = cameraStyle.perspectiveOrigin.split(" ").map(Number.parseFloat);

  const captureId = String(++sceneCaptureId);
  camera.dataset.exportScene = captureId;
  Object.assign(camera.style, {
    position: "fixed",
    left: "0",
    top: "0",
    zIndex: "-2147483647",
    pointerEvents: "none",
    width: `${width}px`,
    height: `${height}px`,
    overflow: "hidden",
    background: "transparent",
    backgroundColor: "transparent",
    boxShadow: "none",
    perspective: cameraStyle.perspective,
    perspectiveOrigin: `${originX - bounds.left + padding}px ${originY - bounds.top + padding}px`,
  });
  stage.style.left = `${originalCameraWidth / 2 - bounds.left + padding}px`;
  stage.style.top = `${originalCameraHeight / 2 - bounds.top + padding}px`;

  return {
    node: camera,
    width,
    height,
    cleanup: () => {
      if (cameraStyleText === null) camera.removeAttribute("style");
      else camera.setAttribute("style", cameraStyleText);
      if (stageStyleText === null) stage.removeAttribute("style");
      else stage.setAttribute("style", stageStyleText);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (camera.dataset.exportScene === captureId) delete camera.dataset.exportScene;
      }));
    },
  };
}

function createViewportCapture(camera) {
  return {
    node: camera,
    width: camera.clientWidth,
    height: camera.clientHeight,
    cleanup: () => {},
  };
}

async function renderTransparentPng(camera, scope, preview, options = {}) {
  const releaseFrame = await freezeCamera(camera);
  let capture;
  const scenePadding = Math.max(0, Number(options.scenePadding ?? DEFAULT_SCENE_PADDING));

  try {
    capture = scope === "scene" ? createSceneCapture(camera, scenePadding) : createViewportCapture(camera);
    const { node, width, height } = capture;
    if (!width || !height) throw new Error("The canvas has no visible area to export.");

    const previewScale = Math.min(1, 480 / width, 280 / height);
    const requestedRatio = Number(options.pixelRatio);
    const pixelRatio = preview
      ? previewScale
      : Number.isFinite(requestedRatio) && requestedRatio > 0
        ? Math.min(requestedRatio, exportScale(width, height))
        : exportScale(width, height);
    const outputWidth = Math.round(width * pixelRatio);
    const outputHeight = Math.round(height * pixelRatio);
    let blob;
    try {
      blob = await toBlob(node, {
        width,
        height,
        pixelRatio,
        backgroundColor: "transparent",
        cacheBust: true,
        filter: (candidate) => !(
          candidate instanceof Element
          && candidate.hasAttribute("data-export-ignore")
        ),
        style: {
          background: "transparent",
          backgroundColor: "transparent",
          boxShadow: "none",
        },
      });
    } catch (error) {
      if (error instanceof Error) throw error;
      const failedSource = error?.target?.currentSrc || error?.target?.src;
      throw new Error(failedSource ? `An image could not be prepared for export: ${failedSource}` : String(error || "The frame could not be rendered."));
    }

    if (!blob) throw new Error("The browser could not encode this frame as PNG.");

    const filenameScope = scope === "viewport" ? "canvas" : scope;
    const filename = preview ? "" : `toretto-${filenameScope}-${timestamp()}-${pixelRatio.toFixed(2)}x.png`;
    return { blob, filename, width: outputWidth, height: outputHeight, captureWidth: width, captureHeight: height, pixelRatio, scope, scenePadding };
  } finally {
    capture?.cleanup();
    releaseFrame();
  }
}

export function renderPngPreview(camera, scope, options) {
  return renderTransparentPng(camera, scope, true, options);
}

export function exportTransparentPng(camera, scope = "viewport", options) {
  return renderTransparentPng(camera, scope, false, options);
}
