import fs from 'fs';
import path from 'path';

const src = path.resolve('docs', 'TRACES-AND-ANOMALY-MONITORING.pdf');
const dst = path.resolve('docs', 'traces-and-anomaly.pdf');

if (!fs.existsSync(src)) {
  console.error('Source PDF not found:', src);
  process.exit(1);
}

fs.copyFileSync(src, dst);
console.log(`Copied ${src} → ${dst}`);
