# Independent image for the activity-ingestion microservice (built from the monorepo root).
#   docker build -f apps/activity-ingestion/Dockerfile -t retainiq/activity-ingestion .
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci
# Build shared packages (incl. Prisma client generation) + just this service.
RUN npm run build:packages && npm run build -w @retainiq/activity-ingestion

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/activity-ingestion ./apps/activity-ingestion
COPY --from=build /app/package.json ./package.json
CMD ["node", "apps/activity-ingestion/dist/main.js"]
