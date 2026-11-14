// Writes the deck's theme (colour scheme and fonts) into the generated .pptx, so placeholders and
// theme colours (accent1..6, lt2, dk2 …) render in the Covered palette in PowerPoint, Keynote and PDF export.
//   APPLY_THEME=./apply_theme.js node build.js <shots> <out.pptx>
const fs = require("node:fs");
const JSZip = require("jszip");

const KEYS = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];

async function applyTheme(file, theme) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const themes = Object.keys(zip.files).filter((n) => /^ppt\/theme\/theme\d+\.xml$/.test(n));
  for (const name of themes) {
    let xml = await zip.file(name).async("string");
    for (const key of KEYS) {
      const hex = theme.colors[key];
      if (!hex) continue;
      const re = new RegExp(`<a:${key}>[\\s\\S]*?</a:${key}>`);
      xml = xml.replace(re, `<a:${key}><a:srgbClr val="${hex}"/></a:${key}>`);
    }
    xml = xml.replace(/(<a:clrScheme name=")[^"]*"/, `$1${theme.name}"`);
    xml = xml.replace(/(<a:majorFont>\s*<a:latin typeface=")[^"]*"/, `$1${theme.headFontFace}"`);
    xml = xml.replace(/(<a:minorFont>\s*<a:latin typeface=")[^"]*"/, `$1${theme.bodyFontFace}"`);
    zip.file(name, xml);
  }
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

module.exports = { applyTheme };
