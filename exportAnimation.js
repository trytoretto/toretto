const FORMAT_DETAILS = Object.freeze({
  mp4: { label: "MP4", extension: "mp4", mimeType: "video/mp4", transparent: false },
  webm: { label: "WebM", extension: "webm", mimeType: "video/webm", transparent: true },
  pngSequence: { label: "PNG sequence", extension: "zip", mimeType: "application/zip", transparent: true },
  prores4444: { label: "ProRes 4444", extension: "mov", mimeType: "video/quicktime", transparent: true },
});

async function responseValue(response) {
  if (response.ok) return response;
  const value = await response.json().catch(() => ({}));
  throw new Error(value.error || `Export failed with status ${response.status}.`);
}

export async function animationExportCapabilities() {
  const response = await fetch("/api/video-export/capabilities");
  await responseValue(response);
  return response.json();
}

export async function createAnimationExport({ format, fps, frameCount }) {
  const response = await fetch("/api/video-export/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ format, fps, frameCount }),
  });
  await responseValue(response);
  return response.json();
}

export async function uploadAnimationFrame(sessionId, index, blob) {
  const response = await fetch(`/api/video-export/frame/${encodeURIComponent(sessionId)}/${index}`, {
    method: "POST",
    headers: { "Content-Type": "image/png" },
    body: blob,
  });
  await responseValue(response);
}

export async function finishAnimationExport(sessionId, format) {
  const response = await fetch(`/api/video-export/finish/${encodeURIComponent(sessionId)}`, { method: "POST" });
  await responseValue(response);
  const blob = await response.blob();
  const disposition = response.headers.get("Content-Disposition") || "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1]
    || `toretto-animation.${FORMAT_DETAILS[format]?.extension || "bin"}`;
  return { blob, filename, format, ...FORMAT_DETAILS[format] };
}

export { FORMAT_DETAILS as ANIMATION_FORMATS };
