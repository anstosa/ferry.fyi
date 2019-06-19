const Koa = require('koa');
const serve = require('koa-static');
const app = new Koa();
const dotenv = require('dotenv');

dotenv.config();
app.use(serve(`${__dirname}../dist`));
app.use((ctx) => {
    ctx.body = 'Hello World';
});

app.listen(process.env.PORT);
