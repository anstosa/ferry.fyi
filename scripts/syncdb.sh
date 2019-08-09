#!/bin/sh

set -e

rm -f latest.dump
heroku pg:backups:capture --app=ferry-fyi
heroku pg:backups:download --app=ferry-fyi
pg_restore --verbose --clean --no-acl --no-owner -h localhost -U postgres -d ferryfyi latest.dump
