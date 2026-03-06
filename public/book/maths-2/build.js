import fs from 'fs';
import path from 'path';

const root = process.cwd();
const dist = path.join(root, 'dist');

if (!fs.existsSync(dist)) {
  fs.mkdirSync(dist, { recursive: true });
}

const filesToCopy = [
  'index.html',
  'success.html',
  'main.js',
  'style.css',
  'logo.png'
];

for (const file of filesToCopy) {
  const src = path.join(root, file);
  if (fs.existsSync(src)) {
    const dest = path.join(dist, file);
    fs.copyFileSync(src, dest);
  }
}

console.log('Static build complete. Output in /dist');

