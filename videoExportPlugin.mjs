import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_FRAME_BYTES = 50 * 1024 * 1024;
const MAX_FRAMES = 7200;
const SESSION_LIFETIME_MS = 30 * 60 * 1000;
const FORMATS = Object.freeze({
  mp4: { extension: "mp4", mimeType: "video/mp4", label: "MP4 video" },
  webm: { extension: "webm", mimeType: "video/webm", label: "WebM video" },
  pngSequence: { extension: "zip", mimeType: "application/zip", label: "PNG sequence" },
  prores4444: { extension: "mov", mimeType: "video/quicktime", label: "ProRes 4444 video" },
});

const sessions = new Map();

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

async function readBody(request, maximum = 64 * 1024) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > maximum) throw new Error("The request was too large.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ["ignore", "ignore", "pipe"] });
    let errorOutput = "";
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk;
      if (errorOutput.length > 32_000) errorOutput = errorOutput.slice(-32_000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(errorOutput.trim() || `${command} exited with code ${code}.`));
    });
  });
}

async function ffmpegAvailable() {
  try {
    await run("ffmpeg", ["-version"]);
    return true;
  } catch {
    return false;
  }
}

function ffmpegArguments(session, outputPath) {
  const input = path.join(session.framesDirectory, "frame-%06d.png");
  const common = ["-hide_banner", "-loglevel", "error", "-y", "-framerate", String(session.fps), "-i", input, "-an"];
  if (session.format === "mp4") {
    return [...common, "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2:color=black", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputPath];
  }
  if (session.format === "webm") {
    return [...common, "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2:color=black@0", "-c:v", "libvpx-vp9", "-crf", "18", "-b:v", "0", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", outputPath];
  }
  return [...common, "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2:color=black@0", "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le", "-vendor", "apl0", outputPath];
}

async function removeSession(session) {
  sessions.delete(session.id);
  await fsp.rm(session.directory, { recursive: true, force: true }).catch(() => {});
}

function findSession(id) {
  const session = sessions.get(id);
  if (!session) throw new Error("The export session expired. Start the export again.");
  if (Date.now() - session.createdAt > SESSION_LIFETIME_MS) {
    void removeSession(session);
    throw new Error("The export session expired. Start the export again.");
  }
  return session;
}

async function startSession(request, response) {
  const body = JSON.parse((await readBody(request)).toString("utf8"));
  const format = String(body.format || "");
  const fps = Number(body.fps);
  const frameCount = Number(body.frameCount);
  if (!FORMATS[format]) throw new Error("Choose a supported animation format.");
  if (!Number.isInteger(fps) || fps < 1 || fps > 60) throw new Error("Frame rate must be between 1 and 60 fps.");
  if (!Number.isInteger(frameCount) || frameCount < 2 || frameCount > MAX_FRAMES) throw new Error(`Animation exports support 2–${MAX_FRAMES} frames.`);
  if (!(await ffmpegAvailable()) && format !== "pngSequence") throw new Error("FFmpeg was not found. PNG sequence export is still available.");

  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "toretto-export-"));
  const framesDirectory = path.join(directory, "frames");
  await fsp.mkdir(framesDirectory);
  const id = randomUUID();
  sessions.set(id, { id, directory, framesDirectory, format, fps, frameCount, received: new Set(), createdAt: Date.now() });
  sendJson(response, 200, { id });
}

async function receiveFrame(request, response, id, indexText) {
  const session = findSession(id);
  const index = Number(indexText);
  if (!Number.isInteger(index) || index < 0 || index >= session.frameCount) throw new Error("The frame index is outside this export.");
  const frame = await readBody(request, MAX_FRAME_BYTES);
  if (frame.length < 8 || frame.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error("The uploaded frame is not a PNG.");
  await fsp.writeFile(path.join(session.framesDirectory, `frame-${String(index).padStart(6, "0")}.png`), frame);
  session.received.add(index);
  sendJson(response, 200, { received: session.received.size });
}

async function finishSession(response, id) {
  const session = findSession(id);
  if (session.received.size !== session.frameCount) throw new Error(`Received ${session.received.size} of ${session.frameCount} frames.`);
  const definition = FORMATS[session.format];
  const filename = `toretto-animation-${new Date().toISOString().replace(/[:.]/g, "-")}.${definition.extension}`;
  const outputPath = path.join(session.directory, filename);

  if (session.format === "pngSequence") {
    const frameNames = [...session.received]
      .sort((left, right) => left - right)
      .map((index) => `frame-${String(index).padStart(6, "0")}.png`);
    await run("zip", ["-q", outputPath, ...frameNames], { cwd: session.framesDirectory });
  } else {
    await run("ffmpeg", ffmpegArguments(session, outputPath));
  }

  const stat = await fsp.stat(outputPath);
  response.statusCode = 200;
  response.setHeader("Content-Type", definition.mimeType);
  response.setHeader("Content-Length", String(stat.size));
  response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  const stream = fs.createReadStream(outputPath);
  stream.on("error", (error) => response.destroy(error));
  response.on("finish", () => void removeSession(session));
  response.on("close", () => void removeSession(session));
  stream.pipe(response);
}

export function videoExportPlugin() {
  return {
    name: "toretto-video-export",
    configureServer(server) {
      server.middlewares.use("/api/video-export", async (request, response) => {
        try {
          const url = new URL(request.url || "/", "http://127.0.0.1");
          const parts = url.pathname.split("/").filter(Boolean);
          if (request.method === "GET" && parts[0] === "capabilities") {
            sendJson(response, 200, { available: true, ffmpeg: await ffmpegAvailable(), formats: Object.keys(FORMATS) });
            return;
          }
          if (request.method === "POST" && parts[0] === "start") {
            await startSession(request, response);
            return;
          }
          if (request.method === "POST" && parts[0] === "frame" && parts.length === 3) {
            await receiveFrame(request, response, parts[1], parts[2]);
            return;
          }
          if (request.method === "POST" && parts[0] === "finish" && parts.length === 2) {
            await finishSession(response, parts[1]);
            return;
          }
          sendJson(response, 404, { error: "Export endpoint not found." });
        } catch (error) {
          sendJson(response, 422, { error: error instanceof Error ? error.message : "The animation could not be encoded." });
        }
      });
    },
  };
}
