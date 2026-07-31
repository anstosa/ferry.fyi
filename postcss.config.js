/* eslint-disable @typescript-eslint/no-var-requires */
const autoprefixer = require("autoprefixer");
const path = require("node:path");
const tailwindcss = require("tailwindcss");

module.exports = {
  plugins: [
    autoprefixer,
    tailwindcss(path.resolve(__dirname, "tailwind.config.js")),
  ],
};
