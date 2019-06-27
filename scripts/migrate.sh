#!/bin/sh

npx sequelize-cli db:migrate --url $DATABASE_URL
