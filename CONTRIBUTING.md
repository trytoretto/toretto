# Contributing to Toretto

Thank you for helping make the DOM navigable.

## Start with the user outcome

For substantial changes, open or comment on an issue before investing in an implementation. Describe the problem, observable outcome, and acceptance criteria. Small fixes and documentation improvements can go directly to a pull request.

Security vulnerabilities must follow [SECURITY.md](SECURITY.md), not the public issue tracker.

## Development setup

Use a current Node.js LTS release.

```sh
npm ci
npm run dev
```

## Design and implementation rules

- Keep the spatial engine independent from the standalone and extension surfaces.
- Preserve source-page behavior and never execute imported scripts.
- Treat inspected page contents, URLs, form values, and browsing state as private data.
- Keep cross-browser differences explicit and provide graceful failure paths.
- Add regression coverage for unsafe imports and camera or stacking bugs.
- Avoid dependencies when a small, well-tested platform implementation is sufficient.

## Pull requests

- Create a short-lived branch from `main`.
- Keep each pull request focused enough to review and revert.
- Explain user-visible behavior and important implementation choices.
- Identify permission changes, new network access, and new dependencies.
- Include screenshots or recordings for visible interface changes.
- Do not commit secrets, private browsing data, generated builds, or local development artifacts.

AI-assisted contributions are welcome, but the submitter remains responsible for understanding and testing the resulting code.

By contributing, you agree that your contribution is licensed under the repository's [MIT License](LICENSE).
