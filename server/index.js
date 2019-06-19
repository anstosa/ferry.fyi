const Koa = require('koa');
const koaStatic = require('koa-staic');
const app = new Koa();
const dotenv = require('dotenv');

dotenv.config();
app.use(koaStatic(`${__dirname}../dist`));
app.use((ctx) => {
    ctx.body = 'Hello World';
});

app.listen(process.env.SERVER_PORT);
