release: node_modules/.bin/sequelize db:migrate --url $DATABASE_URL
web: node_modules/.bin/babel server/server.js -d dist && node dist/server.js