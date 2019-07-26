import {DateTime} from 'luxon';
import {dbInit} from './lib/db';
import {
    getSchedule,
    getTerminal,
    getTerminals,
    getVessel,
    getVessels,
    ingestCache,
} from './lib/wsf';
import bodyParser from 'koa-bodyparser';
import fs from 'fs';
import Koa from 'koa';
import logger from 'heroku-logger';
import mount from 'koa-mount';
import path from 'path';
import Queue from 'bull';
import requestLogger from 'koa-logger';
import Router from 'koa-router';
import serve from 'koa-static';

const longUpdate = new Queue('long', process.env.REDIS_URL);
const shortUpdate = new Queue('short', process.env.REDIS_URL);

// start main app
const app = new Koa();
app.use(requestLogger());

// api app
const api = new Koa();
api.use(bodyParser());
const router = new Router();
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
    context.body = {
        schedule: await getSchedule(departingId, arrivingId),
        timestamp: DateTime.local().toSeconds(),
    };
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
app.use(mount('/', dist));

// start server
(async () => {
    await dbInit;
    app.listen(process.env.PORT, () => logger.info('Server started'));
    longUpdate.on('global:completed', (jobId, data) => {
        ingestCache(JSON.parse(data));
    });
    longUpdate.add();
    longUpdate.add(null, {
        repeat: {every: 30 * 1000},
    });
    shortUpdate.on('global:completed', (jobId, data) => {
        ingestCache(JSON.parse(data));
    });
    shortUpdate.add();
    shortUpdate.add(null, {
        repeat: {every: 10 * 1000},
    });
})();
