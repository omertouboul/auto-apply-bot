# Use the official Microsoft Playwright environment as the base image
# This pre-installs all required Linux system dependencies for headless browsers (Chromium)
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

# Set working directory inside the container
WORKDIR /app

# Copy packages config files
COPY package*.json ./

# Install npm dependencies (production mode)
RUN npm ci --only=production

# Install Playwright's Chromium browser binaries
RUN npx playwright install chromium

# Copy application files (frontend public files, backend server, configs)
COPY . .

# Expose port 3000 to the web
EXPOSE 3000

# Set environment variables
ENV PORT=3000
ENV NODE_ENV=production

# Run the Auto-Pilot server on startup
CMD ["node", "server.js"]
