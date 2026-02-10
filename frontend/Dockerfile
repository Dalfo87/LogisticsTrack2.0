# ============================================
# Frontend — Dockerfile (Development)
# Vite dev server con hot-reload
# ============================================

FROM node:20-alpine

WORKDIR /app

# Dipendenze (layer separato per cache Docker)
COPY package.json package-lock.json ./
RUN npm ci

# Sorgenti (in dev montate come volume)
COPY . .

EXPOSE 5173

# Vite dev server accessibile dalla rete Docker
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
