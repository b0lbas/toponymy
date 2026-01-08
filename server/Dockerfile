FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY src ./src

ENV PORT=3001
ENV JWT_SECRET=change-this-in-production
ENV CORS_ORIGIN=*

EXPOSE 3001

CMD ["npm", "start"]
