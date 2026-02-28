#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import puppeteer from 'puppeteer';

const htmlPath = 'docs/traces-and-anomaly.html';
const outPdf = 'docs/traces-and-anomaly.pdf';

(async () => {
  if (!fs.existsSync(htmlPath)) {
    console.error('HTML not found; run build-docs first');
    process.exit(1);
  }
  const browser = await puppeteer.launch({args:['--no-sandbox','--disable-setuid-sandbox']});
  const page = await browser.newPage();
  await page.goto('file://' + path.resolve(htmlPath), { waitUntil: 'networkidle0' });
  await page.pdf({ path: outPdf, format: 'A4', printBackground: true, margin: { top: '20mm', bottom: '20mm', left: '16mm', right: '16mm' } });
  await browser.close();
  console.log('Wrote', outPdf);
})();