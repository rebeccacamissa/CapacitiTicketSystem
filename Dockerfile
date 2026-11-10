# CAPACITI Candidate Support — production image
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:css && npm run i18n && npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 PGLITE_DIR=/data/pglite
# Set DATABASE_URL (e.g. Neon) at run time for persistent Postgres; otherwise the embedded database in /data is used.
COPY --from=build /app /app
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
# Seeds demo data only when the database is empty, then starts the server.
CMD ["npm", "run", "start:prod"]
