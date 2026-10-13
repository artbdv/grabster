FROM node:24.19.0-alpine AS build

WORKDIR /app

COPY . .

# VITE_API_URL, FEE_DIRECT and TREASURY_ADDRESS are baked into this image.
# A later restart does not pick up changes to them. Rebuild the image.
RUN --mount=type=secret,id=envfile,dst=/app/.env \
    npm install \
    && node grabster-app/scripts/check-build-env.mjs \
    && npm run build -w grabster-local \
    && npm run build -w grabster-app

FROM nginx:stable-alpine

COPY --from=build /app/grabster-app/dist /usr/share/nginx/html
RUN rm -f /etc/nginx/conf.d/default.conf
COPY grabster-app/nginx.conf /etc/nginx/nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
