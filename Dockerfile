# Playwright's official image: Chromium and its system libraries preinstalled.
# The tag must match the "playwright" version in package.json.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY src ./src

ENV NODE_ENV=production
# Run as the image's unprivileged user.
USER pwuser
CMD ["node", "src/index.js"]
