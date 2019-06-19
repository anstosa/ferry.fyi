const Koa = require('koa');
const app = new Koa();
const dotenv = require('dotenv');

dotenv.config();

app.use(async (ctx) => {
    ctx.body = 'Hello World';
});

app.listen(process.env.SERVER_PORT);
