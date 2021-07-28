#!/bin/bash
# Drop the current database at DATABASE_URL and re-create it

DBNAME_REGEX="postgres://[a-zA-Z0-9:_-].+/([a-zA-Z0-9_-]+)"
FULL_REGEX="postgres://([[:alnum:]_]+):([[:alnum:]_^,]+)@([[:alnum:].-]+):([[:digit:]]+)/([a-zA-Z0-9_-]+)"

if [[ $DATABASE_URL =~ $FULL_REGEX ]]; then
  USERNAME=${BASH_REMATCH[1]}
  PASSWORD=${BASH_REMATCH[2]}
  HOST=${BASH_REMATCH[3]}
  PORT=${BASH_REMATCH[4]}
  DATABASE=${BASH_REMATCH[5]}
  # Export necessary env vars
  export PGHOST=${HOST}
  export PGPORT=${PORT}
  export PGUSER=${USERNAME}
  export PGPASSWORD=${PASSWORD}

  dropdb --if-exists ${DATABASE}
  createdb ${DATABASE}

  # For local postgres, we make sure to remove the user from the root
  # 'postgres' database if necessary. For dockerpg, this should bail.
  # So we ignore errors (and silence them) here.
  set +e
  psql -d postgres -c "DROP USER IF EXISTS ${USERNAME}" > /dev/null 2>&1
  psql -d ${DATABASE} -c "CREATE USER ${USERNAME} WITH PASSWORD '${PASSWORD}';" > /dev/null 2>&1
  psql -d ${DATABASE} -c "GRANT ALL PRIVILEGES ON DATABASE ${DATABASE} TO ${USERNAME};" > /dev/null 2>&1
  set -e
else
  echo "resetdb.sh: cannot reset database: DATABASE_URL is undefined or invalid"
  exit -1
fi
