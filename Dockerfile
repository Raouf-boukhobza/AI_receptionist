FROM node:20-alpine

RUN apk add --no-cache tzdata
ENV TZ=Africa/Algiers

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY . .

CMD ["npm", "run", "start:dev"]
