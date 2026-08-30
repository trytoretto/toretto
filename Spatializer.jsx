import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { exportTransparentPng, measureProjectedSceneBounds, renderPngPreview } from "./exportFrame";
import { ExportPreview } from "./ExportPreview";
import torettoMarkUrl from "./toretto-mark.svg";

const APP_WIDTH = 1440;
const APP_HEIGHT = 900;
const EXPLOSION_CONTROL_MIN = -1000;
const EXPLOSION_CONTROL_MAX = 1000;
const EXPLOSION_DEPTH_MAX = 10000;
const EXPLOSION_CURVE = 2.4;
const EXPLOSION_LINEARITY = 0.3;
const ZOOM_CONTROL_MIN = -2500;
const ZOOM_CONTROL_MAX = 2500;
const ZOOM_OUT_PER_1000 = 0.12;
const ZOOM_IN_PER_1000 = 4;
const ZOOM_MIN = ZOOM_OUT_PER_1000 ** 2.5;
const ZOOM_MAX = ZOOM_IN_PER_1000 ** 2.5;
const LENS_CONTROL_MIN = -500;
const LENS_CONTROL_MAX = 500;
const LENS_CONTROL_EXTENT = LENS_CONTROL_MAX - LENS_CONTROL_MIN;
const LENS_MIN = 1600;
const LENS_MAX = 12000;
const LENS_DEFAULT = Math.sqrt(LENS_MIN * LENS_MAX);
const VANISHING_CONTROL_MIN = -1000;
const VANISHING_CONTROL_MAX = 1000;
const VANISHING_ORIGIN_RANGE = 100;
const DEFAULT_SCENE_TRANSFORM = Object.freeze({
  position: Object.freeze({ x: 0, y: 0, z: 0 }),
  rotation: Object.freeze({ x: 0, y: 0, z: 0 }),
  scale: 100,
  skew: Object.freeze({ x: 0, y: 0 }),
});
const DEFAULT_EXPLOSION_FIELD = Object.freeze({
  direction: Object.freeze({ x: 0, y: 0, z: 100 }),
  rotation: Object.freeze({ x: 0, y: 0, z: 0 }),
  spread: 0,
  twist: 0,
  scale: 0,
  curve: 100,
});
const BIPOLAR_DEADZONE_PX = 2;
const EXPLOSION_TRANSITION_MS = 420;
const FLAT_SETTLE_BUFFER_MS = 80;
const RANGE_THUMB_SIZE = 14;
const FIT_MARGIN = 32;
const FIT_MAX_PASSES = 10;
const CAMERA_NEAR_CLIP_RATIO = 0.96;
const DEFAULT_TIMELINE_DURATION = 5;
const SURFACE_TAGS = new Set(["MAIN", "HEADER", "ASIDE", "NAV", "SECTION", "ARTICLE", "BUTTON", "DIALOG"]);
const TOOLBAR_BUTTON = "h-7 cursor-pointer whitespace-nowrap rounded-md border border-white/10 bg-white/[0.035] px-2.5 text-[11px] font-medium leading-none text-[#9ca5a3] transition-colors hover:bg-white/[0.07] hover:text-[#f2f5f4]";
const TOOLBAR_ACTIVE = "relative z-[1] !bg-[#66e4b3]/10 !text-[#dff9ee]";
const MODE_BUTTON = "h-7 cursor-pointer bg-white/[0.035] px-2.5 text-[11px] font-medium leading-none text-[#9ca5a3] transition-colors hover:bg-white/[0.07] hover:text-[#f2f5f4]";
const SOURCE_BUTTON = "h-7 cursor-pointer whitespace-nowrap rounded-md border border-[#66e4b3] bg-[#66e4b3] px-2.5 text-[11px] font-semibold leading-none text-[#102019] transition-colors hover:border-[#8aefc8] hover:bg-[#8aefc8]";
const IDENTITY_ORIENTATION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });
const AXIS_VECTORS = Object.freeze({
  x: Object.freeze({ x: 1, y: 0, z: 0 }),
  y: Object.freeze({ x: 0, y: -1, z: 0 }),
  z: Object.freeze({ x: 0, y: 0, z: 1 }),
});
const ROTATION_AXES = Object.freeze({
  x: Object.freeze({ x: 1, y: 0, z: 0 }),
  y: Object.freeze({ x: 0, y: 1, z: 0 }),
  z: Object.freeze({ x: 0, y: 0, z: 1 }),
});

function wrapAngle(angle) {
  return ((angle + 180) % 360 + 360) % 360 - 180;
}

function normalizeQuaternion(quaternion) {
  const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  if (!Number.isFinite(length) || length < 0.00000001) return { ...IDENTITY_ORIENTATION };
  return {
    x: quaternion.x / length,
    y: quaternion.y / length,
    z: quaternion.z / length,
    w: quaternion.w / length,
  };
}

function multiplyQuaternions(left, right) {
  return normalizeQuaternion({
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
  });
}

function axisAngleQuaternion(axis, degrees) {
  const axisLength = Math.hypot(axis.x, axis.y, axis.z) || 1;
  const radians = degrees * Math.PI / 180 / 2;
  const sine = Math.sin(radians);
  return normalizeQuaternion({
    x: axis.x / axisLength * sine,
    y: axis.y / axisLength * sine,
    z: axis.z / axisLength * sine,
    w: Math.cos(radians),
  });
}

function invertQuaternion(quaternion) {
  return { x: -quaternion.x, y: -quaternion.y, z: -quaternion.z, w: quaternion.w };
}

function rotateVector(quaternion, vector) {
  const normalized = normalizeQuaternion(quaternion);
  const { x, y, z, w } = normalized;
  const tx = 2 * (y * vector.z - z * vector.y);
  const ty = 2 * (z * vector.x - x * vector.z);
  const tz = 2 * (x * vector.y - y * vector.x);
  return {
    x: vector.x + w * tx + (y * tz - z * ty),
    y: vector.y + w * ty + (z * tx - x * tz),
    z: vector.z + w * tz + (x * ty - y * tx),
  };
}

function quaternionBetween(from, to) {
  const dot = Math.max(-1, Math.min(1, from.x * to.x + from.y * to.y + from.z * to.z));
  if (dot < -0.999999) {
    const helper = Math.abs(from.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const axis = {
      x: from.y * helper.z - from.z * helper.y,
      y: from.z * helper.x - from.x * helper.z,
      z: from.x * helper.y - from.y * helper.x,
    };
    return axisAngleQuaternion(axis, 180);
  }
  return normalizeQuaternion({
    x: from.y * to.z - from.z * to.y,
    y: from.z * to.x - from.x * to.z,
    z: from.x * to.y - from.y * to.x,
    w: 1 + dot,
  });
}

function quaternionMatrix(quaternion) {
  const { x, y, z, w } = normalizeQuaternion(quaternion);
  return `matrix3d(${[
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    0, 0, 0, 1,
  ].join(",")})`;
}

function quaternionFromEuler({ x, y, z }) {
  return multiplyQuaternions(
    axisAngleQuaternion(ROTATION_AXES.z, z),
    multiplyQuaternions(
      axisAngleQuaternion(ROTATION_AXES.y, y),
      axisAngleQuaternion(ROTATION_AXES.x, x),
    ),
  );
}

function quaternionToEuler(quaternion) {
  const { x, y, z, w } = normalizeQuaternion(quaternion);
  const pitchX = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const sinY = Math.max(-1, Math.min(1, 2 * (w * y - z * x)));
  const yawY = Math.asin(sinY);
  const rollZ = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  return {
    x: wrapAngle(pitchX * 180 / Math.PI),
    y: wrapAngle(yawY * 180 / Math.PI),
    z: wrapAngle(rollZ * 180 / Math.PI),
  };
}

function quaternionAxisAngle(quaternion) {
  const normalized = normalizeQuaternion(quaternion);
  const angle = 2 * Math.acos(Math.max(-1, Math.min(1, normalized.w)));
  const sine = Math.sqrt(Math.max(0, 1 - normalized.w * normalized.w));
  if (sine < 0.00001 || angle < 0.00001) return { x: 0, y: 0, z: 1, degrees: 0 };
  return {
    x: normalized.x / sine,
    y: normalized.y / sine,
    z: normalized.z / sine,
    degrees: angle * 180 / Math.PI,
  };
}

function explosionDepth(control) {
  const position = Math.max(EXPLOSION_CONTROL_MIN, Math.min(EXPLOSION_CONTROL_MAX, control));
  const progress = Math.abs(position) / EXPLOSION_CONTROL_MAX;
  const curvedProgress = (
    EXPLOSION_LINEARITY * progress
    + (1 - EXPLOSION_LINEARITY) * progress ** EXPLOSION_CURVE
  );
  return Math.sign(position) * EXPLOSION_DEPTH_MAX * curvedProgress;
}

function explosionControl(depth) {
  const progress = Math.min(1, Math.abs(depth) / EXPLOSION_DEPTH_MAX);
  return Math.round(Math.sign(depth) * EXPLOSION_CONTROL_MAX * progress ** (1 / EXPLOSION_CURVE));
}

function zoomFromControl(control) {
  const position = Math.max(ZOOM_CONTROL_MIN, Math.min(ZOOM_CONTROL_MAX, control));
  return position < 0
    ? ZOOM_OUT_PER_1000 ** (-position / 1000)
    : ZOOM_IN_PER_1000 ** (position / 1000);
}

function zoomControl(zoom) {
  return Math.round(zoom < 1
    ? -1000 * Math.log(zoom) / Math.log(ZOOM_OUT_PER_1000)
    : 1000 * Math.log(zoom) / Math.log(ZOOM_IN_PER_1000));
}

function lensFromControl(control) {
  const position = Math.max(LENS_CONTROL_MIN, Math.min(LENS_CONTROL_MAX, control));
  const strength = position - LENS_CONTROL_MIN;
  return strength === 0
    ? 0
    : LENS_MAX * (LENS_MIN / LENS_MAX) ** (strength / LENS_CONTROL_EXTENT);
}

function lensControl(perspective) {
  return perspective <= 0
    ? LENS_CONTROL_MIN
    : LENS_CONTROL_MIN + Math.round(
      LENS_CONTROL_EXTENT * Math.log(perspective / LENS_MAX) / Math.log(LENS_MIN / LENS_MAX),
    );
}

function bipolarRangeStyle(position, extent = 1000) {
  const edge = 50 + Math.max(-1, Math.min(1, position / extent)) * 50;
  return {
    "--range-fill-start": `${Math.min(50, edge)}%`,
    "--range-fill-end": `${Math.max(50, edge)}%`,
  };
}

function unipolarRangeStyle(position, extent = 1000) {
  return { "--range-fill-end": `${Math.max(0, Math.min(1, position / extent)) * 100}%` };
}

function centeredRangeStyle(value, min, max, origin = 0) {
  const percent = (position) => Math.max(0, Math.min(100, (position - min) / (max - min) * 100));
  const valuePercent = percent(value);
  const originPercent = percent(origin);
  return {
    "--range-fill-start": `${Math.min(valuePercent, originPercent)}%`,
    "--range-fill-end": `${Math.max(valuePercent, originPercent)}%`,
  };
}

function interpolateValue(from, to, progress) {
  if (typeof from === "number" && typeof to === "number") return from + (to - from) * progress;
  if (from && to && typeof from === "object" && typeof to === "object") {
    return Object.fromEntries(Object.keys(from).map((key) => [
      key,
      interpolateValue(from[key], to[key], progress),
    ]));
  }
  return progress < 0.5 ? from : to;
}

function evaluateKeyframes(keyframes, time) {
  if (!keyframes.length) return null;
  const before = [...keyframes].reverse().find((frame) => frame.time <= time) || keyframes[0];
  const after = keyframes.find((frame) => frame.time >= time) || keyframes[keyframes.length - 1];
  if (before === after || after.time === before.time) return before.state;
  const progress = Math.max(0, Math.min(1, (time - before.time) / (after.time - before.time)));
  const state = interpolateValue(before.state, after.state, progress);
  state.orientation = normalizeQuaternion(state.orientation);
  return state;
}

function outsideBipolarDeadzone(position, trackWidth, extent = 1000) {
  const unitsPerPixel = trackWidth > 0 ? extent * 2 / trackWidth : 0;
  const deadzone = BIPOLAR_DEADZONE_PX * unitsPerPixel;
  const magnitude = Math.abs(position);
  if (magnitude <= deadzone) return 0;
  return Math.sign(position) * Math.round(
    (magnitude - deadzone) * extent / (extent - deadzone),
  );
}

function handleRangeKey(event, value, min, max, onChange) {
  const direction = {
    ArrowLeft: -1,
    ArrowDown: -1,
    ArrowRight: 1,
    ArrowUp: 1,
  }[event.key];
  if (!direction) return;
  event.preventDefault();
  const step = event.shiftKey ? 10 : 1;
  onChange(Math.max(min, Math.min(max, value + direction * step)));
}

function nextPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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

function RangeValueInput({ value, onCommit, label, min = -1000, max = 1000 }) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const next = Math.max(min, Math.min(max, Math.round(parsed)));
    setDraft(String(next));
    onCommit(next);
  };

  return (
    <input
      className="spatializer-value-input"
      type="number"
      min={min}
      max={max}
      step="1"
      value={draft}
      aria-label={label}
      onChange={(event) => {
        const nextDraft = event.currentTarget.value;
        setDraft(nextDraft);
        if (nextDraft.trim() === "" || nextDraft === "-" || nextDraft === "+") return;
        const parsed = Number(nextDraft);
        if (Number.isFinite(parsed) && parsed >= min && parsed <= max) {
          onCommit(Math.round(parsed));
        }
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(String(value));
          event.preventDefault();
        }
      }}
    />
  );
}

