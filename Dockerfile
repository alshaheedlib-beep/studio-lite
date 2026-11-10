FROM node:22-slim
WORKDIR /app
COPY . .
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME ["/data"]
EXPOSE 3000
USER node
CMD ["node", "--no-warnings", "server.js"]
