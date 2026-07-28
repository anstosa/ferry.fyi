# syntax=docker/dockerfile:1
# check=skip=SecretsUsedInArgOrEnv

# Public browser config names include KEY/TOKEN but values are client-visible.
FROM node:24-bookworm-slim AS build

WORKDIR /app
ENV CI=true

RUN corepack enable && corepack prepare yarn@1.22.22 --activate

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000

COPY . .
ARG AUTH0_CLIENT_AUDIENCE
ARG AUTH0_CLIENT_ID
ARG AUTH0_CLIENT_REDIRECT
ARG AUTH0_DOMAIN
ARG AW_TAG_ID
ARG BASE_URL=https://ferry.fyi
ARG FIREBASE_API_KEY
ARG FIREBASE_APP_ID
ARG FIREBASE_PROJECT_ID
ARG FIREBASE_SENDER_ID
ARG FIREBASE_VAPID_KEY
ARG GOOGLE_ANALYTICS
ARG GTM_CONTAINER_ID
ARG HEROKU_RELEASE_VERSION=DEVELOPMENT
ARG LOG_LEVEL
ARG MAPBOX_ACCESS_TOKEN
ARG NODE_ENV=production
ARG SENTRY_DSN
ENV AUTH0_CLIENT_AUDIENCE=${AUTH0_CLIENT_AUDIENCE} \
    AUTH0_CLIENT_ID=${AUTH0_CLIENT_ID} \
    AUTH0_CLIENT_REDIRECT=${AUTH0_CLIENT_REDIRECT} \
    AUTH0_DOMAIN=${AUTH0_DOMAIN} \
    AW_TAG_ID=${AW_TAG_ID} \
    BASE_URL=${BASE_URL} \
    FIREBASE_API_KEY=${FIREBASE_API_KEY} \
    FIREBASE_APP_ID=${FIREBASE_APP_ID} \
    FIREBASE_PROJECT_ID=${FIREBASE_PROJECT_ID} \
    FIREBASE_SENDER_ID=${FIREBASE_SENDER_ID} \
    FIREBASE_VAPID_KEY=${FIREBASE_VAPID_KEY} \
    GOOGLE_ANALYTICS=${GOOGLE_ANALYTICS} \
    GTM_CONTAINER_ID=${GTM_CONTAINER_ID} \
    HEROKU_RELEASE_VERSION=${HEROKU_RELEASE_VERSION} \
    LOG_LEVEL=${LOG_LEVEL} \
    MAPBOX_ACCESS_TOKEN=${MAPBOX_ACCESS_TOKEN} \
    NODE_ENV=${NODE_ENV} \
    SENTRY_DSN=${SENTRY_DSN}
RUN yarn build

FROM node:24-bookworm-slim AS development

WORKDIR /app

RUN corepack enable && corepack prepare yarn@1.22.22 --activate

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --network-timeout 600000

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ARG HEROKU_RELEASE_VERSION=UNKNOWN
ENV NODE_ENV=production \
    PORT=4040 \
    HEROKU_RELEASE_VERSION=${HEROKU_RELEASE_VERSION}

RUN corepack enable && corepack prepare yarn@1.22.22 --activate

COPY package.json yarn.lock ./
COPY .sequelizerc sequelize.config.json ./
COPY server/migrations ./server/migrations
COPY shared/data/wsf-core.json ./shared/data/wsf-core.json
RUN yarn install --frozen-lockfile --production=true --network-timeout 600000 && yarn cache clean
COPY --from=build /app/dist ./dist

EXPOSE 4040
CMD ["yarn", "start:prod"]
