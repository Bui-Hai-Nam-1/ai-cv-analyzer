FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
COPY openapi.yaml ./openapi.yaml
EXPOSE 3000
CMD ["npm", "start"]
