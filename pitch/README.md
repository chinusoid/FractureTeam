# Pitch deck

`covered-pitch.pdf` is the submitted deck (10 slides); `covered-pitch.pptx` has the speaker notes with timings for the 5-minute pitch. Every number in it is traced to its source or to a reproducible run in [docs/evidence.md](../docs/evidence.md).

The deck is generated from code, so the screenshots always come from the product as it is:

```sh
# 1. Screenshots of the live product's elements (needs a running app with AI_PROVIDER=own QUOTA_MODE=memory)
node build/capture.mjs ../app http://localhost:3000 build/shots
# 2. The deck (npm install pptxgenjs sharp react react-dom react-icons jszip in a scratch folder first)
PROD_URL=https://covered-fracture.vercel.app APPLY_THEME=./build/apply_theme.js node build/build.js build/shots covered-pitch.pptx
soffice --headless --convert-to pdf covered-pitch.pptx
```
