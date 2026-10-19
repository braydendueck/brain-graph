# Brain Graph (app)

Phone-friendly force-directed graph of Brayden's second brain.

- **This public repo** holds only the app shell (HTML/CSS/JS, icons, service worker).
- **Private data** lives in `braydendueck/brain-graph-data` (`graph.json` plus a read-only mirror of the brain folders).
- The phone pastes a fine-grained PAT with **Contents: Read** on `brain-graph-data` only. Token stays in `localStorage`.

Live: https://braydendueck.github.io/brain-graph/
