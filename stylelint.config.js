module.exports = {
  extends: ["stylelint-config-standard-scss"],
  plugins: ["stylelint-order", "stylelint-scss"],
  ignoreFiles: ["**/*.js", "**/*.cjs", "**/*.ts", "**/*.tsx"],
  rules: {
    "max-nesting-depth": 5,
    "order/properties-alphabetical-order": true,
    "selector-class-pattern": null,
    "no-invalid-position-at-import-rule": null,
    "selector-not-notation": null,
    "scss/at-rule-no-unknown": [
      true,
      {
        ignoreAtRules: [
          // tailwind
          "apply",
          "components",
          "extends",
          "include",
          "layer",
          "mixin",
          "responsive",
          "screen",
          "tailwind",
          "utilities",
        ],
      },
    ],
  },
};
