# Ferry Sans Flex subsets

These files are modified subsets of Google Sans Flex, distributed under the
SIL Open Font License 1.1 in `OFL.txt`. The upstream family is published by
Google Fonts as open source.

- Upstream metadata: https://fonts.google.com/metadata/fonts/Google%20Sans%20Flex
- Upstream download manifest: https://fonts.google.com/download/list?family=Google%20Sans%20Flex
- Source version: Google Sans Flex 4.005, Google Fonts `v22`, modified 2026-07-30
- Source SHA-256: `c6d53424121196b81de816b8daccf200e285dd506df43766db3d7e8cdf06ee30`

The source variable font was reduced to the axes used by Ferry FYI:

- `opsz`: 6–144
- `wght`: 400–900
- `GRAD`, `ROND`, `slnt`, and `wdth`: pinned to their defaults and removed

The modified family name is `Ferry Sans Flex`. Two WOFF2 files use Google
Fonts' published Latin and Latin Extended unicode ranges so common English,
Washington place names, punctuation, symbols, and extended Latin user names
remain covered while Latin Extended downloads only when required.

Generated with fontTools 4.57.0 and Brotli support:

```sh
fonttools varLib.instancer GoogleSansFlex-VariableFont_GRAD,ROND,opsz,slnt,wdth,wght.ttf \
  GRAD=drop ROND=drop slnt=drop wdth=drop opsz=6:144 wght=400:900 \
  --output ferry-sans-flex.ttf

pyftsubset ferry-sans-flex.ttf \
  --output-file=../../fonts/ferry-sans-flex-latin.woff2 \
  --flavor=woff2 \
  --unicodes='U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD' \
  --layout-features='*' --name-IDs='*' --name-languages='*' \
  --notdef-glyph --notdef-outline --recommended-glyphs

pyftsubset ferry-sans-flex.ttf \
  --output-file=../../fonts/ferry-sans-flex-latin-ext.woff2 \
  --flavor=woff2 \
  --unicodes='U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF' \
  --layout-features='*' --name-IDs='*' --name-languages='*' \
  --notdef-glyph --notdef-outline --recommended-glyphs
```
