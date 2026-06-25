# Independent image for the billing-service microservice (built from the monorepo root).
#   docker build -f backend/apps/billing-service/Dockerfile -t retainiq/billing-service .
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/tsconfig.base.json ./backend/tsconfig.base.json
COPY backend/packages ./backend/packages
COPY backend/apps ./backend/apps
# 'npm install' (not 'ci'): the root lockfile also lists the frontend workspace,
# which is intentionally absent from this backend build context. install resolves
# only the present backend workspaces; ci would error on the missing workspace.
RUN npm install
# Build shared packages (incl. Prisma client generation) + just this service.
RUN npm run build:packages && npm run build -w @retainiq/billing-service

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/backend/packages ./backend/packages
COPY --from=build /app/backend/apps/billing-service ./backend/apps/billing-service
COPY --from=build /app/package.json ./package.json
CMD ["node", "backend/apps/billing-service/dist/main.js"]
