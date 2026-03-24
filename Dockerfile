FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS development
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

FROM base AS build
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS production
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

FROM python:3.12-alpine AS calculation-api
WORKDIR /app
COPY requirements-calculation-api.txt ./
RUN pip install --no-cache-dir -r requirements-calculation-api.txt
COPY calculation_api ./calculation_api
RUN addgroup -S linksim && adduser -S linksim -G linksim && chown -R linksim:linksim /app
USER linksim
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD python -c "import sys, urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2).status == 200 else 1)"
CMD ["uvicorn", "calculation_api.main:app", "--host", "0.0.0.0", "--port", "8000"]
