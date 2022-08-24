FROM node:lts-alpine as build

WORKDIR /usr/src/app
COPY package.json ./
COPY package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 8080
ENTRYPOINT [ "node", "app.js" ]