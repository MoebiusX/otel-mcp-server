#!/usr/bin/env node

// Simple renderer for .mmd files using mermaid-cli (mmdc via npx)
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const DIR = path.resolve('docs', 'diagrams');
const OUT = path.resolve('docs', 'images');

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.mmd'));
if (files.length === 0) {
  console.log('No .mmd files found in docs/diagrams');
  process.exit(0);
}

for (const file of files) {
  const inPath = path.join(DIR, file);
  const baseName = path.basename(file, '.mmd');
  // Render SVG
  const svgName = baseName + '.svg';
  const svgPath = path.join(OUT, svgName);
  console.log(`Rendering ${file} → ${svgName}`);
  try {
    execSync(`npx mmdc -i "${inPath}" -o "${svgPath}" -b transparent`, { stdio: 'inherit' });
    console.log(`Wrote ${svgPath}`);
  } catch (err) {
    console.error(`Failed to render ${file} (SVG):`, err.message);
  }

  // Render PNG (use a larger width for better quality)
  const pngName = baseName + '.png';
  const pngPath = path.join(OUT, pngName);
  console.log(`Rendering ${file} → ${pngName}`);
  try {
    execSync(`npx mmdc -i "${inPath}" -o "${pngPath}" -w 1600`, { stdio: 'inherit' });
    console.log(`Wrote ${pngPath}`);
  } catch (err) {
    console.error(`Failed to render ${file} (PNG):`, err.message);
  }
}
