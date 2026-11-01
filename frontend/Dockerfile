# -----------------------------------------------------------------------------
# Stage 1: Build Vite Single Page App
# -----------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Build Vite SPA with production mode
ARG VITE_GOOGLE_CLIENT_ID
ENV VITE_GOOGLE_CLIENT_ID=$VITE_GOOGLE_CLIENT_ID

RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2: Serve with Nginx for Cloud Run
# -----------------------------------------------------------------------------
FROM nginx:alpine AS runner

ENV PORT=8080

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

EXPOSE 8080

# envsubst automatically substitutes $PORT into /etc/nginx/conf.d/default.conf
CMD ["nginx", "-g", "daemon off;"]

