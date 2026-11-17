# 1) Build the Angular site
FROM node:24-slim AS build
WORKDIR /src
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx ng build --configuration production

# 2) Serve it with Nginx
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist/redeye/browser/ /usr/share/nginx/html/
