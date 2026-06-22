# Independent image for the event-processor microservice (built from the monorepo root).
#   docker build -f apps/event-processor/Dockerfile -t retainiq/event-processor .
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm ci
# Build shared packages (incl. Prisma client generation) + just this service.
RUN npm run build:packages && npm run build -w @retainiq/event-processor

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/event-processor ./apps/event-processor
COPY --from=build /app/package.json ./package.json
CMD ["node", "apps/event-processor/dist/main.js"]
