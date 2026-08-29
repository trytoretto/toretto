import React, { useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { DemoSite } from "./DemoSite";
import { importHtmlPackage } from "./importHtmlPackage";
import { importPdfPackage } from "./importPdfPackage";
import { Spatializer } from "./Spatializer";
import "./demo.css";
import "./spatializer.css";

document.documentElement.dataset.theme = "dark";

const BLOCKED_ELEMENTS = "script,style,iframe,frame,object,embed,link,meta,base,noscript";
const URL_ATTRIBUTES = new Set(["src", "srcset", "href", "action", "formaction", "poster", "data", "xlink:href"]);

function sanitizeMarkup(markup) {
  const parsed = new DOMParser().parseFromString(markup, "text/html");
  parsed.querySelectorAll(BLOCKED_ELEMENTS).forEach((element) => element.remove());
  parsed.querySelectorAll("*").forEach((element) => {
    [...element.attributes].forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || URL_ATTRIBUTES.has(name)) element.removeAttribute(attribute.name);
      if (name === "style" && /url\s*\(|expression\s*\(|@import/i.test(attribute.value)) element.removeAttribute(attribute.name);
    });
  });
  const content = parsed.body.innerHTML.trim();
  if (!content) throw new Error("No displayable HTML was found.");
  return content;
}

function ImportedDocument({ markup, label }) {
  return (
    <div className="imported-document" data-toretto-root="" aria-label={label}>
      <div className="imported-document-content" dangerouslySetInnerHTML={{ __html: markup }} />
    </div>
  );
}

function SourceDialog({ onClose, onLoad, onDemo }) {
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const pdfInputRef = useRef(null);
  const [url, setUrl] = useState("");
  const [markup, setMarkup] = useState('<main style="padding: 64px; font-family: system-ui"><h1>Hello, DOM.</h1><p>Every nested element is about to discover the z-axis.</p><section><button>Explode responsibly</button></section></main>');
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const importMarkup = (html, label) => {
    try {
      onLoad(sanitizeMarkup(html), label);
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The HTML could not be loaded.");
    }
  };

  const importUrl = async () => {
    setLoading(true);
    setError("");
    try {
      const localHost = /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)(?::|\/|$)/i.test(url.trim());
      const normalized = new URL(url.includes("://") ? url : `${localHost ? "http" : "https"}://${url}`);
      const response = await fetch("/api/render-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: normalized.href }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `The renderer returned HTTP ${response.status}.`);
      onLoad(result.markup, result.label);
      onClose();
    } catch (nextError) {
      const detail = nextError instanceof Error ? nextError.message : "The website could not be loaded.";
      setError(`${detail} Chromium captures public and local-development pages; the extension will capture signed-in pages.`);
    } finally {
      setLoading(false);
    }
  };

  const importPdf = async (event) => {
    const [file] = event.currentTarget.files;
    event.currentTarget.value = "";
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const imported = await importPdfPackage(file);
      onLoad(imported.markup, imported.label);
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The PDF could not be opened.");
    } finally {
      setLoading(false);
    }
  };

  const importFiles = async (event) => {
    const files = [...event.currentTarget.files];
    event.currentTarget.value = "";
    if (!files.length) return;
    setLoading(true);
    setError("");
    try {
      const imported = await importHtmlPackage(files);
      onLoad(imported.markup, imported.label);
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The HTML file could not be opened.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="source-backdrop" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="source-dialog" role="dialog" aria-modal="true" aria-labelledby="source-title">
        <header><div><span>Scene source</span><h2 id="source-title">Load a DOM</h2></div><button type="button" onClick={onClose} aria-label="Close">×</button></header>
        <label><span>Website URL</span><div className="source-row"><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" /><button type="button" disabled={!url || loading} onClick={() => void importUrl()}>{loading ? "Loading…" : "Load URL"}</button></div></label>
        <p className="source-note">Public and local-development URLs render in a background Chromium session. Toretto blocks self-capture; the extension will capture signed-in pages.</p>
        <div className="source-file source-file-actions"><button type="button" className="source-secondary" disabled={loading} onClick={() => fileInputRef.current?.click()}>Open HTML file…</button><button type="button" className="source-secondary" disabled={loading} onClick={() => folderInputRef.current?.click()}>Open website folder…</button><button type="button" className="source-secondary" disabled={loading} onClick={() => pdfInputRef.current?.click()}>Open PDF…</button><span>HTML packages preserve structure; PDFs preserve the rendered page.</span><input ref={fileInputRef} type="file" accept=".html,.htm,text/html" hidden onChange={(event) => void importFiles(event)} /><input ref={folderInputRef} type="file" webkitdirectory="" multiple hidden onChange={(event) => void importFiles(event)} /><input ref={pdfInputRef} type="file" accept=".pdf,application/pdf" hidden onChange={(event) => void importPdf(event)} /></div>
        <div className="source-divider"><span>or paste HTML</span></div>
        <label><span>HTML</span><textarea value={markup} onChange={(event) => setMarkup(event.target.value)} spellCheck="false" /></label>
        {error && <p className="source-error" role="alert">{error}</p>}
        <footer><button type="button" className="source-secondary" onClick={() => { onDemo(); onClose(); }}>Use demo</button><div className="source-footer-actions"><button type="button" className="source-secondary" onClick={onClose}>Cancel</button><button type="button" onClick={() => importMarkup(markup, "Imported HTML")}>Load HTML</button></div></footer>
      </section>
    </div>
  );
}

function TorettoApp() {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [imported, setImported] = useState(null);
  return (
    <>
      <Spatializer onOpenSource={() => setSourceOpen(true)}>
        {imported ? <ImportedDocument markup={imported.markup} label={imported.label} /> : <DemoSite />}
      </Spatializer>
      {sourceOpen && <SourceDialog onClose={() => setSourceOpen(false)} onDemo={() => setImported(null)} onLoad={(markup, label) => setImported({ markup, label })} />}
    </>
  );
}

const rootElement = document.getElementById("root");
const appRoot = import.meta.hot?.data.appRoot || ReactDOM.createRoot(rootElement);
if (import.meta.hot) import.meta.hot.data.appRoot = appRoot;

appRoot.render(
  <React.StrictMode>
    <TorettoApp />
  </React.StrictMode>,
);
