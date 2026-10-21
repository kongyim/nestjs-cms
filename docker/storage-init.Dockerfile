FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY docker/init-s3.cjs ./init-s3.cjs
CMD ["node", "init-s3.cjs"]
