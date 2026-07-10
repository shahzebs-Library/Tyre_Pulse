# Playwright base image ships Chromium + all system deps at a matching version.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# Install deps first for layer caching. Skip the postinstall browser download —
# the base image already bundles Chromium.
COPY package.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev --ignore-scripts

COPY src ./src

EXPOSE 8080
# Run as the non-root user the Playwright image provides.
USER pwuser
CMD ["node", "src/index.js"]
