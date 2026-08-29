# Toretto

Drive through the DOM in three dimensions.

Toretto turns an HTML document into an explorable spatial scene. Orbit, pan, roll, zoom, and separate nested elements along the z-axis without changing the source document's layout.

This repository currently contains the standalone proof of concept. The reusable engine and browser extension will be extracted as the project evolves.

Use **Source…** to paste HTML or attempt a URL import. Submitted HTML is sanitized and never executes scripts. Direct URL imports are limited by the target site's cross-origin policy; the planned browser extension will operate on the current page without that restriction.

## Development

```sh
npm install
npm run dev
```

Build the production bundle with `npm run build`.

## Contributing and security

Contributions are welcome under the [contribution guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md). Report vulnerabilities through the private process in [SECURITY.md](SECURITY.md).

Toretto is available under the [MIT License](LICENSE).
