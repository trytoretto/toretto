# Toretto

Drive through the DOM in three dimensions.

Toretto turns an HTML document into an explorable spatial scene. Orbit, pan, roll, zoom, and separate nested elements along the z-axis without changing the source document's layout.

This repository currently contains the standalone proof of concept. The reusable engine and browser extension will be extracted as the project evolves.

Use **Source…** to paste HTML, open a saved website package, import a PDF, or render a public or local-development URL through a background Chromium session. Submitted HTML is sanitized and never executes scripts. PDF pages currently import as faithful visual planes. Public pages cannot pull private-network subresources into a snapshot, and Toretto blocks capture of its own studio URL. The planned browser extension will capture live and signed-in pages directly.

## Development

```sh
npm install
npm run dev
```

Build the production bundle with `npm run build`.

## Contributing and security

Contributions are welcome under the [contribution guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md).

Toretto is available under the [MIT License](LICENSE).
