import {updateLong, updateShort} from './lib/wsf-worker';
import logger from 'heroku-logger';
import Queue from 'bull';

(async () => {
    logger.info('Warming cache');
    await updateLong();
    logger.info('Initilizing longUpdate processor');
    const longUpdate = new Queue('long', process.env.REDIS_URL);
    await longUpdate.clean(10 * 1000, 'wait');
    console.log(await longUpdate.count());
    longUpdate.process(() => updateLong());

    logger.info('Initilizing shortUpdate processor');
    const shortUpdate = new Queue('short', process.env.REDIS_URL);
    await shortUpdate.clean(10 * 1000, 'wait');
    console.log(await shortUpdate.count());
    shortUpdate.process(() => updateShort());
})();
