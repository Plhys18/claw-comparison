import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MMDC = join(__dirname, 'node_modules/.bin/mmdc');
const INPUT = join(__dirname, 'report.md');
const IMGS = join(__dirname, 'imgs');
const OUT_HTML = join(__dirname, 'report-rendered.html');
const OUT_PDF = join(__dirname, 'NanoClaw-vs-OpenClaw.pdf');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

if (!existsSync(IMGS)) mkdirSync(IMGS);

// ── Step 1: Render each mermaid block to SVG (vector, crisp at any size) ──────
let md = readFileSync(INPUT, 'utf8');
let diagramIndex = 0;
const svgPlaceholders = {};

md = md.replace(/```mermaid\n([\s\S]*?)```/g, (_, diagram) => {
  const id = `diagram-${++diagramIndex}`;
  const mmdFile = join(IMGS, `${id}.mmd`);
  const svgFile = join(IMGS, `${id}.svg`);

  writeFileSync(mmdFile, diagram.trim());

  try {
    execSync(
      `"${MMDC}" -i "${mmdFile}" -o "${svgFile}" -b white --quiet`,
      { stdio: 'pipe' }
    );
    console.log(`  ✓ Rendered ${id}`);
    const svgContent = readFileSync(svgFile, 'utf8')
      // remove fixed width/height so it scales with the page
      .replace(/<svg ([^>]*)width="[^"]*"/, '<svg $1')
      .replace(/<svg ([^>]*)height="[^"]*"/, '<svg $1')
      .replace(/<svg /, '<svg style="width:100%;height:auto;display:block;margin:1em auto;" ');
    svgPlaceholders[id] = svgContent;
    return `%%SVG:${id}%%`;
  } catch (e) {
    console.error(`  ✗ Failed ${id}:\n${e.stderr?.toString()}`);
    return `<pre>${diagram}</pre>`;
  }
});

console.log(`\n${diagramIndex} diagrams rendered as SVG.\n`);

// ── Step 2: Convert markdown → HTML via pandoc ────────────────────────────────
console.log('Converting to HTML...');
const tmpMd = join(IMGS, '_tmp.md');
writeFileSync(tmpMd, md);

execSync(
  `pandoc "${tmpMd}" -o "${OUT_HTML}" \
    --standalone \
    --metadata title="NanoClaw vs OpenClaw — Architecture Comparison" \
    --syntax-highlighting=tango`,
  { stdio: 'inherit', cwd: __dirname }
);

// ── Step 3: Inject inline SVGs + CSS ─────────────────────────────────────────
let html = readFileSync(OUT_HTML, 'utf8');

// Replace placeholders with actual inline SVG
for (const [id, svg] of Object.entries(svgPlaceholders)) {
  html = html.replace(
    `<p>%%SVG:${id}%%</p>`,
    `<figure class="diagram">${svg}</figure>`
  );
}

const style = `
<style>
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
    font-size: 13px; line-height: 1.65; color: #111;
    max-width: 980px; margin: 0 auto; padding: 32px 48px;
  }
  h1 { font-size: 2em; border-bottom: 3px solid #222; padding-bottom: 10px; margin-top: 0; }
  h2 { font-size: 1.4em; border-bottom: 1px solid #ddd; margin-top: 2.5em; padding-bottom: 4px; }
  h3 { font-size: 1.1em; color: #333; margin-top: 1.6em; }
  table { border-collapse: collapse; width: 100%; margin: 1.2em 0; font-size: 12px; }
  th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; font-weight: 600; }
  tr:nth-child(even) td { background: #fafafa; }
  code { background: #f0f0f0; padding: 2px 5px; border-radius: 3px; font-size: 0.87em; }
  pre { background: #f6f6f6; padding: 14px; border-radius: 5px; overflow-x: auto; border: 1px solid #e0e0e0; }
  pre code { background: none; padding: 0; }
  blockquote { border-left: 4px solid #bbb; margin: 0 0 1em 0; padding: 4px 16px; color: #555; }
  figure.diagram {
    margin: 1.5em 0; padding: 16px; background: #fff;
    border: 1px solid #e0e0e0; border-radius: 6px;
    page-break-inside: avoid;
  }
  figure.diagram svg { max-width: 100%; height: auto; }
  @media print {
    body { max-width: 100%; padding: 0 20px; }
    h2 { page-break-before: auto; }
    figure.diagram { page-break-inside: avoid; }
  }
</style>
`;
html = html.replace('</head>', style + '</head>');
writeFileSync(OUT_HTML, html);
console.log('HTML written with inline SVGs.\n');

// ── Step 4: Chrome headless → PDF ────────────────────────────────────────────
console.log('Printing to PDF...');
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
