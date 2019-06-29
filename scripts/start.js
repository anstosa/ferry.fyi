require('@babel/register')(require('../server/.babelrc.js'));
module.exports = require('../server/index.js');
