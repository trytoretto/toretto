# Toretto architecture

## Product surfaces

Toretto has two first-class hosts around one spatial scene engine.

### Browser extension

The extension is the faithful live-page runtime. A content script indexes the active tab's real DOM and applies non-destructive 3D transforms through a dedicated stylesheet and overlay UI. A background service worker coordinates activation, permissions, capture, and project handoff. Controls live in an isolated shadow root so page CSS cannot restyle Toretto and Toretto does not alter the page's normal UI styles.

The extension should be the preferred path for signed-in applications, JavaScript-heavy sites, video, canvas, WebGL, responsive states, and anything whose rendered result cannot be reconstructed safely from fetched HTML.

### Standalone studio

The studio is the authoring and output runtime. It accepts sanitized HTML, saved website packages, rendered Chromium snapshots, PDFs, and extension captures. It owns camera composition, animation timelines, reusable motion presets, transparent still export, future video export, and portable scene files.

Background Chromium capture is deliberately a snapshot adapter. It is useful for public and local-development pages, but it cannot reproduce every live browser state and should not become a second browser implementation.

## Shared scene core

The engine should be extracted behind host-neutral contracts:

- `DocumentAdapter`: enumerates nodes, geometry, computed styles, scroll state, and stacking relationships.
- `SceneGraph`: stable node identifiers, parentage, depth weights, visibility, and layer families.
- `CameraState`: pan, orbit, roll, zoom, lens, fit, and Canvas dimensions.
- `ExplosionState`: explosion amount, per-node offsets, clipping policy, and layer filtering.
- `Timeline`: keyframes over camera, explosion, node visibility, and presentation properties.
- `Exporter`: Canvas frame, entire scene, transparent still, and later frame-sequence/video output.

The extension adapter references live nodes. The studio adapter references sanitized or frozen nodes. Scene and animation data must never depend on extension-only object identities.

## Interaction model

Canvas navigation is the safe default. Page interaction is explicit so scrolling or clicking the loaded page does not accidentally move the camera.

- Canvas target: wheel zooms; Shift-wheel pans; drag uses Orbit/Pan; Option-drag rolls.
- Page target: wheel scrolls the loaded page; links and supported controls receive pointer input.
- ⌘/Ctrl temporarily routes the wheel to Page while Canvas remains selected.
- Links open in a new tab with `noopener noreferrer`.

Viewport resizing must be implemented as an overlay and host-level emulation boundary. It must not wrap the spatial DOM in an overflow container, because CSS grouping properties such as `overflow: hidden` can flatten a `preserve-3d` subtree into one rectangle. In the extension, viewport emulation may require Chrome DevTools Protocol or a dedicated preview tab rather than mutation of the user's active page.

## Extension milestones

1. Manifest V3 shell, toolbar action, isolated controls, and per-tab activation.
2. Live DOM indexing and the existing camera/explosion controls.
3. Canvas/Page input routing, link safety, and page-mutation reindexing.
4. Capture scene state into the standalone studio.
5. Shared timeline/keyframe format and reusable motion presets.
6. Still and frame-sequence export, followed by encoded video.

## Animation format

Toretto should use the Web Animations API keyframe model as its interchange vocabulary rather than inventing easing and timing semantics. A project sequence can remain plain JSON while mapping directly to `KeyframeEffect` concepts:

```json
{
  "version": 1,
  "duration": 2400,
  "easing": "cubic-bezier(.2,.8,.2,1)",
  "keyframes": [
    { "offset": 0, "camera": { "pan": [0, 0], "orbit": [0, 0, 0], "zoom": 1 }, "explosion": 0 },
    { "offset": 0.65, "camera": { "pan": [80, -20], "orbit": [12, -34, 0], "zoom": 1.35 }, "explosion": 900 },
    { "offset": 1, "camera": { "pan": [0, 0], "orbit": [3, -28, 0], "zoom": 0.9 }, "explosion": 2400 }
  ]
}
```

Camera and explosion values are Toretto-specific properties, but offsets, duration, delay, iterations, direction, fill, and easing should retain Web Animations semantics. This keeps presets understandable, serializable, and playable in both the extension and studio while leaving room for a future timeline UI.
