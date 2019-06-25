// init environment
require('dotenv').config();

const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const fs = require('fs');
const logger = require('koa-logger');
const mount = require('koa-mount');
const path = require('path');
const serve = require('koa-static');
const {getTerminals, getTerminal, getTerminalCapacity} = require('./terminals');
const {getVessels, getVessel} = require('./vessels');
const {getSchedule} = require('./schedule');

// start main app
const app = new Koa();
app.use(logger());

// api app
const api = new Koa();
api.use(bodyParser());
const router = new Router();
router.post('/error', (context) => {
    console.error(`ClientError: ${context.request.body.error}`);
    context.body = {};
});
router.get('/vessels', async (context) => {
    context.body = await getVessels();
});
router.get('/vessels/:vesselId', async (context) => {
    context.body = await getVessel(context.params.vesselId);
});
router.get('/terminals', async (context) => {
    context.body = await getTerminals();
});
router.get('/terminals/:terminalId', async (context) => {
    context.body = await getTerminal(context.params.terminalId);
});
router.get('/schedule/:departingId/:arrivingId', async (context) => {
    const {departingId, arrivingId} = context.params;
    context.body = await getSchedule(departingId, arrivingId);
});
api.use(router.routes());
api.use(router.allowedMethods());
app.use(mount('/api', api));

// static files app
const dist = new Koa();
dist.use(serve(`${__dirname}/../dist`));
const browser = new Router();
browser.get('*', (ctx) => {
    ctx.type = 'html';
    ctx.body = fs.readFileSync(path.resolve(`${__dirname}/../dist/index.html`));
});
dist.use(browser.routes());
dist.use(browser.allowedMethods());
app.use(mount('/', dist));

// start server
app.listen(process.env.PORT, () => console.log('Server started!'));
