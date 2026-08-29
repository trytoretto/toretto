import * as pdfjs from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const MAX_RENDER_WIDTH = 2400;

function canvasAsDataUrl(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("A PDF page could not be rendered."));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error("A PDF page could not be encoded."));
      reader.readAsDataURL(blob);
    }, "image/png");
  });
}

export async function importPdfPackage(file) {
  const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    const renderScale = Math.min(3, MAX_RENDER_WIDTH / baseViewport.width);
    const renderViewport = page.getViewport({ scale: renderScale });
    const canvas = window.document.createElement("canvas");
    canvas.width = Math.ceil(renderViewport.width);
    canvas.height = Math.ceil(renderViewport.height);
    const context = canvas.getContext("2d", { alpha: true });
    await page.render({ canvasContext: context, viewport: renderViewport }).promise;
    pages.push({
      dataUrl: await canvasAsDataUrl(canvas),
      width: baseViewport.width,
      height: baseViewport.height,
      pageNumber,
    });
    page.cleanup();
  }

  const maxWidth = Math.max(...pages.map((page) => page.width));
  const scale = Math.min(1, 1320 / maxWidth);
  const markup = pages.map((page) => (
    `<figure data-pdf-page="${page.pageNumber}" style="position:relative;margin:0;width:${(page.width * scale).toFixed(2)}px;height:${(page.height * scale).toFixed(2)}px;background:white;box-shadow:0 12px 40px rgba(0,0,0,.28)">`
      + `<img src="${page.dataUrl}" alt="PDF page ${page.pageNumber}" style="display:block;width:100%;height:100%;object-fit:fill">`
      + "</figure>"
  )).join("");

  return {
    markup: `<div data-imported-pdf="" style="display:flex;flex-direction:column;align-items:center;gap:32px;padding:32px;background:#272b29">${markup}</div>`,
    label: `${file.name} · ${document.numPages} ${document.numPages === 1 ? "page" : "pages"}`,
  };
}
