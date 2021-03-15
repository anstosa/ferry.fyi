module.exports = {
  plugins: ["stylelint-order", "stylelint-scss"],
  ignoreFiles: [
    "**/*.js",
    "**/*.cjs",
    "**/*.ts",
    "**/*.tsx",
    "client/scss/fontawesome/*",
  ],
  rules: {
    "max-nesting-depth": 5,
    "order/properties-alphabetical-order": true,
    "selector-class-pattern": null,
    indentation: 2,
    "scss/at-rule-no-unknown": [
      true,
      {
        ignoreAtRules: [
          // tailwind
          "apply",
          "components",
          "extends",
          "include",
          "mixin",
          "responsive",
          "screen",
          "tailwind",
          "utilities",
        ],
      },
    ],
    "string-quotes": "double",
  },
};
