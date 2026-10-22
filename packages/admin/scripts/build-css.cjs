const { readFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const root = resolve(__dirname, '..');
const from = resolve(root, 'src/styles.css');
postcss([tailwind({ base: root })])
  .process(readFileSync(from, 'utf8'), {
    from,
    to: resolve(root, 'dist/styles.css'),
  })
  .then((result) => {
    writeFileSync(resolve(root, 'dist/styles.css'), result.css);
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
