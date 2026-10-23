/* eslint-disable @typescript-eslint/no-var-requires */
const autoprefixer = require("autoprefixer");
const path = require("node:path");
const tailwindcss = require("tailwindcss");

const optimizeSvgDataUris = require("./scripts/optimize-svg-data-uris.cjs");

module.exports = {
  plugins: [
    autoprefixer,
    tailwindcss(path.resolve(__dirname, "tailwind.config.js")),
    optimizeSvgDataUris,
  ],
};
