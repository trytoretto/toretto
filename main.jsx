import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import { DemoSite } from "./DemoSite";
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
    <div className="imported-document" data-toretto-root="">
      <div className="imported-document-label" data-toretto-surface="">{label}</div>
      <div className="imported-document-content" dangerouslySetInnerHTML={{ __html: markup }} />
    </div>
  );
}

function SourceDialog({ onClose, onLoad, onDemo }) {
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
      const normalized = new URL(url.includes("://") ? url : `https://${url}`);
      const response = await fetch(normalized, { credentials: "omit" });
      if (!response.ok) throw new Error(`The site returned HTTP ${response.status}.`);
      importMarkup(await response.text(), normalized.hostname);
    } catch (nextError) {
      const detail = nextError instanceof Error ? nextError.message : "The website could not be loaded.";
      setError(`${detail} Many sites block browser-based imports; the extension will work directly on those pages.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="source-backdrop" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="source-dialog" role="dialog" aria-modal="true" aria-labelledby="source-title">
        <header><div><span>Scene source</span><h2 id="source-title">Load a DOM</h2></div><button type="button" onClick={onClose} aria-label="Close">×</button></header>
        <label><span>Website URL</span><div className="source-row"><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" /><button type="button" disabled={!url || loading} onClick={() => void importUrl()}>{loading ? "Loading…" : "Load URL"}</button></div></label>
        <p className="source-note">URL loading works when the site permits cross-origin requests. The browser extension will inspect arbitrary pages directly.</p>
        <div className="source-divider"><span>or paste HTML</span></div>
        <label><span>HTML</span><textarea value={markup} onChange={(event) => setMarkup(event.target.value)} spellCheck="false" /></label>
        {error && <p className="source-error" role="alert">{error}</p>}
        <footer><button type="button" className="source-secondary" onClick={() => { onDemo(); onClose(); }}>Use demo</button><button type="button" onClick={() => importMarkup(markup, "Imported HTML")}>Load HTML</button></footer>
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

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <TorettoApp />
  </React.StrictMode>,
);
