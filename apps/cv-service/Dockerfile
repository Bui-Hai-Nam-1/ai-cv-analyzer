FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
COPY openapi.yaml ./openapi.yaml
EXPOSE 3001
CMD ["npm", "start"]
