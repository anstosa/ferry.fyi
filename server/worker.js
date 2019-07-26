import {updateLong, updateShort} from './lib/wsf-worker';
import logger from 'heroku-logger';
import Queue from 'bull';

(async () => {
    logger.info('Warming cache');
    await updateLong();
    await updateShort();

    logger.info('Initilizing longUpdate processor');
    const longUpdate = new Queue('long', process.env.REDIS_URL);
    longUpdate.process(() => updateLong());

    logger.info('Initilizing shortUpdate processor');
    const shortUpdate = new Queue('short', process.env.REDIS_URL);
    shortUpdate.process(() => updateShort());
})();
