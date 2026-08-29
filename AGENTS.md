# Toretto contributor guidance

## Architecture

- Keep DOM indexing, depth calculation, camera state, and animation state in a reusable engine independent from React application chrome.
- Keep the standalone app and browser extension as adapters around the same engine and serialized scene contracts.
- Keep imported documents isolated from Toretto controls and never depend on demo-specific selectors in engine code.

## Privacy and security

- Treat inspected DOM contents, URLs, form values, authentication state, screenshots, and exported scenes as sensitive.
- Never execute scripts, inline event handlers, active embeds, forms, or network-loading attributes from imported HTML.
- Browser-extension permissions must be narrow, explained, and requested only when the corresponding feature needs them.
- Do not log page contents or transmit them off-device without an explicit user action.

## Interaction and rendering

- Preserve the source document's layout at zero explosion.
- Keep orbit, pan, roll, zoom, lens, and explosion seekable and deterministic so they can become animation tracks.
- Respect source stacking contexts where possible, and document visualization heuristics that intentionally differ from browser paint order.
- Verify visual changes in both flat and exploded states at more than one viewport size.

## Quality

- Add focused regression coverage for imported-content safety, camera input, stacking behavior, and animation serialization.
- Run `npm run build` before opening a pull request.
- Do not commit generated builds, credentials, private browsing data, or local development artifacts.
