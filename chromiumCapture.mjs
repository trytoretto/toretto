import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import puppeteer from "puppeteer-core";

const CHROME_PATHS = [
  process.env.TORETTO_CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);
const MAX_RESOURCE_BYTES = 10 * 1024 * 1024;
const MAX_ELEMENTS = 4000;
const TORETTO_PORT = String(process.env.TORETTO_PORT || 4178);
const CAPTURE_STYLES = [
  "align-content", "align-items", "align-self", "background", "background-color", "background-image",
  "background-position", "background-repeat", "background-size", "border", "border-block", "border-color",
  "border-image", "border-inline", "border-radius", "border-style", "border-width", "bottom", "box-shadow",
  "box-sizing", "clear", "clip", "clip-path", "color", "column-count", "column-gap", "content", "cursor",
  "direction", "display", "filter", "flex", "flex-basis", "flex-direction", "flex-flow", "flex-grow",
  "flex-shrink", "flex-wrap", "float", "font", "font-family", "font-feature-settings", "font-kerning",
  "font-optical-sizing", "font-size", "font-stretch", "font-style", "font-variant", "font-weight", "gap",
  "grid", "grid-area", "grid-auto-columns", "grid-auto-flow", "grid-auto-rows", "grid-column", "grid-row",
  "grid-template", "height", "inset", "isolation", "justify-content", "justify-items", "justify-self", "left",
  "letter-spacing", "line-height", "list-style", "margin", "mask", "max-height", "max-width", "min-height",
  "min-width", "mix-blend-mode", "object-fit", "object-position", "opacity", "order", "outline", "overflow",
  "overflow-wrap", "overflow-x", "overflow-y", "padding", "perspective", "perspective-origin", "place-content",
  "place-items", "place-self", "pointer-events", "position", "right", "row-gap", "table-layout", "text-align",
  "text-decoration", "text-indent", "text-overflow", "text-shadow", "text-transform", "top", "transform",
  "transform-origin", "transform-style", "unicode-bidi", "vertical-align", "visibility", "white-space", "width",
  "word-break", "word-spacing", "writing-mode", "z-index",
];
let browserPromise;

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc")
    || normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

function isTorettoOrigin(url) {
  return new Set(["localhost", "127.0.0.1", "::1", "[::1]"]).has(url.hostname)
    && String(url.port || (url.protocol === "https:" ? 443 : 80)) === TORETTO_PORT;
}

async function inspectUrl(value) {
  const url = new URL(value);
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("Only HTTP and HTTPS URLs can be rendered.");
  if (isTorettoOrigin(url)) throw new Error("Toretto cannot capture its own studio URL.");
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length) throw new Error(`Could not resolve ${url.hostname}.`);
  return { url, isPrivate: addresses.some(({ address }) => isPrivateIp(address)) };
}

function chromeExecutable() {
  const executable = CHROME_PATHS.find((candidate) => fs.existsSync(candidate));
  if (!executable) throw new Error("Chrome or Chromium was not found. Set TORETTO_CHROME_PATH to its executable.");
  return executable;
}

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: chromeExecutable(),
      headless: true,
      args: ["--disable-background-networking", "--disable-breakpad", "--disable-sync"],
    }).catch((error) => {
      browserPromise = undefined;
      throw error;
    });
  }
  return browserPromise;
}

