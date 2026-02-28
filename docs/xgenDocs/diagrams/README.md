Diagrams source and generation

This folder contains mermaid source files (`*.mmd`) used to render diagrams embedded in the documentation. The recommended workflow is:

1. Install the mermaid CLI (locally or globally):
   - Local (recommended): `npm install --save-dev @mermaid-js/mermaid-cli`
   - Global: `npm install -g @mermaid-js/mermaid-cli`

2. Render the diagrams to SVG in `docs/images`:

   npx mmdc -i docs/diagrams/trace-hierarchy.mmd -o docs/images/trace-hierarchy.svg -b transparent
   npx mmdc -i docs/diagrams/baseline-calculation.mmd -o docs/images/baseline-calculation.svg -b transparent

3. (Optional) Generate all diagrams with the convenience npm script:
   - `npm run render:diagrams` (requires Node >= 14)
5. One-command export (recommended):
   - `npm run docs:build` will render diagrams, create `docs/traces-and-anomaly.html` and `docs/traces-and-anomaly.pdf` in a single step.
4. Convert markdown to HTML/PDF (two simple options):

  Option A (Pandoc → Chrome for PDF):
    - `pandoc docs/TRACES-AND-ANOMALY-MONITORING.md -o docs/traces-and-anomaly.html --standalone`
    - Serve and print with Chrome headless: `npx http-server . -p 8000` then `chrome --headless --disable-gpu --print-to-pdf=docs/traces-and-anomaly.pdf http://localhost:8000/docs/traces-and-anomaly.html`

  Option B (md-to-pdf):
    - `npm i -g md-to-pdf`
    - `md-to-pdf docs/TRACES-AND-ANOMALY-MONITORING.md --output docs/traces-and-anomaly.pdf`

Notes:
- The easiest interactive option is using VS Code Markdown Preview (or the Markdown Preview Enhanced extension) to export to PDF and it will render mermaid natively.
- The `scripts/render-diagrams.js` helper uses `npx mmdc` so you don't need a global install; run `npm run render:diagrams` to render all `.mmd` files to `docs/images/`.
