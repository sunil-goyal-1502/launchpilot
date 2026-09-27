FROM node:22-bookworm-slim
WORKDIR /app
COPY . .
RUN npm ci --omit=dev
EXPOSE 8080
CMD ["node", "server.js"]