function DecimalValueInput({ value, onCommit, label }) {
  const formattedValue = Number(value.toFixed(4));
  const [draft, setDraft] = useState(String(formattedValue));

  useEffect(() => setDraft(String(formattedValue)), [formattedValue]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(formattedValue));
      return;
    }
    onCommit(parsed);
  };

  return (
    <input
      className="spatializer-orientation-input"
      type="number"
      step="0.0001"
      value={draft}
      aria-label={label}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(String(formattedValue));
          event.preventDefault();
        }
      }}
    />
  );
}

function TimelineValueInput({ value, onCommit, label, min, max, step }) {
  const formattedValue = Number(value.toFixed(2));
  const [draft, setDraft] = useState(String(formattedValue));

  useEffect(() => setDraft(String(formattedValue)), [formattedValue]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(String(formattedValue));
      return;
    }
    const next = Math.max(min, Math.min(max, parsed));
    setDraft(String(Number(next.toFixed(2))));
    onCommit(next);
  };

  return <input
    type="number"
    min={min}
    max={max}
    step={step}
    value={draft}
    aria-label={label}
    onChange={(event) => setDraft(event.currentTarget.value)}
    onBlur={commit}
    onKeyDown={(event) => {
      if (event.key === "Enter") event.currentTarget.blur();
      if (event.key === "Escape") {
        setDraft(String(formattedValue));
        event.preventDefault();
      }
    }}
  />;
}

