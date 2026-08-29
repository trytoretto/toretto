# Toretto

Drive through the DOM in three dimensions.

Toretto turns an HTML document into an explorable spatial scene. Orbit, pan, roll, zoom, and separate nested elements along the z-axis without changing the source document's layout.

This repository currently contains the standalone proof of concept. The reusable engine and browser extension will be extracted as the project evolves.

Use **Open…** to preview and load pasted HTML, a saved website package, a PDF, the built-in demo, or a public or local-development URL rendered through background Chromium. Submitted HTML is sanitized and never executes scripts. PDF pages currently import as faithful visual planes. Public pages cannot pull private-network subresources into a snapshot, and Toretto blocks capture of its own studio URL. The planned browser extension will capture live and signed-in pages directly.

For loaded pages, **Canvas** is the default navigation target. The wheel zooms the Canvas (up/in, down/out), Shift-wheel pans it, and ⌘/Ctrl-wheel temporarily scrolls the page. Select **Page** to make ordinary wheel gestures scroll the page persistently. Captured links remain clickable and open safely in a new tab; dragging elsewhere continues to manipulate the Canvas.

## Runtime direction

The standalone studio and browser extension are complementary rather than competing implementations:

- The extension attaches the spatial engine to the live DOM already rendered by Chromium. It preserves authentication, JavaScript state, media, fonts, scrolling, responsive layout, and browser DevTools semantics.
- The studio loads frozen Chromium snapshots, saved HTML packages, pasted markup, and PDFs. It owns deterministic export, scene authoring, animation, timelines, and portable project files.
- A shared scene core should own DOM indexing, stacking-context analysis, depth assignment, camera state, keyframes, and export contracts. Adapters should only provide a live DOM or frozen document surface.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the proposed boundary.

## Development

```sh
npm install
npm run dev
```

Build the production bundle with `npm run build`.

## Contributing and security

Contributions are welcome under the [contribution guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md).

Toretto is available under the [MIT License](LICENSE).