async function responseAsResource(response) {
  try {
    const headers = response.headers();
    const contentType = String(headers["content-type"] || "").split(";")[0].trim();
    if (!/^(image|font)\//.test(contentType) && !/font|svg/.test(contentType)) return null;
    const declaredSize = Number(headers["content-length"] || 0);
    if (declaredSize > MAX_RESOURCE_BYTES) return null;
    const buffer = await response.buffer();
    if (!buffer.length || buffer.length > MAX_RESOURCE_BYTES) return null;
    return [response.url(), `data:${contentType || "application/octet-stream"};base64,${buffer.toString("base64")}`];
  } catch {
    return null;
  }
}

export async function captureRenderedUrl(value) {
  const requested = await inspectUrl(value);
  const requestedUrl = requested.url;
  const browser = await getBrowser();
  const page = await browser.newPage();
  const checkedHosts = new Map();
  const requestIsPublic = async (requestUrl) => {
    const url = new URL(requestUrl);
    if (url.protocol === "data:" || url.protocol === "blob:") return true;
    if (!new Set(["http:", "https:"]).has(url.protocol)) return false;
    if (isTorettoOrigin(url)) return false;
    if (requested.isPrivate) return true;
    if (!checkedHosts.has(url.hostname)) {
      checkedHosts.set(url.hostname, inspectUrl(url.href).then((result) => !result.isPrivate).catch(() => false));
    }
    return checkedHosts.get(url.hostname);
  };
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    void requestIsPublic(request.url()).then((allowed) => {
      if (request.isInterceptResolutionHandled()) return;
      if (allowed) void request.continue().catch(() => {});
      else void request.abort("blockedbyclient").catch(() => {});
    }).catch(() => {});
  });
  const resources = {};
  page.on("response", (response) => {
    void responseAsResource(response).then((resource) => {
      if (resource) resources[resource[0]] = resource[1];
    });
  });

  try {
    await page.goto(requestedUrl.href, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForNetworkIdle({ idleTime: 700, timeout: 12000 }).catch(() => {});
    const finalTarget = await inspectUrl(page.url());
    if (!requested.isPrivate && finalTarget.isPrivate) {
      throw new Error("A public URL cannot redirect into the local network.");
    }
    const finalUrl = finalTarget.url;
    await page.evaluate(async () => {
      const ready = Promise.all([
        document.fonts?.ready,
        ...[...document.images].filter((image) => !image.loading || image.loading === "eager")
          .map((image) => image.decode?.().catch(() => {})),
      ]);
      await Promise.race([ready, new Promise((resolve) => setTimeout(resolve, 5000))]);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const result = await page.evaluate(({ resourceMap, maxElements, capturedStyles }) => {
      const blocked = "script,iframe,frame,object,embed,base,noscript,link,meta";
      const sourceBody = document.body;
      const sourceElements = [sourceBody, ...sourceBody.querySelectorAll("*")].slice(0, maxElements);
      const cloneBody = sourceBody.cloneNode(true);
      const cloneElements = [cloneBody, ...cloneBody.querySelectorAll("*")].slice(0, maxElements);
      const replaceResources = (value) => {
        let output = String(value || "");
        for (const [url, dataUrl] of Object.entries(resourceMap)) output = output.split(url).join(dataUrl);
        return output
          .replace(/url\(\s*["']?#.+?["']?\s*\)/gi, "none")
          .replace(/url\(\s*(["']?)https?:[^)'\"]+\1\s*\)/gi, "none");
      };
      const pseudoContent = (computed) => {
        const value = computed.content;
        if (!value || value === "none" || value === "normal") return "";
        return value.replace(/^(["'])(.*)\1$/, "$2");
      };
      const copyPseudo = (source, target, selector) => {
        const computed = getComputedStyle(source, selector);
        const content = pseudoContent(computed);
        if (!content) return;
        const pseudo = document.createElement("span");
        pseudo.textContent = content;
        pseudo.setAttribute("data-toretto-pseudo", selector);
        let css = "";
        for (const property of capturedStyles) css += `${property}:${replaceResources(computed.getPropertyValue(property))};`;
        pseudo.setAttribute("style", `${css}animation:none;transition:none;`);
        if (selector === "::before") target.prepend(pseudo);
        else target.append(pseudo);
      };

      sourceElements.forEach((source, index) => {
        const target = cloneElements[index];
        if (!target) return;
        const computed = getComputedStyle(source);
        let css = "";
        for (const property of capturedStyles) css += `${property}:${replaceResources(computed.getPropertyValue(property))};`;
        target.setAttribute("style", `${css}animation:none;transition:none;caret-color:transparent;`);
        [...target.attributes].forEach((attribute) => {
          const name = attribute.name.toLowerCase();
          if (name.startsWith("on") || ["srcdoc", "action", "formaction"].includes(name)) target.removeAttribute(attribute.name);
        });
        if (source instanceof HTMLImageElement) {
          const safeSource = resourceMap[source.currentSrc]
            || (/^data:/i.test(source.currentSrc) ? source.currentSrc : "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=");
          target.setAttribute("src", safeSource);
        }
        if (source instanceof HTMLVideoElement) {
          const placeholder = document.createElement("div");
          placeholder.setAttribute("style", target.getAttribute("style") || "");
          placeholder.setAttribute("aria-hidden", "true");
          placeholder.setAttribute("data-video-placeholder", "");
          target.replaceWith(placeholder);
        }
        if (source instanceof HTMLSourceElement) {
          target.removeAttribute("src");
          target.removeAttribute("srcset");
        }
        if (source instanceof SVGImageElement) {
          target.removeAttribute("href");
          target.removeAttribute("xlink:href");
        }
        if (source instanceof HTMLAnchorElement && /^https?:$/i.test(new URL(source.href).protocol)) {
          target.setAttribute("href", source.href);
          target.setAttribute("target", "_blank");
          target.setAttribute("rel", "noopener noreferrer");
        }
        if (source instanceof HTMLInputElement) target.setAttribute("value", source.value);
        if (source instanceof HTMLTextAreaElement) target.textContent = source.value;
        if (source instanceof HTMLCanvasElement) {
          try {
            const image = document.createElement("img");
            image.src = source.toDataURL("image/png");
            image.setAttribute("style", target.getAttribute("style") || "");
            target.replaceWith(image);
          } catch {
            const placeholder = document.createElement("div");
            placeholder.setAttribute("style", target.getAttribute("style") || "");
            placeholder.setAttribute("aria-hidden", "true");
            placeholder.setAttribute("data-canvas-placeholder", "");
            target.replaceWith(placeholder);
          }
        } else {
          copyPseudo(source, target, "::before");
          copyPseudo(source, target, "::after");
        }
      });
      cloneBody.querySelectorAll(blocked).forEach((element) => element.remove());
      cloneBody.querySelectorAll("[srcset]").forEach((element) => element.removeAttribute("srcset"));
      const wrapper = document.createElement("div");
      wrapper.setAttribute("data-rendered-page", "");
      wrapper.setAttribute("style", cloneBody.getAttribute("style") || "");
      wrapper.innerHTML = cloneBody.innerHTML;
      return { markup: wrapper.outerHTML, title: document.title, elementCount: sourceElements.length };
    }, { resourceMap: resources, maxElements: MAX_ELEMENTS, capturedStyles: CAPTURE_STYLES });

    return {
      ...result,
      label: result.title || finalUrl.hostname,
      url: finalUrl.href,
      truncated: result.elementCount >= MAX_ELEMENTS,
    };
  } finally {
    await page.close();
  }
}

export function chromiumCapturePlugin() {
  return {
    name: "toretto-chromium-capture",
    configureServer(server) {
      server.middlewares.use("/api/render-url", async (request, response) => {
        if (request.method !== "POST") {
          response.statusCode = 405;
          response.end("Method not allowed");
          return;
        }
        try {
          let body = "";
          for await (const chunk of request) {
            body += chunk;
            if (body.length > 65536) throw new Error("The request was too large.");
          }
          const { url } = JSON.parse(body);
          const result = await captureRenderedUrl(url);
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify(result));
        } catch (error) {
          response.statusCode = 422;
          response.setHeader("Content-Type", "application/json; charset=utf-8");
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : "The page could not be rendered." }));
        }
      });
    },
  };
}
