const BLOCKED_ELEMENTS = "script,iframe,frame,object,embed,base,noscript";
const URL_ATTRIBUTES = ["src", "poster", "data", "href", "xlink:href"];

function normalizePath(path) {
  const parts = [];
  for (const part of decodeURIComponent(path).replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function pathForFile(file) {
  return normalizePath(file.webkitRelativePath || file.name);
}

function resolvePath(basePath, reference) {
  try {
    const resolved = new URL(reference, `https://local.toretto/${basePath}`);
    if (resolved.origin !== "https://local.toretto") return null;
    return normalizePath(resolved.pathname);
  } catch {
    return null;
  }
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

async function replaceAsync(value, expression, replacer) {
  const matches = [...value.matchAll(expression)];
  const replacements = await Promise.all(matches.map((match) => replacer(match)));
  let result = "";
  let cursor = 0;
  matches.forEach((match, index) => {
    result += value.slice(cursor, match.index) + replacements[index];
    cursor = match.index + match[0].length;
  });
  return result + value.slice(cursor);
}

function findFile(index, path) {
  const normalized = normalizePath(path);
  return index.get(normalized) || index.get(normalized.toLowerCase());
}

async function rewriteCss(css, basePath, fileIndex) {
  const withoutImports = css.replace(/@import\s+(?:url\()?\s*["']?[^;]+;?/gi, "");
  return replaceAsync(withoutImports, /url\(\s*(["']?)(.*?)\1\s*\)/gi, async (match) => {
    const reference = match[2].trim();
    if (/^data:/i.test(reference)) return `url("${reference}")`;
    const resolved = resolvePath(basePath, reference);
    const asset = resolved && findFile(fileIndex, resolved);
    return asset ? `url("${await fileAsDataUrl(asset)}")` : "url(\"\")";
  });
}

async function prepareDocument(htmlFile, files) {
  const htmlPath = pathForFile(htmlFile);
  const fileIndex = new Map();
  for (const file of files) {
    const path = pathForFile(file);
    fileIndex.set(path, file);
    fileIndex.set(path.toLowerCase(), file);
  }

  const parsed = new DOMParser().parseFromString(await htmlFile.text(), "text/html");
  parsed.querySelectorAll(BLOCKED_ELEMENTS).forEach((element) => element.remove());
  parsed.querySelectorAll("meta[http-equiv]").forEach((element) => element.remove());
  parsed.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      if (attribute.name.toLowerCase().startsWith("on") || attribute.name.toLowerCase() === "srcdoc") {
        element.removeAttribute(attribute.name);
      }
    });
  });

  for (const link of parsed.querySelectorAll('link[rel~="stylesheet"]')) {
    const resolved = resolvePath(htmlPath, link.getAttribute("href") || "");
    const stylesheet = resolved && findFile(fileIndex, resolved);
    if (!stylesheet) {
      link.remove();
      continue;
    }
    const style = parsed.createElement("style");
    style.textContent = await rewriteCss(await stylesheet.text(), resolved, fileIndex);
    link.replaceWith(style);
  }
  parsed.querySelectorAll("link").forEach((element) => element.remove());

  for (const style of parsed.querySelectorAll("style")) {
    style.textContent = await rewriteCss(style.textContent || "", htmlPath, fileIndex);
  }
  for (const element of parsed.querySelectorAll("[style]")) {
    element.setAttribute("style", await rewriteCss(element.getAttribute("style") || "", htmlPath, fileIndex));
  }

  for (const element of parsed.querySelectorAll("*")) {
    element.removeAttribute("srcset");
    element.removeAttribute("action");
    element.removeAttribute("formaction");
    if (element.tagName === "A") element.removeAttribute("href");
    for (const attribute of URL_ATTRIBUTES) {
      const reference = element.getAttribute(attribute);
      if (!reference) continue;
      if (/^data:/i.test(reference)) continue;
      const resolved = resolvePath(htmlPath, reference);
      const asset = resolved && findFile(fileIndex, resolved);
      if (asset) element.setAttribute(attribute, await fileAsDataUrl(asset));
      else element.removeAttribute(attribute);
    }
  }

  return `<!doctype html>${parsed.documentElement.outerHTML}`;
}

function copyComputedStyle(source, target) {
  const computed = getComputedStyle(source);
  let css = "";
  for (const property of computed) {
    css += `${property}:${computed.getPropertyValue(property)};`;
  }
  target.setAttribute("style", `${css}animation:none;transition:none;`);
}

async function freezeDocument(source) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-same-origin");
  Object.assign(iframe.style, {
    position: "fixed",
    left: "-200000px",
    top: "0",
    width: "1440px",
    height: "900px",
    border: "0",
    pointerEvents: "none",
  });
  document.body.append(iframe);

  try {
    const loaded = new Promise((resolve, reject) => {
      iframe.onload = resolve;
      iframe.onerror = () => reject(new Error("The HTML package could not be rendered."));
    });
    iframe.srcdoc = source;
    await loaded;
    const frameDocument = iframe.contentDocument;
    if (!frameDocument?.body) throw new Error("The HTML package did not contain a document body.");

    await Promise.all([...frameDocument.images].map((image) => (
      image.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
          image.onload = resolve;
          image.onerror = resolve;
        })
    )));
    if (frameDocument.fonts?.ready) {
      await frameDocument.fonts.ready.catch(() => {});
    }
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const sourceBody = frameDocument.body;
    const cloneBody = sourceBody.cloneNode(true);
    const sourceElements = [sourceBody, ...sourceBody.querySelectorAll("*")];
    const cloneElements = [cloneBody, ...cloneBody.querySelectorAll("*")];
    sourceElements.forEach((element, index) => copyComputedStyle(element, cloneElements[index]));
    cloneBody.querySelectorAll("style,link,script").forEach((element) => element.remove());

    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-imported-page", "");
    wrapper.setAttribute("style", cloneBody.getAttribute("style") || "");
    wrapper.innerHTML = cloneBody.innerHTML;
    return wrapper.outerHTML;
  } finally {
    iframe.remove();
  }
}

export async function importHtmlPackage(fileList) {
  const files = [...fileList];
  const htmlFiles = files.filter((file) => /\.html?$/i.test(file.name) || file.type === "text/html");
  if (!htmlFiles.length) throw new Error("No .html or .htm document was found.");
  const htmlFile = htmlFiles.sort((a, b) => pathForFile(a).length - pathForFile(b).length)[0];
  const prepared = await prepareDocument(htmlFile, files);
  return { markup: await freezeDocument(prepared), label: htmlFile.name };
}
