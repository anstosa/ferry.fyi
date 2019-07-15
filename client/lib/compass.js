//stackoverflow.com/questions/7490660/converting-wind-direction-in-angles-to-text-words/25867068#25867068
export const degreesToHeading = (degreees) => {
    const value = Math.floor(degreees / 22.5 + 0.5);
    const headings = [
        'N',
        'NNE',
        'NE',
        'ENE',
        'E',
        'ESE',
        'SE',
        'SSE',
        'S',
        'SSW',
        'SW',
        'WSW',
        'W',
        'WNW',
        'NW',
        'NNW',
    ];
    return headings[value % 16];
};
