require('@babel/register')(require('../server/.babelrc.js'));
module.exports = require('../server/worker.js');
