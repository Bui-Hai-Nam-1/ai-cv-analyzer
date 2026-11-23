FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY openapi.yaml ./openapi.yaml
EXPOSE 3001
CMD ["npm", "start"]
