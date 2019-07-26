import {updateLong, updateShort} from './lib/wsf-worker';
import logger from 'heroku-logger';
import Queue from 'bull';

const removeJob = (job) => job.remove();

async function clean(queue) {
    await queue.clean(0, 'completed');
    await queue.clean(0, 'failed');
}

(async () => {
    logger.info('Warming cache');
    await updateLong();
    await updateShort();

    logger.info('Initilizing longUpdate processor');
    const longUpdate = new Queue('long', process.env.REDIS_URL);
    await clean(longUpdate);
    longUpdate.process(() => updateLong());
    longUpdate.on('completed', removeJob);
    longUpdate.on('failed', removeJob);

    logger.info('Initilizing shortUpdate processor');
    const shortUpdate = new Queue('short', process.env.REDIS_URL);
    await clean(shortUpdate);
    shortUpdate.process(() => updateShort());
    shortUpdate.on('completed', removeJob);
    shortUpdate.on('failed', removeJob);
})();
