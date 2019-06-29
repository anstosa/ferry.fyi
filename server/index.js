import * as log from './lib/log';
import {
    backfillCapacity,
    getSchedule,
    getTerminal,
    getTerminals,
    getVessel,
    getVessels,
    recordCapacity,
    recordTiming,
    updateCache,
} from './lib/wsf';
import {dbInit} from './lib/db';
import bodyParser from 'koa-bodyparser';
import fs from 'fs';
import Koa from 'koa';
import logger from 'koa-logger';
import mount from 'koa-mount';
import path from 'path';
import Router from 'koa-router';
import serve from 'koa-static';

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
dist.use(serve(path.resolve(process.cwd(), 'client', 'dist')));
const browser = new Router();
browser.get('*', (context) => {
    context.type = 'html';
    context.body = fs.readFileSync(
        path.resolve(process.cwd(), 'client', 'dist', 'index.html')
    );
});
dist.use(browser.routes());
dist.use(browser.allowedMethods());
app.use(mount('/', dist));

// start server
(async () => {
    await dbInit;
    await updateCache();
    await backfillCapacity();
    app.listen(process.env.PORT, () => log.info('Server started!'));
    setInterval(updateCache, 30 * 1000);
    setInterval(recordCapacity, 5 * 1000);
    setInterval(recordTiming, 5 * 1000);
})();
