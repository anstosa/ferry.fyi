#!/bin/bash

# Run pg_restore against a specific file.

if [[ ! -f "$1" ]]; then
  echo "cannot load database dump: no *.dump file specified"
  exit -1
fi

DBNAME_REGEX="postgres://[a-zA-Z0-9:_-].+/([a-zA-Z0-9_-]+)"
FULL_REGEX="postgres://([[:alnum:]_]+):([[:alnum:]_^,]+)@([[:alnum:].-]+):([[:digit:]]+)/([a-zA-Z0-9_-]+)"

# Make sure the DATABASE_URL is valid
if [[ $DATABASE_URL =~ $FULL_REGEX ]]; then
  echo "loading $1 to ${DATABASE_URL}"
  set +e
  pg_restore --clean --no-acl --no-owner -d ${DATABASE} $DATABASE_URL $1 
  set -e
elif [[ $DATABASE_URL =~ $DBNAME_REGEX ]]; then
  DATABASE=${BASH_REMATCH[1]}
  echo "loading $1 to ${DATABASE}"
  set +e
  pg_restore --clean --no-acl --no-owner -d ${DATABASE} $1
  set -e
else
  echo "cannot load database dump: DATABASE_URL is undefined or invalid"
  exit -1
fi
