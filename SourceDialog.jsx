import React, { useRef, useState } from "react";
import { DemoSite } from "./DemoSite";
import { importHtmlPackage } from "./importHtmlPackage";
import { importPdfPackage } from "./importPdfPackage";

const BLOCKED_ELEMENTS = "script,style,iframe,frame,object,embed,link,meta,base,noscript";
const URL_ATTRIBUTES = new Set(["src", "srcset", "href", "action", "formaction", "poster", "data", "xlink:href"]);
const SECONDARY_BUTTON = "h-8 cursor-pointer rounded-md border border-white/10 bg-white/[0.025] px-3 text-[10px] font-medium text-[#a5afaa] transition-colors hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40";
const PRIMARY_BUTTON = "h-8 cursor-pointer rounded-md border border-[#66e4b3] bg-[#66e4b3] px-3 text-[10px] font-semibold text-[#102019] transition-colors hover:bg-[#8aefc8] disabled:cursor-not-allowed disabled:opacity-40";
const FIELD = "h-8 min-w-0 rounded-md border border-white/10 bg-[#0c100e] px-2.5 text-[10px] text-[#dce5e1] outline-none placeholder:text-[#55605b] focus:border-[#66e4b3]/50 focus:ring-2 focus:ring-[#66e4b3]/10";

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

function elementCount(markup) {
  if (!markup) return 176;
  return new DOMParser().parseFromString(markup, "text/html").body.querySelectorAll("*").length;
}

function SourceSection({ title, description, children, selected, onSelect, className = "" }) {
  return (
    <section className={`grid content-start gap-3 rounded-xl border p-4 transition-colors ${selected ? "border-[#66e4b3]/55 bg-[#66e4b3]/[0.035]" : "border-white/10 bg-white/[0.018]"} ${className}`} onPointerDown={onSelect}>
      <div className="grid gap-1">
        <div className="flex items-center justify-between gap-2">
          <h3 className="m-0 text-[11px] font-semibold text-[#e5ebe8]">{title}</h3>
          <span className={`size-2 rounded-full border ${selected ? "border-[#66e4b3] bg-[#66e4b3]" : "border-white/20"}`} aria-hidden="true" />
        </div>
        <p className="m-0 text-[9px] leading-4 text-[#6f7b75]">{description}</p>
      </div>
      {children}
    </section>
  );
}

