module.exports = {
    extends: 'stylelint-config-recommended',
    ignoreFiles: [],
    rules: {
        'at-rule-no-unknown': [
            true,
            {
                ignoreAtRules: [
                    'extends',
                    'apply',
                    'mixin',
                    'each',
                    'if',
                    'else',
                    'elseif',
                    'include',
                    'tailwind',
                    'responsive',
                ],
            },
        ],
        'block-no-empty': false,
        'unit-whitelist': [
            'em',
            'rem',
            's',
            '%',
            'deg',
            'px',
            'vh',
            'vw',
            'ms',
            'fr',
        ],
    },
};
