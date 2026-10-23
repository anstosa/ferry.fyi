const SVG_DATA_URI_PREFIX = "data:image/svg+xml;charset=utf-8,";
const SVG_URL_PATTERN =
  /^\s*url\(\s*(?:"(data:image\/svg\+xml;charset=utf-8,[^"\\\r\n]*)"|'(data:image\/svg\+xml;charset=utf-8,[^'\\\r\n]*)')\s*\)\s*$/i;
const AMBIGUOUS_PERCENT_PATTERN = /%(?![0-9A-Fa-f]{2})/;
const SAFE_PERCENT_ESCAPES = Object.freeze({
  "%20": " ",
  "%2F": "/",
  "%3A": ":",
  "%3D": "=",
  "%3E": ">",
});

// preserve SVG text while omitting CSS-safe percent escapes
const encodeSvgDataUri = (payload) => {
  const svg = decodeURIComponent(payload);
  const encodedSvg = encodeURIComponent(svg)
    // keep either CSS quote delimiter encoded
    .replaceAll("'", "%27")
    .replace(
      /%(?:20|2F|3A|3D|3E)/g,
      // substitute only characters safe inside quoted CSS URLs
      (escape) => SAFE_PERCENT_ESCAPES[escape]
    );
  return `data:image/svg+xml,${encodedSvg}`;
};

module.exports = {
  postcssPlugin: "ferry-optimize-svg-data-uris",
  // optimize only a complete quoted URL without CSS escapes or extra tokens
  Declaration(declaration) {
    const match = SVG_URL_PATTERN.exec(declaration.value);
    // leave arbitrary strings and complex CSS values unchanged
    if (!match) {
      return;
    }
    const uri = match[1] ?? match[2];
    // retain fragment selectors and ambiguous literal percentages
    if (uri.includes("#") || AMBIGUOUS_PERCENT_PATTERN.test(uri)) {
      return;
    }
    try {
      declaration.value = declaration.value.replace(
        uri,
        // replace only the losslessly decoded URI payload
        () => encodeSvgDataUri(uri.slice(SVG_DATA_URI_PREFIX.length))
      );
    } catch {
      // retain URI payloads that cannot be decoded losslessly
    }
  },
};
