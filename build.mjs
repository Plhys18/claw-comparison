import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MMDC = join(__dirname, 'node_modules/.bin/mmdc');
const INPUT = join(__dirname, 'report.md');
const IMGS = join(__dirname, 'imgs');
const OUT_MD = join(__dirname, 'report-rendered.md');
const OUT_HTML = join(__dirname, 'report-rendered.html');
const OUT_PDF = join(__dirname, 'NanoClaw-vs-OpenClaw.pdf');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (!existsSync(IMGS)) mkdirSync(IMGS);

// ── Step 1: Render each mermaid block to PNG ──────────────────────────────────
let md = readFileSync(INPUT, 'utf8');
let diagramIndex = 0;

md = md.replace(/```mermaid\n([\s\S]*?)```/g, (_, diagram) => {
  const id = `diagram-${++diagramIndex}`;
  const mmdFile = join(IMGS, `${id}.mmd`);
  const pngFile = join(IMGS, `${id}.png`);

  writeFileSync(mmdFile, diagram.trim());

  try {
    execSync(
      `"${MMDC}" -i "${mmdFile}" -o "${pngFile}" -b white -w 1400 --quiet`,
      { stdio: 'pipe' }
    );
    console.log(`  ✓ Rendered ${id}`);
  } catch (e) {
    console.error(`  ✗ Failed ${id}:\n${e.stderr?.toString()}`);
    return `\`\`\`\n${diagram}\`\`\``;
  }

  return `![${id}](imgs/${id}.png)`;
});

writeFileSync(OUT_MD, md);
console.log(`\n${diagramIndex} diagrams rendered.\n`);

// ── Step 2: pandoc markdown → standalone HTML ─────────────────────────────────
console.log('Converting to HTML...');
execSync(
  `pandoc "${OUT_MD}" -o "${OUT_HTML}" \
    --standalone \
    --metadata title="NanoClaw vs OpenClaw — Architecture Comparison" \
    -V "margin-top=20mm" \
    --css="" \
    --highlight-style=tango`,
  { stdio: 'inherit', cwd: __dirname }
);

// Inject print-friendly CSS into the HTML
let html = readFileSync(OUT_HTML, 'utf8');
const style = `
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         font-size: 13px; line-height: 1.6; color: #1a1a1a;
         max-width: 960px; margin: 0 auto; padding: 20px 40px; }
  h1 { font-size: 2em; border-bottom: 3px solid #333; padding-bottom: 8px; }
  h2 { font-size: 1.4em; border-bottom: 1px solid #ccc; margin-top: 2em; }
  h3 { font-size: 1.1em; color: #333; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 12px; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
  th { background: #f0f0f0; font-weight: 600; }
  tr:nth-child(even) { background: #fafafa; }
  img { max-width: 100%; height: auto; display: block; margin: 1em auto; border: 1px solid #ddd; border-radius: 4px; }
  code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; font-size: 0.88em; }
  pre { background: #f4f4f4; padding: 12px; border-radius: 4px; overflow-x: auto; }
  blockquote { border-left: 4px solid #ccc; margin: 0; padding-left: 16px; color: #555; }
  @media print { body { max-width: 100%; padding: 0; } img { page-break-inside: avoid; } }
</style>
`;
html = html.replace('</head>', style + '</head>');
writeFileSync(OUT_HTML, html);

// ── Step 3: Chrome headless → PDF ────────────────────────────────────────────
console.log('Printing to PDF with Chrome headless...');
execSync(
  `"${CHROME}" \
    --headless=new \
    --disable-gpu \
    --no-sandbox \
    --print-to-pdf="${OUT_PDF}" \
    --print-to-pdf-no-header \
    --no-pdf-header-footer \
    "file://${OUT_HTML}" 2>/dev/null`,
  { stdio: 'inherit' }
);

console.log(`\n✅ Done → ${OUT_PDF}`);
