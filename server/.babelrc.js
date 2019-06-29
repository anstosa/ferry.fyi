module.exports = {
    plugins: [
        '@babel/plugin-proposal-class-properties',
        [
            '@babel/plugin-transform-runtime',
            {
                regenerator: true,
            },
        ],
    ],
    presets: [
        [
            '@babel/preset-env',
            {
                targets: {
                    node: true,
                },
            },
        ],
        '@babel/react',
    ],
};