export function Spatializer({ children, contentKey, onOpenSource }) {
  const rootRef = useRef(null);
  const cameraRef = useRef(null);
  const specimenRef = useRef(null);
  const nodesRef = useRef([]);
  const nodeStyleCacheRef = useRef(new WeakMap());
  const dragRef = useRef(null);
  const gizmoDragRef = useRef(null);
  const rangeDragRef = useRef(null);
  const panRef = useRef({ x: 0, y: 0 });
  const zoomRef = useRef(1);
  const resizeRef = useRef(null);
  const mutationFrameRef = useRef(0);
  const updateNodeDepthRef = useRef(() => {});
  const flattenTimerRef = useRef(0);
  const exportTimerRef = useRef(0);
  const exportUrlRef = useRef("");
  const exportPreviewUrlsRef = useRef([]);
  const previewGenerationRef = useRef(0);
  const framingOperationRef = useRef(0);
  const animationFrameRef = useRef(0);
  const playbackStartedRef = useRef(0);
  const playbackLaunchRef = useRef(0);
  const timelineMarkersRef = useRef(null);
  const keyframeDragRef = useRef(null);
  const keyframeIdRef = useRef(0);
  const explosionRef = useRef(0);
  const explosionPositionRef = useRef(0);
  const [explosionPosition, setExplosionPosition] = useState(0);
  const [perspective, setPerspective] = useState(LENS_DEFAULT);
  const [vanishingPoint, setVanishingPoint] = useState({ x: 0, y: 0 });
  const [sceneTransform, setSceneTransform] = useState(DEFAULT_SCENE_TRANSFORM);
  const [explosionField, setExplosionField] = useState(DEFAULT_EXPLOSION_FIELD);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [timelineDuration, setTimelineDuration] = useState(DEFAULT_TIMELINE_DURATION);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [keyframes, setKeyframes] = useState([]);
  const [selectedKeyframeId, setSelectedKeyframeId] = useState("baseline");
  const [mode, setMode] = useState("orbit");
  const [orientation, setOrientation] = useState(IDENTITY_ORIENTATION);
  const [orientationInspectorOpen, setOrientationInspectorOpen] = useState(false);
  const [orientationStatus, setOrientationStatus] = useState("");
  const [isFraming, setIsFraming] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [fitScale, setFitScale] = useState(0.7);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isExplosionImmediate, setIsExplosionImmediate] = useState(true);
  const [isSettlingFlat, setIsSettlingFlat] = useState(false);
  const [isControlHeld, setIsControlHeld] = useState(false);
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
  const explosion = explosionDepth(explosionPosition);
  explosionRef.current = explosion;
  panRef.current = pan;
  zoomRef.current = zoom;

  const cancelFraming = useCallback(() => {
    framingOperationRef.current += 1;
    setIsFraming(false);
  }, []);

  const applyExplosionPosition = useCallback((nextPosition, immediate = false) => {
    cancelFraming();
    const next = Math.max(EXPLOSION_CONTROL_MIN, Math.min(EXPLOSION_CONTROL_MAX, nextPosition));
    const previous = explosionPositionRef.current;
    const shouldSnap = immediate || (Math.abs(previous) <= 1 && Math.abs(next) <= 1);
    window.clearTimeout(flattenTimerRef.current);
    setIsExplosionImmediate(shouldSnap);
    if (next === 0 && previous !== 0 && !shouldSnap) {
      setIsSettlingFlat(true);
      flattenTimerRef.current = window.setTimeout(
        () => setIsSettlingFlat(false),
        EXPLOSION_TRANSITION_MS + FLAT_SETTLE_BUFFER_MS,
      );
    } else {
      setIsSettlingFlat(false);
    }
    explosionPositionRef.current = next;
    setExplosionPosition(next);
  }, [cancelFraming]);

  const fitBaseView = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera || camera.hasAttribute("data-export-scene")) return;
    cancelFraming();
    const next = Math.min((camera.clientWidth - 24) / APP_WIDTH, (camera.clientHeight - 24) / APP_HEIGHT);
    zoomRef.current = 1;
    panRef.current = { x: 0, y: 0 };
    setFitScale(Math.max(0.2, next));
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [cancelFraming]);

  const centerView = useCallback(async () => {
    const camera = cameraRef.current;
    if (!camera || camera.hasAttribute("data-export-scene")) return;
    const operation = framingOperationRef.current + 1;
    framingOperationRef.current = operation;
    setIsFraming(true);
    try {
      for (let pass = 0; pass < FIT_MAX_PASSES; pass += 1) {
        await nextPaint();
        if (operation !== framingOperationRef.current
          || camera !== cameraRef.current
          || camera.hasAttribute("data-export-scene")) return;
        const viewport = specimenRef.current;
        if (!viewport) return;
        const cameraRect = camera.getBoundingClientRect();
        const viewportRect = viewport.getBoundingClientRect();
        if (!(viewportRect.width > 0 && viewportRect.height > 0)) return;
        const deltaX = (cameraRect.left + cameraRect.right - viewportRect.left - viewportRect.right) / 2;
        const deltaY = (cameraRect.top + cameraRect.bottom - viewportRect.top - viewportRect.bottom) / 2;
        if (Math.abs(deltaX) < 0.75 && Math.abs(deltaY) < 0.75) break;
        const nextPan = { x: panRef.current.x + deltaX, y: panRef.current.y + deltaY };
        panRef.current = nextPan;
        setPan(nextPan);
      }
    } finally {
      if (operation === framingOperationRef.current) setIsFraming(false);
    }
  }, []);

  const fitScene = useCallback(async () => {
    const camera = cameraRef.current;
    if (!camera || camera.hasAttribute("data-export-scene")) return;
    const operation = framingOperationRef.current + 1;
    framingOperationRef.current = operation;
    setIsFraming(true);
    try {
      for (let pass = 0; pass < FIT_MAX_PASSES; pass += 1) {
        await nextPaint();
        if (operation !== framingOperationRef.current
          || camera !== cameraRef.current
          || camera.hasAttribute("data-export-scene")) return;
        let bounds;
        try {
          bounds = measureProjectedSceneBounds(camera);
        } catch {
          return;
        }
        const availableWidth = Math.max(1, camera.clientWidth - FIT_MARGIN * 2);
        const availableHeight = Math.max(1, camera.clientHeight - FIT_MARGIN * 2);
        const rawRatio = Math.min(
          availableWidth / (bounds.right - bounds.left),
          availableHeight / (bounds.bottom - bounds.top),
        );
        if (!(rawRatio > 0 && Number.isFinite(rawRatio))) return;
        const ratio = Math.max(0.05, Math.min(20, rawRatio));
        const nextZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomRef.current * ratio));
        if (Math.abs(nextZoom - zoomRef.current) > 0.000001) {
          zoomRef.current = nextZoom;
          setZoom(nextZoom);
          await nextPaint();
          if (operation !== framingOperationRef.current) return;
        }

        bounds = measureProjectedSceneBounds(camera);
        const errorX = (bounds.left + bounds.right) / 2 - camera.clientWidth / 2;
        const errorY = (bounds.top + bounds.bottom) / 2 - camera.clientHeight / 2;
        if (Math.abs(errorX) >= 0.5 || Math.abs(errorY) >= 0.5) {
          const basePan = { ...panRef.current };
          const probeDistance = 12;
          const probePan = { x: basePan.x + probeDistance, y: basePan.y + probeDistance };
          panRef.current = probePan;
          setPan(probePan);
          await nextPaint();
          if (operation !== framingOperationRef.current) return;
          const probeBounds = measureProjectedSceneBounds(camera);
          const probeCenterX = (probeBounds.left + probeBounds.right) / 2;
          const probeCenterY = (probeBounds.top + probeBounds.bottom) / 2;
          const baseCenterX = (bounds.left + bounds.right) / 2;
          const baseCenterY = (bounds.top + bounds.bottom) / 2;
          const slopeX = (probeCenterX - baseCenterX) / probeDistance;
          const slopeY = (probeCenterY - baseCenterY) / probeDistance;
          const correctionX = Number.isFinite(slopeX) && Math.abs(slopeX) > 0.02
            ? -errorX / slopeX
            : -errorX;
          const correctionY = Number.isFinite(slopeY) && Math.abs(slopeY) > 0.02
            ? -errorY / slopeY
            : -errorY;
          const nextPan = {
            x: basePan.x + Math.max(-camera.clientWidth * 2, Math.min(camera.clientWidth * 2, correctionX)),
            y: basePan.y + Math.max(-camera.clientHeight * 2, Math.min(camera.clientHeight * 2, correctionY)),
          };
          panRef.current = nextPan;
          setPan(nextPan);
          await nextPaint();
          if (operation !== framingOperationRef.current) return;
        }

        const finalBounds = measureProjectedSceneBounds(camera);
        const finalRatio = Math.min(
          availableWidth / (finalBounds.right - finalBounds.left),
          availableHeight / (finalBounds.bottom - finalBounds.top),
        );
        const finalDeltaX = camera.clientWidth / 2 - (finalBounds.left + finalBounds.right) / 2;
        const finalDeltaY = camera.clientHeight / 2 - (finalBounds.top + finalBounds.bottom) / 2;
        if (Math.abs(Math.log(Math.max(finalRatio, 0.000001))) < 0.003
          && Math.abs(finalDeltaX) < 0.5
          && Math.abs(finalDeltaY) < 0.5) break;
      }
    } finally {
      if (operation === framingOperationRef.current) setIsFraming(false);
    }
  }, []);

  const updateNodeDepth = useCallback((amount) => {
    if (amount === 0) {
      const scrollRegion = specimenRef.current?.querySelector("[data-toretto-scroll]");
      if (scrollRegion) scrollRegion.scrollTop = 0;
    }
    const liveNodes = specimenRef.current
      ? [...specimenRef.current.querySelectorAll("[data-spatial-node]")]
      : nodesRef.current.filter((element) => element.isConnected);
    nodesRef.current = liveNodes;
    const maxWeight = Math.max(1, ...liveNodes.map((element) => Number(element.dataset.spatialWeight || 0)));
    const directionLength = Math.hypot(
      explosionField.direction.x,
      explosionField.direction.y,
      explosionField.direction.z,
    ) || 1;
    const direction = {
      x: explosionField.direction.x / directionLength,
      y: explosionField.direction.y / directionLength,
      z: explosionField.direction.z / directionLength,
    };
    const signedProgress = amount / EXPLOSION_DEPTH_MAX;
    const curve = Math.max(0.1, explosionField.curve / 100);
    const cameraClipDepth = perspective > 0 ? perspective * CAMERA_NEAR_CLIP_RATIO : Infinity;
    const cumulativeOffset = new Map();
    const sceneRotation = quaternionFromEuler(sceneTransform.rotation);
    const setSpatialStyle = (element, key, property, value) => {
      let cache = nodeStyleCacheRef.current.get(element);
      if (!cache) {
        cache = {};
        nodeStyleCacheRef.current.set(element, cache);
      }
      if (cache[key] === value) return;
      cache[key] = value;
      element.style.setProperty(property, value);
    };
    liveNodes.forEach((element, index) => {
      const weight = Number(element.dataset.spatialWeight || 0);
      const depthProgress = weight === 0 ? 0 : (weight / maxWeight) ** curve;
      const distance = amount * 0.3 * maxWeight * depthProgress;
      const radialX = Number(element.dataset.spatialRadialX || 0);
      const radialY = Number(element.dataset.spatialRadialY || 0);
      const spread = explosionField.spread * signedProgress * depthProgress;
      const x = direction.x * distance + radialX * spread;
      const y = direction.y * distance + radialY * spread;
      const rawZ = direction.z * distance;
      const parentNode = element.parentElement?.closest("[data-spatial-node]");
      const parentOffset = cumulativeOffset.get(parentNode) || { x: 0, y: 0, z: 0 };
      const offset = {
        x: parentOffset.x + x,
        y: parentOffset.y + y,
        z: parentOffset.z + rawZ,
      };
      cumulativeOffset.set(element, offset);
      const sceneScale = sceneTransform.scale / 100;
      const scenePoint = rotateVector(sceneRotation, {
        x: (radialX * APP_WIDTH / 2 + offset.x) * sceneScale,
        y: (radialY * APP_HEIGHT / 2 + offset.y) * sceneScale,
        z: offset.z,
      });
      scenePoint.x += sceneTransform.position.x;
      scenePoint.y += sceneTransform.position.y;
      scenePoint.z += sceneTransform.position.z;
      const cameraPoint = rotateVector(orientation, scenePoint);
      const cameraVisibility = cameraPoint.z < cameraClipDepth ? "visible" : "hidden";
      const spin = quaternionFromEuler({
        x: explosionField.rotation.x * signedProgress * depthProgress,
        y: explosionField.rotation.y * signedProgress * depthProgress,
        z: explosionField.rotation.z * signedProgress * depthProgress,
      });
      const twist = axisAngleQuaternion(
        direction,
        explosionField.twist * signedProgress * depthProgress,
      );
      const rotation = quaternionAxisAngle(multiplyQuaternions(spin, twist));
      const scale = Math.max(0.05, 1 + explosionField.scale / 100 * signedProgress * depthProgress);
      setSpatialStyle(element, "x", "--spatial-local-x", `${x.toFixed(2)}px`);
      setSpatialStyle(element, "y", "--spatial-local-y", `${y.toFixed(2)}px`);
      setSpatialStyle(element, "z", "--spatial-local-z", `${rawZ.toFixed(2)}px`);
      setSpatialStyle(element, "cameraVisibility", "--spatial-camera-visibility", cameraVisibility);
      setSpatialStyle(
        element,
        "rotation",
        "--spatial-local-rotation",
        `${rotation.x.toFixed(5)} ${rotation.y.toFixed(5)} ${rotation.z.toFixed(5)} ${rotation.degrees.toFixed(3)}deg`,
      );
      setSpatialStyle(element, "scale", "--spatial-local-scale", scale.toFixed(5));
    });
  }, [explosionField, orientation, perspective, sceneTransform]);

  updateNodeDepthRef.current = updateNodeDepth;

  const indexDom = useCallback(() => {
    const specimen = specimenRef.current;
    const appShell = specimen?.querySelector("[data-toretto-root]");
    if (!appShell) return;
    const candidates = [appShell, ...appShell.querySelectorAll("*")];
    const appBounds = appShell.getBoundingClientRect();
    const nodes = candidates.filter((element) => {
      if (element.matches("svg, svg *")) return false;
      return element.offsetWidth > 3
        && element.offsetHeight > 3
        && getComputedStyle(element).display !== "contents";
    });
    for (const element of nodes) {
      const computed = getComputedStyle(element);
      const index = nodes.indexOf(element);
      element.dataset.spatialNode = "";
      element.dataset.spatialOrder = String(index);
      element.dataset.spatialWeight = String(spatialWeight(element, computed));
      if (!element.dataset.spatialRadialX || !element.dataset.spatialRadialY) {
        const bounds = element.getBoundingClientRect();
        element.dataset.spatialRadialX = String(
          ((bounds.left + bounds.width / 2) - (appBounds.left + appBounds.width / 2)) / Math.max(1, appBounds.width / 2),
        );
        element.dataset.spatialRadialY = String(
          ((bounds.top + bounds.height / 2) - (appBounds.top + appBounds.height / 2)) / Math.max(1, appBounds.height / 2),
        );
      }
      const clipsDepth = [computed.overflow, computed.overflowX, computed.overflowY]
        .some((value) => value !== "visible" && value !== "clip");
      if (!element.dataset.spatialOriginalOverflow) {
        element.dataset.spatialOriginalOverflow = clipsDepth ? "clip" : "visible";
      }
      if (element.dataset.spatialOriginalOverflow === "clip") element.dataset.spatialClips = "";
    }
    nodesRef.current = nodes;
    setNodeCount(nodes.length);
    updateNodeDepthRef.current(explosionRef.current);
  }, []);

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

  useLayoutEffect(() => updateNodeDepth(explosion), [explosion, updateNodeDepth]);

  useEffect(() => () => {
    cancelAnimationFrame(animationFrameRef.current);
    window.clearTimeout(flattenTimerRef.current);
    window.clearTimeout(exportTimerRef.current);
    if (exportUrlRef.current) URL.revokeObjectURL(exportUrlRef.current);
    exportPreviewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  useEffect(() => {
    const handleModifierDown = (event) => {
      if (event.key === "Shift") setIsShiftHeld(true);
      if (event.key === "Control") setIsControlHeld(true);
      if (event.key === "Alt") setIsAltHeld(true);
    };
    const handleModifierUp = (event) => {
      if (event.key === "Shift") setIsShiftHeld(false);
      if (event.key === "Control") setIsControlHeld(false);
      if (event.key === "Alt") setIsAltHeld(false);
    };
    const clearModifiers = () => {
      setIsShiftHeld(false);
      setIsControlHeld(false);
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
    resizeRef.current = new ResizeObserver(fitBaseView);
    resizeRef.current.observe(camera);
    fitBaseView();
    return () => resizeRef.current?.disconnect();
  }, [fitBaseView]);

  useEffect(() => {
    const handleFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === rootRef.current);
      requestAnimationFrame(fitBaseView);
    };
    document.addEventListener("fullscreenchange", handleFullscreen);
    return () => document.removeEventListener("fullscreenchange", handleFullscreen);
  }, [fitBaseView]);

  const flatten = () => {
    applyExplosionPosition(0);
  };

  const reset = () => {
    setIsPlaying(false);
    setPlayhead(0);
    flatten();
    setPerspective(LENS_DEFAULT);
    setVanishingPoint({ x: 0, y: 0 });
    setSceneTransform(DEFAULT_SCENE_TRANSFORM);
    setExplosionField(DEFAULT_EXPLOSION_FIELD);
    setOrientation(IDENTITY_ORIENTATION);
    fitBaseView();
  };

  const captureAnimationState = useCallback(() => ({
    explosionPosition,
    perspective,
    vanishingPoint,
    sceneTransform,
    explosionField,
    pan,
    zoom,
    orientation,
  }), [explosionPosition, perspective, vanishingPoint, sceneTransform, explosionField, pan, zoom, orientation]);

  const applyAnimationState = useCallback((state) => {
    if (!state) return;
    const nextExplosion = Math.max(EXPLOSION_CONTROL_MIN, Math.min(EXPLOSION_CONTROL_MAX, state.explosionPosition));
    explosionPositionRef.current = nextExplosion;
    setIsExplosionImmediate(true);
    setIsSettlingFlat(false);
    setExplosionPosition(nextExplosion);
    setPerspective(state.perspective);
    setVanishingPoint(state.vanishingPoint);
    setSceneTransform(state.sceneTransform);
    setExplosionField(state.explosionField);
    panRef.current = state.pan;
    zoomRef.current = state.zoom;
    setPan(state.pan);
    setZoom(state.zoom);
    setOrientation(normalizeQuaternion(state.orientation));
  }, []);

  useEffect(() => {
    if (isPlaying) return;
    const currentState = captureAnimationState();
    setKeyframes((current) => {
      const baseline = current.find((frame) => frame.id === "baseline" || frame.time === 0);
      if (!baseline) return [{ id: "baseline", time: 0, state: currentState }, ...current];
      const editingBaseline = selectedKeyframeId === "baseline"
        || (!selectedKeyframeId && playhead <= 0.001);
      const editingSelectedFrame = current.some((frame) => (
        frame.id === selectedKeyframeId && frame.id !== "baseline"
      ));
      if (!editingBaseline && !editingSelectedFrame) return current;
      return current.map((frame) => {
        if (editingBaseline && frame === baseline) {
          return { ...frame, id: "baseline", time: 0, state: currentState };
        }
        if (editingSelectedFrame && frame.id === selectedKeyframeId) {
          return { ...frame, state: currentState };
        }
        return frame;
      });
    });
  }, [captureAnimationState, isPlaying, playhead, selectedKeyframeId]);

  const seekTimeline = useCallback((nextTime, keyframeId = null) => {
    const bounded = Math.max(0, Math.min(timelineDuration, nextTime));
    setIsPlaying(false);
    setSelectedKeyframeId(keyframeId);
    setPlayhead(bounded);
    applyAnimationState(evaluateKeyframes(keyframes, bounded));
  }, [applyAnimationState, keyframes, timelineDuration]);

  const addKeyframe = () => {
    const time = Number(playhead.toFixed(3));
    if (time <= 0.001) {
      setSelectedKeyframeId("baseline");
      return;
    }
    const existing = keyframes.find((candidate) => Math.abs(candidate.time - time) <= 0.001);
    const frame = {
      id: existing?.id || `keyframe-${++keyframeIdRef.current}`,
      time,
      state: captureAnimationState(),
    };
    setKeyframes((current) => [
      ...current.filter((candidate) => Math.abs(candidate.time - frame.time) > 0.001),
      frame,
    ].sort((left, right) => left.time - right.time));
    setSelectedKeyframeId(frame.id);
  };

  const deleteSelectedKeyframe = useCallback(() => {
    if (!selectedKeyframeId || selectedKeyframeId === "baseline") return;
    setIsPlaying(false);
    setKeyframes((current) => current.filter((frame) => frame.id !== selectedKeyframeId));
    setSelectedKeyframeId("baseline");
  }, [selectedKeyframeId]);

  const moveKeyframe = useCallback((id, clientX) => {
    const rect = timelineMarkersRef.current?.getBoundingClientRect();
    if (!rect?.width || id === "baseline") return;
    const proposedTime = Math.max(0.01, Math.min(
      timelineDuration,
      (clientX - rect.left) / rect.width * timelineDuration,
    ));
    setKeyframes((current) => {
      const ordered = [...current].sort((left, right) => left.time - right.time);
      const index = ordered.findIndex((frame) => frame.id === id);
      if (index < 0) return current;
      const minimum = (ordered[index - 1]?.time ?? 0) + 0.01;
      const maximum = Math.max(minimum, (ordered[index + 1]?.time ?? timelineDuration + 0.01) - 0.01);
      const nextTime = Number(Math.max(minimum, Math.min(maximum, proposedTime)).toFixed(3));
      ordered[index] = { ...ordered[index], time: nextTime };
      return ordered.sort((left, right) => left.time - right.time);
    });
  }, [timelineDuration]);

  const beginKeyframeDrag = useCallback((event, frame) => {
    event.preventDefault();
    event.stopPropagation();
    setIsPlaying(false);
    setSelectedKeyframeId(frame.id);
    applyAnimationState(frame.state);
    keyframeDragRef.current = {
      id: frame.id,
      startX: event.clientX,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, [applyAnimationState]);

  const dragKeyframe = useCallback((event) => {
    const drag = keyframeDragRef.current;
    if (!drag || drag.id === "baseline") return;
    if (Math.abs(event.clientX - drag.startX) > 2) drag.moved = true;
    if (drag.moved) moveKeyframe(drag.id, event.clientX);
  }, [moveKeyframe]);

  const endKeyframeDrag = useCallback((event) => {
    if (!keyframeDragRef.current) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    keyframeDragRef.current = null;
  }, []);

  useEffect(() => {
    if (!isPlaying) return undefined;
    if (keyframes.length < 2) {
      setIsPlaying(false);
      return undefined;
    }
    playbackStartedRef.current = performance.now() - playhead * 1000;
    const tick = (now) => {
      const nextTime = Math.min(timelineDuration, (now - playbackStartedRef.current) / 1000);
      flushSync(() => {
        setPlayhead(nextTime);
        applyAnimationState(evaluateKeyframes(keyframes, nextTime));
      });
      if (nextTime >= timelineDuration) {
        setIsPlaying(false);
        return;
      }
      animationFrameRef.current = requestAnimationFrame(tick);
    };
    animationFrameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameRef.current);
  }, [applyAnimationState, isPlaying, keyframes, timelineDuration]);

  const toggleTimelinePlayback = useCallback(async () => {
    const launch = playbackLaunchRef.current + 1;
    playbackLaunchRef.current = launch;
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }
    const shouldRestart = Boolean(selectedKeyframeId)
      || playhead >= timelineDuration - 0.001;
    setSelectedKeyframeId(null);
    if (shouldRestart) {
      setIsPlaying(false);
      setPlayhead(0);
      applyAnimationState(evaluateKeyframes(keyframes, 0));
      await nextPaint();
      if (playbackLaunchRef.current !== launch) return;
    }
    setIsPlaying(true);
  }, [applyAnimationState, isPlaying, keyframes, playhead, selectedKeyframeId, timelineDuration]);

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
    applyExplosionPosition(outsideBipolarDeadzone(
      Number(event.currentTarget.value),
      event.currentTarget.clientWidth,
    ), true);
  };

  const updateRangeDrag = (event) => {
    const drag = rangeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const usableWidth = Math.max(1, drag.rect.width - RANGE_THUMB_SIZE);
    const centerX = event.clientX - drag.grabOffset;
    const progress = Math.max(0, Math.min(1,
      (centerX - drag.rect.left - RANGE_THUMB_SIZE / 2) / usableWidth,
    ));
    const rawValue = drag.min + progress * (drag.max - drag.min);
    drag.onChange(drag.normalize(rawValue, drag.rect.width, drag.extent));
  };

  const beginRangeDrag = (event, value, min, max, extent, onChange, normalize = outsideBipolarDeadzone) => {
    if (event.button !== 0) return;
    cancelFraming();
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    const rect = event.currentTarget.getBoundingClientRect();
    const usableWidth = Math.max(1, rect.width - RANGE_THUMB_SIZE);
    const progress = (value - min) / (max - min);
    const thumbCenter = rect.left + RANGE_THUMB_SIZE / 2 + progress * usableWidth;
    const pointerOffset = event.clientX - thumbCenter;
    const grabbedThumb = Math.abs(pointerOffset) <= RANGE_THUMB_SIZE / 2 + 2;
    rangeDragRef.current = {
      pointerId: event.pointerId,
      rect,
      min,
      max,
      extent,
      onChange,
      normalize,
      grabOffset: grabbedThumb ? pointerOffset : 0,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    if (!grabbedThumb) updateRangeDrag(event);
  };

  const endRangeDrag = (event) => {
    const drag = rangeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    rangeDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const beginDrag = (event) => {
    if (contentKey && event.button === 0 && event.target.closest?.("a[href]")) return;
    cancelFraming();
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
    const tumbleGesture = drag.button === 0
      && (event.ctrlKey || (mode === "tumble" && !event.shiftKey && !event.altKey));
    const yawGesture = !tumbleGesture && drag.button === 0
      && mode === "yaw" && !event.shiftKey && !event.altKey;
    const rollGesture = !tumbleGesture && !yawGesture && drag.button === 0
      && (event.altKey || (mode === "roll" && !event.shiftKey));
    const panGesture = !tumbleGesture && !yawGesture && !rollGesture
      && (mode === "pan" || event.shiftKey || drag.button === 1 || drag.button === 2);
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (tumbleGesture) setOrientation((current) => multiplyQuaternions(
      current,
      axisAngleQuaternion(ROTATION_AXES.x, -dy * 0.18),
    ));
    else if (yawGesture) setOrientation((current) => multiplyQuaternions(
      current,
      axisAngleQuaternion(ROTATION_AXES.y, dx * 0.2),
    ));
    else if (panGesture) setPan((current) => ({ x: current.x + dx, y: current.y + dy }));
    else if (rollGesture) setOrientation((current) => multiplyQuaternions(
      axisAngleQuaternion(ROTATION_AXES.z, dx * 0.24),
      current,
    ));
    else {
      const orbitDelta = multiplyQuaternions(
        axisAngleQuaternion(ROTATION_AXES.x, -dy * 0.18),
        axisAngleQuaternion(ROTATION_AXES.y, dx * 0.2),
      );
      setOrientation((current) => multiplyQuaternions(orbitDelta, current));
    }
  };

  const endDrag = (event) => {
    dragRef.current = null;
    if (cameraRef.current?.hasPointerCapture(event.pointerId)) cameraRef.current.releasePointerCapture(event.pointerId);
  };

  const beginGizmoDrag = (event, axis = null) => {
    cancelFraming();
    event.preventDefault();
    event.stopPropagation();
    cameraRef.current?.focus({ preventScroll: true });
    const gizmoRect = event.currentTarget.closest(".spatializer-gizmo")?.getBoundingClientRect();
    gizmoDragRef.current = {
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      axis,
      moved: false,
      centerX: gizmoRect ? gizmoRect.left + gizmoRect.width / 2 : event.clientX,
      centerY: gizmoRect ? gizmoRect.top + gizmoRect.height / 2 : event.clientY,
      radius: 30,
      startSceneOrientation: orientation,
      startAxis: axis ? rotateVector(orientation, AXIS_VECTORS[axis]) : null,
      rotationAxis: null,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveGizmoDrag = (event) => {
    const drag = gizmoDragRef.current;
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 4) drag.moved = true;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (drag.axis && !drag.moved) return;
    if (drag.axis) {
      const relativeX = (event.clientX - drag.centerX) / drag.radius;
      const relativeY = (event.clientY - drag.centerY) / drag.radius;
      const distance = Math.hypot(relativeX, relativeY);
      const desired = distance > 1
        ? { x: relativeX / distance, y: relativeY / distance, z: 0 }
        : { x: relativeX, y: relativeY, z: Math.sqrt(Math.max(0, 1 - distance ** 2)) };
      const cross = {
        x: drag.startAxis.y * desired.z - drag.startAxis.z * desired.y,
        y: drag.startAxis.z * desired.x - drag.startAxis.x * desired.z,
        z: drag.startAxis.x * desired.y - drag.startAxis.y * desired.x,
      };
      const crossLength = Math.hypot(cross.x, cross.y, cross.z);
      if (crossLength > 0.0001) {
        drag.rotationAxis = {
          x: cross.x / crossLength,
          y: cross.y / crossLength,
          z: cross.z / crossLength,
        };
      }
      const dot = Math.max(-1, Math.min(1,
        drag.startAxis.x * desired.x + drag.startAxis.y * desired.y + drag.startAxis.z * desired.z,
      ));
      const baseAngle = Math.acos(dot) * 180 / Math.PI;
      const delta = distance > 1 && drag.rotationAxis
        ? axisAngleQuaternion(drag.rotationAxis, baseAngle + (distance - 1) * 90)
        : quaternionBetween(drag.startAxis, desired);
      const targetSceneOrientation = multiplyQuaternions(delta, drag.startSceneOrientation);
      setOrientation(targetSceneOrientation);
    } else if (event.ctrlKey) setOrientation((current) => multiplyQuaternions(
      current,
      axisAngleQuaternion(ROTATION_AXES.x, -dy * 0.18),
    ));
    else if (event.altKey) setOrientation((current) => multiplyQuaternions(
      axisAngleQuaternion(ROTATION_AXES.z, dx * 0.24),
      current,
    ));
    else {
      const orbitDelta = multiplyQuaternions(
        axisAngleQuaternion(ROTATION_AXES.x, -dy * 0.18),
        axisAngleQuaternion(ROTATION_AXES.y, dx * 0.2),
      );
      setOrientation((current) => multiplyQuaternions(orbitDelta, current));
    }
  };

  const endGizmoDrag = (event) => {
    event.stopPropagation();
    const drag = gizmoDragRef.current;
    gizmoDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (drag?.axis && !drag.moved) setAxisView(drag.axis);
  };

  const setAxisView = (axis) => {
    if (axis === "x") {
      setOrientation(quaternionFromEuler({ x: 0, y: -90, z: 0 }));
    } else if (axis === "y") {
      setOrientation(quaternionFromEuler({ x: 90, y: 0, z: 0 }));
    } else {
      setOrientation(IDENTITY_ORIENTATION);
    }
  };

  const setEulerAxis = (axis, value) => {
    const current = quaternionToEuler(orientation);
    setOrientation(quaternionFromEuler({ ...current, [axis]: value }));
  };

  const setQuaternionComponent = (component, value) => {
    setOrientation((current) => normalizeQuaternion({ ...current, [component]: value }));
  };

  const copyOrientation = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(orientation));
      setOrientationStatus("Quaternion copied");
    } catch {
      setOrientationStatus("Copy unavailable");
    }
  };

  const pasteOrientation = async () => {
    try {
      const raw = await navigator.clipboard.readText();
      let values;
      try {
        const parsed = JSON.parse(raw);
        values = [parsed.x, parsed.y, parsed.z, parsed.w];
      } catch {
        values = raw.trim().split(/[\s,]+/).map(Number);
      }
      if (values.length !== 4 || values.some((value) => !Number.isFinite(Number(value)))) {
        throw new Error("Invalid quaternion");
      }
      setOrientation(normalizeQuaternion({ x: Number(values[0]), y: Number(values[1]), z: Number(values[2]), w: Number(values[3]) }));
      setOrientationStatus("Quaternion pasted");
    } catch {
      setOrientationStatus("Paste four quaternion values");
    }
  };

  const handleWheel = (event) => {
    cancelFraming();
    event.preventDefault();
    if (event.shiftKey) {
      const nextPan = { x: panRef.current.x - event.deltaY, y: panRef.current.y };
      panRef.current = nextPan;
      setPan(nextPan);
      return;
    }
    if (contentKey && (event.metaKey || event.ctrlKey)) {
      const page = specimenRef.current?.querySelector(".imported-document");
      if (page) {
        page.scrollLeft += event.deltaX;
        page.scrollTop += event.deltaY;
      }
      return;
    }
    const factor = Math.exp(-event.deltaY * 0.0012);
    const cameraRect = cameraRef.current?.getBoundingClientRect();
    const anchor = cameraRect ? {
      x: event.clientX - cameraRect.left - cameraRect.width / 2,
      y: event.clientY - cameraRect.top - cameraRect.height / 2,
    } : { x: 0, y: 0 };
    const currentZoom = zoomRef.current;
    const nextZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, currentZoom * factor));
    const ratio = nextZoom / currentZoom;
    if (ratio === 1) return;
    const currentPan = panRef.current;
    const nextPan = {
      x: anchor.x - ratio * (anchor.x - currentPan.x),
      y: anchor.y - ratio * (anchor.y - currentPan.y),
    };
    zoomRef.current = nextZoom;
    panRef.current = nextPan;
    setZoom(nextZoom);
    setPan(nextPan);
  };

  const handleKeyDown = (event) => {
    const panStep = event.shiftKey ? 80 : 28;
    const handled = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "q", "e", "+", "=", "-"].includes(event.key);
    if (handled) event.preventDefault();
    if (event.key === "ArrowLeft") setPan((current) => ({ ...current, x: current.x - panStep }));
    if (event.key === "ArrowRight") setPan((current) => ({ ...current, x: current.x + panStep }));
    if (event.key === "ArrowUp") setPan((current) => ({ ...current, y: current.y - panStep }));
    if (event.key === "ArrowDown") setPan((current) => ({ ...current, y: current.y + panStep }));
    if (event.key.toLowerCase() === "q") setOrientation((current) => multiplyQuaternions(
      axisAngleQuaternion(ROTATION_AXES.z, -8),
      current,
    ));
    if (event.key.toLowerCase() === "e") setOrientation((current) => multiplyQuaternions(
      axisAngleQuaternion(ROTATION_AXES.z, 8),
      current,
    ));
    if (event.key === "+" || event.key === "=") setZoom((current) => Math.min(ZOOM_MAX, current * 1.12));
    if (event.key === "-") setZoom((current) => Math.max(ZOOM_MIN, current / 1.12));
  };

  // Explosion only changes layer depth. Framing remains an explicit camera
  // choice through zoom, pan, and Fit rather than changing as the stack grows.
  const worldScale = fitScale;
  const cameraTransform = `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`;
  const worldTransform = `${quaternionMatrix(orientation)} scale(${worldScale})`;
  const sceneTransformCss = `translate3d(${sceneTransform.position.x}px, ${sceneTransform.position.y}px, ${sceneTransform.position.z}px) rotateX(${sceneTransform.rotation.x}deg) rotateY(${sceneTransform.rotation.y}deg) rotateZ(${sceneTransform.rotation.z}deg) skew(${sceneTransform.skew.x}deg, ${sceneTransform.skew.y}deg) scale(${sceneTransform.scale / 100})`;
  const gizmoTransform = quaternionMatrix(orientation);
  const gizmoInverseTransform = quaternionMatrix(invertQuaternion(orientation));
  const orientationEuler = quaternionToEuler(orientation);
  const effectiveMode = isControlHeld ? "tumble" : isAltHeld ? "roll" : isShiftHeld ? "pan" : mode;
  const setVanishingAxis = (axis, value) => setVanishingPoint((current) => ({ ...current, [axis]: value }));
  const setSceneAxis = (group, axis, value) => setSceneTransform((current) => ({
    ...current,
    [group]: { ...current[group], [axis]: value },
  }));
  const setExplosionFieldAxis = (group, axis, value) => setExplosionField((current) => ({
    ...current,
    [group]: { ...current[group], [axis]: value },
  }));
  const perspectiveOrigin = `${50 + vanishingPoint.x * VANISHING_ORIGIN_RANGE / VANISHING_CONTROL_MAX}% ${50 + vanishingPoint.y * VANISHING_ORIGIN_RANGE / VANISHING_CONTROL_MAX}%`;
  const renderInspectorRange = ({
    label,
    value,
    min,
    max,
    zero = 0,
    onChange,
    onCommit = onChange,
    ariaValue = String(value),
    unipolar = false,
  }) => (
    <div className={`spatializer-range spatializer-inspector-range spatializer-bipolar ${unipolar ? "spatializer-unipolar" : ""}`}>
      <span>
        {label}
        <span className="spatializer-zero-group inline-flex h-[18px] overflow-hidden rounded border border-white/10">
          <RangeValueInput value={Math.round(value)} label={`${label} value`} min={min} max={max} onCommit={onCommit} />
          <button type="button" className="h-full cursor-pointer border-s border-white/10 bg-white/[0.035] px-1.5 text-[8px] font-semibold leading-none text-[#9ca5a3] hover:bg-white/[0.07] hover:text-[#f2f5f4]" onClick={() => onCommit(zero)} aria-label={`Set ${label} to ${zero}`}>{zero === 0 ? "Zero" : zero}</button>
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step="1"
        value={value}
        aria-label={label}
        aria-valuetext={ariaValue}
        style={unipolar
          ? unipolarRangeStyle(value - min, max - min)
          : centeredRangeStyle(value, min, max, zero)}
        onKeyDown={(event) => handleRangeKey(event, value, min, max, onChange)}
        onInput={(event) => onChange(Number(event.currentTarget.value))}
        onPointerDown={(event) => beginRangeDrag(
          event,
          value,
          min,
          max,
          Math.max(Math.abs(min), Math.abs(max)),
          onChange,
          (position) => Math.round(position),
        )}
        onPointerMove={updateRangeDrag}
        onPointerUp={endRangeDrag}
        onPointerCancel={endRangeDrag}
      />
    </div>
  );
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
      data-exploded="true"
      data-immediate-explosion={isExplosionImmediate ? "true" : "false"}
    >
      <header className="spatializer-toolbar" data-spatializer-ignore="">
        <div className="spatializer-primary-actions flex shrink-0 items-center gap-3 border-e border-white/10 pe-4">
          <div className="spatializer-brand">
            <img className="spatializer-brand-mark" src={torettoMarkUrl} alt="" aria-hidden="true" />
            <span className="spatializer-brand-copy"><strong>TORETTO</strong><small>{nodeCount} live DOM elements</small></span>
          </div>
          <button type="button" className={SOURCE_BUTTON} onClick={onOpenSource}>Open…</button>
          <button type="button" className={`${TOOLBAR_BUTTON} text-[#c7f4e2]`} onClick={() => void openExport()}>Export…</button>
        </div>
        <div className="spatializer-controls">
          <div className="spatializer-range spatializer-bipolar">
          <span>
            Explosion
            <span className="spatializer-zero-group inline-flex h-[18px] overflow-hidden rounded border border-white/10">
              <RangeValueInput value={explosionPosition} label="Explosion value" onCommit={applyExplosionPosition} />
              <button type="button" className="h-full cursor-pointer border-s border-white/10 bg-white/[0.035] px-1.5 text-[8px] font-semibold leading-none text-[#9ca5a3] hover:bg-white/[0.07] hover:text-[#f2f5f4]" onClick={flatten} aria-label="Set Explosion to zero">Zero</button>
            </span>
          </span>
          <input
            type="range"
            min={EXPLOSION_CONTROL_MIN}
            max={EXPLOSION_CONTROL_MAX}
            step="1"
            value={explosionPosition}
            aria-label="Explosion depth"
            aria-valuetext={`${Math.round(explosion * 0.3)} pixel layer gap`}
            style={bipolarRangeStyle(explosionPosition)}
            onKeyDown={(event) => handleRangeKey(
              event,
              explosionPosition,
              EXPLOSION_CONTROL_MIN,
              EXPLOSION_CONTROL_MAX,
              applyExplosionPosition,
            )}
            onInput={handleExplosionInput}
            onPointerDown={(event) => beginRangeDrag(
              event,
              explosionPosition,
              EXPLOSION_CONTROL_MIN,
              EXPLOSION_CONTROL_MAX,
              EXPLOSION_CONTROL_MAX,
              (value) => applyExplosionPosition(value, true),
            )}
            onPointerMove={updateRangeDrag}
            onPointerUp={endRangeDrag}
            onPointerCancel={endRangeDrag}
          />
          </div>
          <div className="spatializer-range spatializer-lens spatializer-bipolar spatializer-unipolar">
          <span>
            Perspective
            <span className="spatializer-zero-group inline-flex h-[18px] overflow-hidden rounded border border-white/10">
              <RangeValueInput value={lensControl(perspective)} label="Perspective value" min={LENS_CONTROL_MIN} max={LENS_CONTROL_MAX} onCommit={(value) => setPerspective(lensFromControl(value))} />
              <button type="button" className="h-full cursor-pointer border-s border-white/10 bg-white/[0.035] px-1.5 text-[8px] font-semibold leading-none text-[#9ca5a3] hover:bg-white/[0.07] hover:text-[#f2f5f4]" onClick={() => setPerspective(LENS_DEFAULT)} aria-label="Set Perspective to zero">Zero</button>
            </span>
          </span>
          <input
            type="range"
            min={LENS_CONTROL_MIN}
            max={LENS_CONTROL_MAX}
            step="1"
            value={lensControl(perspective)}
            aria-label="Perspective strength"
            aria-valuetext={perspective === 0 ? "Orthographic" : `${lensControl(perspective)} perspective strength, ${Math.round(perspective)} pixel perspective distance`}
            style={unipolarRangeStyle(lensControl(perspective) - LENS_CONTROL_MIN, LENS_CONTROL_EXTENT)}
            onKeyDown={(event) => handleRangeKey(
              event,
              lensControl(perspective),
              LENS_CONTROL_MIN,
              LENS_CONTROL_MAX,
              (value) => setPerspective(lensFromControl(value)),
            )}
            onInput={(event) => setPerspective(lensFromControl(
              outsideBipolarDeadzone(
                Number(event.currentTarget.value),
                event.currentTarget.clientWidth,
                LENS_CONTROL_MAX,
              ),
            ))}
            onPointerDown={(event) => beginRangeDrag(
              event,
              lensControl(perspective),
              LENS_CONTROL_MIN,
              LENS_CONTROL_MAX,
              LENS_CONTROL_MAX,
              (value) => setPerspective(lensFromControl(value)),
            )}
            onPointerMove={updateRangeDrag}
            onPointerUp={endRangeDrag}
            onPointerCancel={endRangeDrag}
          />
          </div>
          {(["x", "y"]).map((axis) => (
          <div className="spatializer-range spatializer-lens spatializer-bipolar" key={axis}>
          <span>
            Vanish {axis.toUpperCase()}
            <span className="spatializer-zero-group inline-flex h-[18px] overflow-hidden rounded border border-white/10">
              <RangeValueInput value={vanishingPoint[axis]} label={`Vanishing point ${axis.toUpperCase()} value`} min={VANISHING_CONTROL_MIN} max={VANISHING_CONTROL_MAX} onCommit={(value) => setVanishingAxis(axis, value)} />
              <button type="button" className="h-full cursor-pointer border-s border-white/10 bg-white/[0.035] px-1.5 text-[8px] font-semibold leading-none text-[#9ca5a3] hover:bg-white/[0.07] hover:text-[#f2f5f4]" onClick={() => setVanishingAxis(axis, 0)} aria-label={`Set Vanishing point ${axis.toUpperCase()} to zero`}>Zero</button>
            </span>
          </span>
          <input
            type="range"
            min={VANISHING_CONTROL_MIN}
            max={VANISHING_CONTROL_MAX}
            step="1"
            value={vanishingPoint[axis]}
            aria-label={`Vanishing point ${axis.toUpperCase()}`}
            aria-valuetext={`${Math.round(50 + vanishingPoint[axis] * VANISHING_ORIGIN_RANGE / VANISHING_CONTROL_MAX)} percent`}
            style={bipolarRangeStyle(vanishingPoint[axis], VANISHING_CONTROL_MAX)}
            onKeyDown={(event) => handleRangeKey(
              event,
              vanishingPoint[axis],
              VANISHING_CONTROL_MIN,
              VANISHING_CONTROL_MAX,
              (value) => setVanishingAxis(axis, value),
            )}
            onInput={(event) => setVanishingAxis(axis, outsideBipolarDeadzone(
              Number(event.currentTarget.value),
              event.currentTarget.clientWidth,
              VANISHING_CONTROL_MAX,
            ))}
            onPointerDown={(event) => beginRangeDrag(
              event,
              vanishingPoint[axis],
              VANISHING_CONTROL_MIN,
              VANISHING_CONTROL_MAX,
              VANISHING_CONTROL_MAX,
              (value) => setVanishingAxis(axis, value),
            )}
            onPointerMove={updateRangeDrag}
            onPointerUp={endRangeDrag}
            onPointerCancel={endRangeDrag}
          />
          </div>
          ))}
        </div>
        <div className="spatializer-actions flex flex-nowrap gap-1 border-s border-white/10 ps-4">
          <button type="button" className={`${TOOLBAR_BUTTON} disabled:cursor-wait disabled:opacity-45`} disabled={isFraming} onClick={() => void centerView()}>Center</button>
          <button type="button" className={`${TOOLBAR_BUTTON} disabled:cursor-wait disabled:opacity-45`} disabled={isFraming} onClick={() => void fitScene()}>Fit</button>
          <button type="button" className={TOOLBAR_BUTTON} onClick={reset}>Reset</button>
          <button type="button" className={`${TOOLBAR_BUTTON} ${inspectorOpen ? TOOLBAR_ACTIVE : ""}`} aria-pressed={inspectorOpen} onClick={() => setInspectorOpen((current) => !current)}>Inspector</button>
          <button type="button" className={TOOLBAR_BUTTON} onClick={() => void toggleFullscreen()}>{isFullscreen ? "Exit full screen" : "Full screen"}</button>
        </div>
      </header>
      <main
        className={`spatializer-camera mode-${effectiveMode}`}
        ref={cameraRef}
        tabIndex={0}
        aria-label="Spatial canvas. Drag to orbit or pan, Control-drag to tumble, Option-drag to roll, use the wheel to zoom, and arrow keys to move."
        onPointerDown={beginDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onContextMenu={(event) => event.preventDefault()}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
      >
        <div className="spatializer-grid" data-export-ignore="" aria-hidden="true" />
        <div className="spatializer-projection" style={{ perspective: perspective === 0 ? "none" : `${perspective}px`, perspectiveOrigin }}>
          <div className="spatializer-stage" style={{ transform: cameraTransform }}>
            <div className="spatializer-world" style={{ transform: worldTransform }}>
              <div className="spatializer-scene" style={{ transform: sceneTransformCss }}>
                <div className="spatializer-specimen" ref={specimenRef}>
                  <div className="spatializer-app-host">{children}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {inspectorOpen && (
          <aside
            className="spatializer-property-inspector"
            data-spatializer-ignore=""
            data-export-ignore=""
            aria-label="Property inspector"
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <header className="spatializer-property-inspector-header">
              <div><strong>Inspector</strong><span>Scene properties</span></div>
              <button type="button" onClick={() => setInspectorOpen(false)} aria-label="Close property inspector">×</button>
            </header>
            <div className="spatializer-property-inspector-body">
              <details open>
                <summary>Camera</summary>
                <div className="spatializer-inspector-section">
                  {renderInspectorRange({
                    label: "Perspective",
                    value: lensControl(perspective),
                    min: LENS_CONTROL_MIN,
                    max: LENS_CONTROL_MAX,
                    onChange: (value) => setPerspective(lensFromControl(value)),
                    ariaValue: perspective === 0 ? "Orthographic" : `${Math.round(perspective)} pixel perspective distance`,
                    unipolar: true,
                  })}
                  {(["x", "y"]).map((axis) => (
                    <React.Fragment key={`vanish-${axis}`}>
                      {renderInspectorRange({
                        label: `Vanish ${axis.toUpperCase()}`,
                        value: vanishingPoint[axis],
                        min: VANISHING_CONTROL_MIN,
                        max: VANISHING_CONTROL_MAX,
                        onChange: (value) => setVanishingAxis(axis, value),
                        ariaValue: `${Math.round(50 + vanishingPoint[axis] * VANISHING_ORIGIN_RANGE / VANISHING_CONTROL_MAX)} percent`,
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </details>
              <details open>
                <summary>Scene</summary>
                <div className="spatializer-inspector-section">
                  <span className="spatializer-inspector-subhead">Position</span>
                  {(["x", "y", "z"]).map((axis) => (
                    <React.Fragment key={`scene-position-${axis}`}>
                      {renderInspectorRange({ label: axis.toUpperCase(), value: sceneTransform.position[axis], min: -2000, max: 2000, onChange: (value) => setSceneAxis("position", axis, value) })}
                    </React.Fragment>
                  ))}
                  <span className="spatializer-inspector-subhead">Rotation</span>
                  {(["x", "y", "z"]).map((axis) => (
                    <React.Fragment key={`scene-rotation-${axis}`}>
                      {renderInspectorRange({ label: axis.toUpperCase(), value: sceneTransform.rotation[axis], min: -180, max: 180, onChange: (value) => setSceneAxis("rotation", axis, value), ariaValue: `${sceneTransform.rotation[axis]} degrees` })}
                    </React.Fragment>
                  ))}
                  {renderInspectorRange({ label: "Scale", value: sceneTransform.scale, min: 10, max: 300, zero: 100, onChange: (value) => setSceneTransform((current) => ({ ...current, scale: value })), ariaValue: `${sceneTransform.scale} percent`, unipolar: true })}
                  <span className="spatializer-inspector-subhead">Skew</span>
                  {(["x", "y"]).map((axis) => (
                    <React.Fragment key={`scene-skew-${axis}`}>
                      {renderInspectorRange({ label: axis.toUpperCase(), value: sceneTransform.skew[axis], min: -60, max: 60, onChange: (value) => setSceneAxis("skew", axis, value), ariaValue: `${sceneTransform.skew[axis]} degrees` })}
                    </React.Fragment>
                  ))}
                </div>
              </details>
              <details open>
                <summary>Explosion field</summary>
                <div className="spatializer-inspector-section">
                  {renderInspectorRange({ label: "Amount", value: explosionPosition, min: EXPLOSION_CONTROL_MIN, max: EXPLOSION_CONTROL_MAX, onChange: (value) => applyExplosionPosition(value, true), onCommit: applyExplosionPosition, ariaValue: `${Math.round(explosion * 0.3)} pixel base layer gap` })}
                  <span className="spatializer-inspector-subhead">Direction</span>
                  {(["x", "y", "z"]).map((axis) => (
                    <React.Fragment key={`explosion-direction-${axis}`}>
                      {renderInspectorRange({ label: axis.toUpperCase(), value: explosionField.direction[axis], min: -100, max: 100, zero: axis === "z" ? 100 : 0, onChange: (value) => setExplosionFieldAxis("direction", axis, value) })}
                    </React.Fragment>
                  ))}
                  <span className="spatializer-inspector-subhead">Spin</span>
                  {(["x", "y", "z"]).map((axis) => (
                    <React.Fragment key={`explosion-rotation-${axis}`}>
                      {renderInspectorRange({ label: axis.toUpperCase(), value: explosionField.rotation[axis], min: -360, max: 360, onChange: (value) => setExplosionFieldAxis("rotation", axis, value), ariaValue: `${explosionField.rotation[axis]} degrees` })}
                    </React.Fragment>
                  ))}
                  {renderInspectorRange({ label: "Spread", value: explosionField.spread, min: -1000, max: 1000, onChange: (value) => setExplosionField((current) => ({ ...current, spread: value })) })}
                  {renderInspectorRange({ label: "Twist", value: explosionField.twist, min: -720, max: 720, onChange: (value) => setExplosionField((current) => ({ ...current, twist: value })), ariaValue: `${explosionField.twist} degrees` })}
                  {renderInspectorRange({ label: "Scale", value: explosionField.scale, min: -100, max: 100, onChange: (value) => setExplosionField((current) => ({ ...current, scale: value })), ariaValue: `${explosionField.scale} percent at deepest layer` })}
                  {renderInspectorRange({ label: "Curve", value: explosionField.curve, min: 10, max: 300, zero: 100, onChange: (value) => setExplosionField((current) => ({ ...current, curve: value })), ariaValue: `${(explosionField.curve / 100).toFixed(2)} exponent`, unipolar: true })}
                </div>
              </details>
            </div>
          </aside>
        )}
        {orientationInspectorOpen && (
          <section
            className="spatializer-orientation-inspector"
            data-spatializer-ignore=""
            data-export-ignore=""
            aria-label="Orientation inspector"
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-white/10 px-3 py-2">
              <div className="grid gap-0.5">
                <strong className="text-[10px] font-semibold text-[#e6eeea]">Orientation</strong>
                <span className="font-mono text-[8px] text-[#6f7b75]">XYZ · degrees</span>
              </div>
              <button type="button" className="h-5 w-5 cursor-pointer rounded text-sm leading-none text-[#78847e] hover:bg-white/[0.06] hover:text-white" onClick={() => setOrientationInspectorOpen(false)} aria-label="Close orientation inspector">×</button>
            </header>
            <div className="grid gap-3 p-3">
              <div className="grid grid-cols-3 gap-2">
                {(["x", "y", "z"]).map((axis) => (
                  <label className="grid gap-1 font-mono text-[8px] font-semibold uppercase text-[#7f8b85]" key={axis}>
                    <span>{axis}</span>
                    <RangeValueInput value={Math.round(orientationEuler[axis])} label={`${axis.toUpperCase()} rotation in degrees`} min={-180} max={180} onCommit={(value) => setEulerAxis(axis, value)} />
                  </label>
                ))}
              </div>
              <button type="button" className="h-7 rounded-md border border-white/10 bg-white/[0.035] text-[9px] font-medium text-[#9ca5a3] hover:bg-white/[0.07] hover:text-white" onClick={() => setOrientation(IDENTITY_ORIENTATION)}>Zero rotation</button>
              <details className="group border-t border-white/10 pt-2">
                <summary className="cursor-pointer list-none font-mono text-[8px] font-semibold uppercase tracking-[0.08em] text-[#78847e] hover:text-[#b6c1bc]">Advanced quaternion</summary>
                <div className="mt-2 grid gap-2">
                  <div className="grid grid-cols-4 gap-1.5">
                    {(["x", "y", "z", "w"]).map((component) => (
                      <label className="grid gap-1 font-mono text-[8px] font-semibold uppercase text-[#6f7b75]" key={component}>
                        <span>{component}</span>
                        <DecimalValueInput value={orientation[component]} label={`Quaternion ${component.toUpperCase()}`} onCommit={(value) => setQuaternionComponent(component, value)} />
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    <button type="button" className="h-6 rounded border border-white/10 text-[8px] text-[#87918c] hover:bg-white/[0.06] hover:text-white" onClick={() => setOrientation((current) => normalizeQuaternion(current))}>Normalize</button>
                    <button type="button" className="h-6 rounded border border-white/10 text-[8px] text-[#87918c] hover:bg-white/[0.06] hover:text-white" onClick={() => void copyOrientation()}>Copy</button>
                    <button type="button" className="h-6 rounded border border-white/10 text-[8px] text-[#87918c] hover:bg-white/[0.06] hover:text-white" onClick={() => void pasteOrientation()}>Paste</button>
                  </div>
                  {orientationStatus && <span className="font-mono text-[8px] text-[#66e4b3]" role="status">{orientationStatus}</span>}
                </div>
              </details>
            </div>
          </section>
        )}
        <div className="spatializer-gizmo" data-spatializer-ignore="" data-export-ignore="" aria-label="Scene orientation">
          <div className="spatializer-gizmo-rotor" style={{ transform: gizmoTransform }}>
            <span className="spatializer-gizmo-axis axis-x" aria-hidden="true" />
            <span className="spatializer-gizmo-axis axis-y" aria-hidden="true" />
            <span className="spatializer-gizmo-axis axis-z" aria-hidden="true" />
            {["x", "y", "z"].map((axis) => (
              <span className={`spatializer-gizmo-anchor endpoint-${axis}`} key={axis}>
                <button
                  type="button"
                  className={`spatializer-gizmo-endpoint axis-${axis}`}
                  style={{ transform: gizmoInverseTransform }}
                  aria-label={`Drag ${axis.toUpperCase()} axis or click to view`}
                  onPointerDown={(event) => beginGizmoDrag(event, axis)}
                  onPointerMove={moveGizmoDrag}
                  onPointerUp={endGizmoDrag}
                  onPointerCancel={endGizmoDrag}
                >{axis.toUpperCase()}</button>
              </span>
            ))}
            <button
              type="button"
              className="spatializer-gizmo-center"
              style={{ transform: gizmoInverseTransform }}
              aria-label="Drag scene orientation"
              onPointerDown={beginGizmoDrag}
              onPointerMove={moveGizmoDrag}
              onPointerUp={endGizmoDrag}
              onPointerCancel={endGizmoDrag}
            />
          </div>
          <button
            type="button"
            className="spatializer-gizmo-inspector-button"
            aria-label="Edit orientation values"
            aria-expanded={orientationInspectorOpen}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => setOrientationInspectorOpen((current) => !current)}
          >XYZ</button>
        </div>
        <div
          className="spatializer-canvas-zoom spatializer-range spatializer-zoom spatializer-bipolar"
          data-spatializer-ignore=""
          data-export-ignore=""
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <span>
            Zoom
            <span className="spatializer-zero-group inline-flex h-[18px] overflow-hidden rounded border border-white/10">
              <RangeValueInput value={zoomControl(zoom)} label="Zoom value" min={ZOOM_CONTROL_MIN} max={ZOOM_CONTROL_MAX} onCommit={(value) => {
                const nextZoom = zoomFromControl(value);
                zoomRef.current = nextZoom;
                setZoom(nextZoom);
              }} />
              <button type="button" className="h-full cursor-pointer border-s border-white/10 bg-white/[0.035] px-1.5 text-[8px] font-semibold leading-none text-[#9ca5a3] hover:bg-white/[0.07] hover:text-[#f2f5f4]" onClick={() => {
                zoomRef.current = 1;
                setZoom(1);
              }} aria-label="Set Zoom to zero">Zero</button>
            </span>
          </span>
          <input
            type="range"
            min={ZOOM_CONTROL_MIN}
            max={ZOOM_CONTROL_MAX}
            step="1"
            value={zoomControl(zoom)}
            aria-label="Canvas zoom"
            aria-valuetext={`${Math.round(zoom * 100)} percent`}
            style={bipolarRangeStyle(zoomControl(zoom), ZOOM_CONTROL_MAX)}
            onKeyDown={(event) => handleRangeKey(
              event,
              zoomControl(zoom),
              ZOOM_CONTROL_MIN,
              ZOOM_CONTROL_MAX,
              (value) => {
                const nextZoom = zoomFromControl(value);
                zoomRef.current = nextZoom;
                setZoom(nextZoom);
              },
            )}
            onInput={(event) => {
              const nextZoom = zoomFromControl(outsideBipolarDeadzone(
                Number(event.currentTarget.value),
                event.currentTarget.clientWidth,
                ZOOM_CONTROL_MAX,
              ));
              zoomRef.current = nextZoom;
              setZoom(nextZoom);
            }}
            onPointerDown={(event) => beginRangeDrag(
              event,
              zoomControl(zoom),
              ZOOM_CONTROL_MIN,
              ZOOM_CONTROL_MAX,
              ZOOM_CONTROL_MAX,
              (value) => {
                const nextZoom = zoomFromControl(value);
                zoomRef.current = nextZoom;
                setZoom(nextZoom);
              },
            )}
            onPointerMove={updateRangeDrag}
            onPointerUp={endRangeDrag}
            onPointerCancel={endRangeDrag}
          />
        </div>
        <div
          className="spatializer-gizmo-modes inline-flex overflow-hidden rounded-md border border-white/10"
          role="group"
          aria-label="Navigation mode"
          data-spatializer-ignore=""
          data-export-ignore=""
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
        >
          <button type="button" className={`${MODE_BUTTON} ${effectiveMode === "orbit" ? TOOLBAR_ACTIVE : ""}`} aria-pressed={effectiveMode === "orbit"} onClick={() => setMode("orbit")}>Orbit</button>
          <button type="button" className={`${MODE_BUTTON} border-s border-white/10 ${effectiveMode === "pan" ? TOOLBAR_ACTIVE : ""}`} aria-pressed={effectiveMode === "pan"} onClick={() => setMode("pan")}>Pan</button>
          <button type="button" className={`${MODE_BUTTON} border-s border-white/10 ${effectiveMode === "tumble" ? TOOLBAR_ACTIVE : ""}`} aria-pressed={effectiveMode === "tumble"} onClick={() => setMode("tumble")}>Tumble</button>
          <button type="button" className={`${MODE_BUTTON} border-s border-white/10 ${effectiveMode === "yaw" ? TOOLBAR_ACTIVE : ""}`} aria-pressed={effectiveMode === "yaw"} onClick={() => setMode("yaw")}>Yaw</button>
          <button type="button" className={`${MODE_BUTTON} border-s border-white/10 ${effectiveMode === "roll" ? TOOLBAR_ACTIVE : ""}`} aria-pressed={effectiveMode === "roll"} onClick={() => setMode("roll")}>Roll</button>
        </div>
        <div className="spatializer-hint" data-spatializer-ignore="" data-export-ignore="">
          {contentKey
            ? "Wheel zooms Canvas · ⌘/Ctrl-wheel scrolls Page · Control-drag tumbles"
            : effectiveMode === "orbit"
            ? "Drag to orbit · Shift: pan · Control: tumble · Option: roll"
            : effectiveMode === "tumble"
              ? mode === "tumble" && !isControlHeld
                ? "Drag vertically to tumble · Shift: pan · Option: roll"
                : `Control-drag vertically to tumble · Release Control to ${mode}`
            : effectiveMode === "yaw"
              ? "Drag horizontally to yaw · Shift: pan · Control: tumble · Option: roll"
            : effectiveMode === "roll"
              ? mode === "roll" && !isAltHeld
                ? "Drag horizontally to roll · Shift: pan · Control: tumble"
                : `Option-drag horizontally to roll · Release Option to ${mode}`
            : mode === "pan"
              ? "Drag to pan · Wheel to zoom"
              : "Release Shift to orbit · Wheel to zoom"}
        </div>
        <section
          className="spatializer-timeline"
          data-spatializer-ignore=""
          data-export-ignore=""
          aria-label="Animation timeline"
          onPointerDown={(event) => event.stopPropagation()}
          onWheel={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="spatializer-timeline-toolbar">
            <button
              type="button"
              className="spatializer-timeline-play"
              disabled={keyframes.length < 2}
              onClick={() => void toggleTimelinePlayback()}
            >{isPlaying ? "Pause" : "Play"}</button>
            <button type="button" onClick={addKeyframe}>Add keyframe</button>
            <button type="button" disabled={!keyframes.length} onClick={() => {
              const previous = [...keyframes].reverse().find((frame) => frame.time < playhead - 0.001) || keyframes[0];
              if (previous) seekTimeline(previous.time, previous.id);
            }}>Previous</button>
            <button type="button" disabled={!keyframes.length} onClick={() => {
              const next = keyframes.find((frame) => frame.time > playhead + 0.001) || keyframes[keyframes.length - 1];
              if (next) seekTimeline(next.time, next.id);
            }}>Next</button>
            <button type="button" disabled={!selectedKeyframeId || selectedKeyframeId === "baseline"} onClick={deleteSelectedKeyframe}>Delete</button>
            <div className="spatializer-timeline-time" aria-label="Timeline time">
              <TimelineValueInput value={playhead} min={0} max={timelineDuration} step={0.01} label="Playhead time in seconds" onCommit={seekTimeline} />
              <span>s /</span>
              <TimelineValueInput value={timelineDuration} min={0.25} max={120} step={0.25} label="Timeline duration in seconds" onCommit={(nextDuration) => {
                const duration = Math.max(0.25, Math.min(120, nextDuration || DEFAULT_TIMELINE_DURATION));
                setTimelineDuration(duration);
                setPlayhead((current) => Math.min(current, duration));
                setKeyframes((current) => current
                  .filter((frame) => frame.id === "baseline" || frame.time <= duration)
                  .map((frame) => frame.id === "baseline" ? frame : { ...frame, time: Math.min(frame.time, duration) }));
              }} />
              <span>s</span>
            </div>
            <button type="button" disabled={keyframes.length <= 1} onClick={() => {
              setIsPlaying(false);
              setKeyframes([{ id: "baseline", time: 0, state: captureAnimationState() }]);
              setSelectedKeyframeId("baseline");
              setPlayhead(0);
            }}>Clear</button>
          </div>
          <div className="spatializer-timeline-track">
            <input type="range" min="0" max={timelineDuration} step="0.001" value={playhead} aria-label="Timeline playhead" aria-valuetext={`${playhead.toFixed(2)} seconds`} onInput={(event) => seekTimeline(Number(event.currentTarget.value))} />
            <div className="spatializer-keyframe-markers" ref={timelineMarkersRef}>
              {keyframes.map((frame) => <button
                type="button"
                key={frame.id}
                className={`${frame.id === "baseline" ? "is-baseline" : ""} ${frame.id === selectedKeyframeId ? "is-selected" : ""}`}
                style={{ insetInlineStart: `${frame.time / timelineDuration * 100}%` }}
                aria-label={frame.id === "baseline" ? "Baseline keyframe at 0 seconds" : `Keyframe at ${frame.time.toFixed(2)} seconds`}
                aria-pressed={frame.id === selectedKeyframeId}
                onPointerDown={(event) => beginKeyframeDrag(event, frame)}
                onPointerMove={dragKeyframe}
                onPointerUp={endKeyframeDrag}
                onPointerCancel={endKeyframeDrag}
                onKeyDown={(event) => {
                  if ((event.key === "Delete" || event.key === "Backspace") && frame.id !== "baseline") {
                    event.preventDefault();
                    setSelectedKeyframeId(frame.id);
                    setKeyframes((current) => current.filter((candidate) => candidate.id !== frame.id));
                  }
                }}
                title={frame.id === "baseline" ? "Baseline · updates automatically at 0s" : `${frame.time.toFixed(2)} seconds · drag to move`}
              />)}
            </div>
          </div>
        </section>
      </main>
      {exportOpen && <div className="fixed inset-0 z-[1000] grid place-items-center bg-[#040706]/80 p-6 backdrop-blur-xl" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && closeExport()}><section className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#151a18] text-[#e9efec] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="export-title"><header className="flex items-start justify-between border-b border-white/10 px-5 py-4"><div><span className="font-mono text-[9px] font-bold tracking-[0.12em] text-[#65dcae] uppercase">Frame export</span><h2 className="mt-1 text-base font-semibold" id="export-title">Export transparent PNG</h2></div><button type="button" className="p-1 text-xl leading-none text-[#7e8984] hover:text-white" onClick={closeExport} aria-label="Close">×</button></header>{pendingExport ? <div className="grid gap-4 p-5"><ExportPreview key={`bounded-${pendingExport.url}`} src={pendingExport.url} alt="Final transparent PNG preview" footer={exportPreviewFooter} /><div className="grid gap-1"><strong className="text-xs font-semibold">{pendingExport.scope === "scene" ? "Entire scene" : "Canvas frame"} ready</strong>{didSaveExport ? <a className="w-fit max-w-full truncate font-mono text-[10px] text-[#75e5b9] underline decoration-[#75e5b9]/40 underline-offset-2 hover:text-[#a2f3d3]" href={pendingExport.url} target="_blank" rel="noreferrer" title="Open the exported PNG">{pendingExport.filename} ↗</a> : <span className="truncate font-mono text-[10px] text-[#718079]">{pendingExport.filename}</span>}<span className="text-[10px] text-[#718079]">{pendingExport.width} × {pendingExport.height}px · {pendingExport.pixelRatio.toFixed(2)}× · transparent PNG</span>{exportStatus && <span className="mt-1 text-[10px] text-[#aab5b0]" role="status">{exportStatus}</span>}</div></div> : <div className="grid gap-4 p-5"><p className="m-0 text-[11px] leading-5 text-[#7e8984]">Choose whether to preserve the visible Canvas crop or include every projected DOM layer. Both exports omit Toretto's Canvas grid and use a transparent background.</p><div className="grid grid-cols-2 gap-3">{["viewport", "scene"].map((scope) => { const preview = exportPreviews[scope]; const selected = exportScope === scope; return <button type="button" key={scope} className={`overflow-hidden rounded-xl border text-start transition-colors ${selected ? "border-[#66e4b3]/60 bg-[#66e4b3]/[0.06]" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.04]"}`} aria-pressed={selected} onClick={() => setExportScope(scope)}><div className="flex h-40 items-center justify-center overflow-hidden border-b border-white/10 bg-[linear-gradient(45deg,#252b28_25%,transparent_25%),linear-gradient(-45deg,#252b28_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#252b28_75%),linear-gradient(-45deg,transparent_75%,#252b28_75%)] bg-[length:14px_14px] bg-[position:0_0,0_7px,7px_-7px,-7px_0px]">{preview?.url ? <img className="block h-full w-full object-contain object-center" src={preview.url} alt={`${scope} export preview`} /> : <span className="text-[10px] text-[#66716c]">{preview?.error || (isPreviewingExport ? "Rendering preview…" : "Preview unavailable")}</span>}</div><div className="grid gap-1 p-3"><strong className="text-[11px] font-semibold text-[#e4ebe8]">{scope === "viewport" ? "Canvas frame" : "Entire scene"}</strong><span className="text-[9px] leading-4 text-[#718079]">{scope === "viewport" ? "Exact visible Canvas crop" : "Every projected layer, unclipped"}</span>{preview?.captureWidth && <span className="font-mono text-[9px] text-[#5f6c66]">{preview.captureWidth} × {preview.captureHeight} CSS px</span>}</div></button>; })}</div>{exportStatus && <p className="m-0 text-[10px] text-[#ffaaa5]" role="alert">{exportStatus}</p>}</div>}<footer className="flex items-center justify-between border-t border-white/10 px-5 py-3"><span className="text-[9px] text-[#68746e]">PNG · transparent · up to 4× · 16,384px max</span><div className="flex gap-2">{pendingExport ? <><button type="button" className="h-8 rounded-md border border-white/10 px-3 text-[11px] font-medium text-[#9ca5a3] hover:bg-white/[0.06]" onClick={backToExportOptions}>Back</button><button type="button" className="h-8 rounded-md border border-[#66e4b3] bg-[#66e4b3] px-3 text-[11px] font-semibold text-[#102019] hover:bg-[#8aefc8]" onClick={() => void saveExport()}>Save PNG…</button></> : <><button type="button" className="h-8 rounded-md border border-white/10 px-3 text-[11px] font-medium text-[#9ca5a3] hover:bg-white/[0.06]" onClick={closeExport}>Cancel</button><button type="button" className="h-8 rounded-md border border-[#66e4b3] bg-[#66e4b3] px-3 text-[11px] font-semibold text-[#102019] hover:bg-[#8aefc8] disabled:opacity-50" disabled={isPreviewingExport || isExporting} onClick={() => void exportFrame(exportScope)}>{isExporting ? "Rendering…" : "Preview…"}</button></>}</div></footer></section></div>}
    </div>
  );
}