function SourcePreview({ candidate }) {
  return (
    <div className="grid gap-4 p-5">
      <div className="source-preview-frame" aria-label={`${candidate.label} preview`}>
        {candidate.kind === "demo" ? (
          <div className="source-preview-scale"><DemoSite /></div>
        ) : (
          <iframe
            className="source-preview-scale border-0"
            title={`${candidate.label} preview`}
            sandbox=""
            srcDoc={`<!doctype html><html><head><meta charset="utf-8"></head><body>${candidate.markup}</body></html>`}
          />
        )}
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <strong className="text-[11px] font-semibold text-[#e5ebe8]">Ready to load</strong>
          <span className="max-w-xl break-all font-mono text-[9px] leading-4 text-[#718079]">{candidate.detail}</span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[9px] text-[#718079]">
          <span className="rounded-full border border-white/10 px-2 py-1 uppercase">{candidate.kind}</span>
          <span>{candidate.count.toLocaleString()} {candidate.count === 1 ? "element" : "elements"}</span>
        </div>
      </div>
      {candidate.warning && <p className="m-0 rounded-lg border border-[#7b6331] bg-[#302817] px-3 py-2 text-[9px] leading-4 text-[#e5c77d]">{candidate.warning}</p>}
    </div>
  );
}

export function SourceDialog({ onClose, onLoad, onDemo }) {
  const fileInputRef = useRef(null);
  const folderInputRef = useRef(null);
  const pdfInputRef = useRef(null);
  const [url, setUrl] = useState("");
  const [markup, setMarkup] = useState('<main style="padding:64px;font-family:system-ui"><h1>Hello, DOM.</h1><p>Every nested element is about to discover the z-axis.</p><section><button>Explode responsibly</button></section></main>');
  const [selectedKind, setSelectedKind] = useState("url");
  const [pendingFileCandidate, setPendingFileCandidate] = useState(null);
  const [candidate, setCandidate] = useState(null);
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState("");

  const makeCandidate = (next) => ({ ...next, count: next.count ?? elementCount(next.markup) });

  const showCandidate = (next) => {
    setCandidate(makeCandidate(next));
    setError("");
  };

  const prepareUrl = async () => {
    setPreparing("url");
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
      showCandidate({
        kind: "url",
        label: result.label,
        markup: result.markup,
        count: result.elementCount,
        detail: result.url,
        warning: result.truncated ? "The preview reached Toretto's 4,000-element capture limit." : "",
      });
    } catch (nextError) {
      const detail = nextError instanceof Error ? nextError.message : "The website could not be prepared.";
      setError(`${detail} Chromium captures public and local-development pages; the extension will capture signed-in pages.`);
    } finally {
      setPreparing("");
    }
  };

  const prepareMarkup = () => {
    try {
      const sanitized = sanitizeMarkup(markup);
      showCandidate({ kind: "html", label: "Imported HTML", markup: sanitized, detail: "Sanitized pasted HTML" });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "The HTML could not be prepared.");
    }
  };

  const prepareFiles = async (event, kind) => {
    const files = [...event.currentTarget.files];
    event.currentTarget.value = "";
    if (!files.length) return;
    setPreparing(kind);
    setError("");
    try {
      const imported = kind === "pdf" ? await importPdfPackage(files[0]) : await importHtmlPackage(files);
      setPendingFileCandidate(makeCandidate({
        kind,
        ...imported,
        detail: kind === "pdf"
          ? `${files[0].name} · faithful rendered page surface`
          : `${files.length.toLocaleString()} ${files.length === 1 ? "file" : "files"} in the imported package`,
      }));
      setSelectedKind("files");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : `The ${kind === "pdf" ? "PDF" : "HTML package"} could not be prepared.`);
    } finally {
      setPreparing("");
    }
  };

  const loadCandidate = () => {
    if (!candidate) return;
    if (candidate.kind === "demo") onDemo();
    else onLoad(candidate.markup, candidate.label);
    onClose();
  };

  const canPreview = !preparing && (
    (selectedKind === "url" && Boolean(url.trim()))
    || (selectedKind === "files" && Boolean(pendingFileCandidate))
    || (selectedKind === "html" && Boolean(markup.trim()))
    || selectedKind === "demo"
  );

  const previewSelected = () => {
    if (selectedKind === "url") void prepareUrl();
    if (selectedKind === "files" && pendingFileCandidate) showCandidate(pendingFileCandidate);
    if (selectedKind === "html") prepareMarkup();
    if (selectedKind === "demo") showCandidate({ kind: "demo", label: "Toretto demo", detail: "Built-in 1440 × 900 DOM specimen", count: 176 });
  };

  return (
    <div className="fixed inset-0 z-[1000] grid place-items-center bg-[#040706]/80 p-6 backdrop-blur-xl" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="max-h-[calc(100vh-48px)] w-full max-w-3xl overflow-auto rounded-2xl border border-white/10 bg-[#151a18] text-[#e9efec] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="source-title">
        <header className="sticky top-0 z-10 flex items-start justify-between border-b border-white/10 bg-[#151a18] px-5 py-4">
          <div>
            <span className="font-mono text-[9px] font-bold tracking-[0.12em] text-[#65dcae] uppercase">{candidate ? "Source preview" : "Scene source"}</span>
            <h2 className="mt-1 text-base font-semibold" id="source-title">{candidate ? candidate.label : "Open a scene"}</h2>
          </div>
          <button type="button" className="p-1 text-xl leading-none text-[#7e8984] hover:text-white" onClick={onClose} aria-label="Close">×</button>
        </header>

        {candidate ? <SourcePreview candidate={candidate} /> : (
          <div className="grid gap-3 p-5 md:grid-cols-2">
            <SourceSection title="URL" description="Render a public or local-development page in background Chromium." selected={selectedKind === "url"} onSelect={() => setSelectedKind("url")}>
              <div className="flex gap-2">
                <input className={`${FIELD} flex-1`} type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" />
              </div>
            </SourceSection>

            <SourceSection title="Files" description="Open saved HTML, a website package, or a rendered PDF." selected={selectedKind === "files"} onSelect={() => setSelectedKind("files")}>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={SECONDARY_BUTTON} disabled={Boolean(preparing)} onClick={() => fileInputRef.current?.click()}>HTML file…</button>
                <button type="button" className={SECONDARY_BUTTON} disabled={Boolean(preparing)} onClick={() => folderInputRef.current?.click()}>Website folder…</button>
                <button type="button" className={SECONDARY_BUTTON} disabled={Boolean(preparing)} onClick={() => pdfInputRef.current?.click()}>{preparing === "pdf" ? "Preparing…" : "PDF…"}</button>
              </div>
              {pendingFileCandidate && <span className="truncate font-mono text-[9px] text-[#77cfae]">{pendingFileCandidate.label}</span>}
              <input ref={fileInputRef} type="file" accept=".html,.htm,text/html" hidden onChange={(event) => void prepareFiles(event, "files")} />
              <input ref={folderInputRef} type="file" webkitdirectory="" multiple hidden onChange={(event) => void prepareFiles(event, "files")} />
              <input ref={pdfInputRef} type="file" accept=".pdf,application/pdf" hidden onChange={(event) => void prepareFiles(event, "pdf")} />
            </SourceSection>

            <SourceSection title="HTML" description="Paste a fragment or complete document. Scripts and remote URLs are removed." selected={selectedKind === "html"} onSelect={() => setSelectedKind("html")}>
              <textarea className="min-h-28 w-full resize-y rounded-md border border-white/10 bg-[#0c100e] p-2.5 font-mono text-[9px] leading-4 text-[#dce5e1] outline-none focus:border-[#66e4b3]/50" value={markup} onChange={(event) => setMarkup(event.target.value)} spellCheck="false" />
            </SourceSection>

            <SourceSection title="Demo" description="Return to Toretto's built-in telemetry dashboard specimen." selected={selectedKind === "demo"} onSelect={() => setSelectedKind("demo")}>
              <div className="source-demo-card" aria-hidden="true"><div className="source-demo-card-inner"><DemoSite /></div></div>
            </SourceSection>

            {error && <p className="m-0 rounded-lg border border-[#633c3c] bg-[#2b1d1c] px-3 py-2 text-[9px] leading-4 text-[#ffaaa5] md:col-span-2" role="alert">{error}</p>}
          </div>
        )}

        <footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-white/10 bg-[#151a18] px-5 py-3">
          <span className="text-[9px] text-[#68746e]">{candidate ? "Nothing changes until the source is loaded." : preparing ? "Preparing source preview…" : "Choose a source to preview it first."}</span>
          <div className="flex gap-2">
            {candidate ? <button type="button" className={SECONDARY_BUTTON} onClick={() => setCandidate(null)}>Back</button> : <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>Cancel</button>}
            <button type="button" className={PRIMARY_BUTTON} disabled={!candidate && !canPreview} onClick={candidate ? loadCandidate : previewSelected}>{candidate ? "Load" : preparing ? "Preparing…" : "Preview…"}</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
