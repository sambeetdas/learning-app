FROM nginx:1.27-alpine

# Static site: everything in the build context (see .dockerignore) is served as-is.
COPY . /usr/share/nginx/html

EXPOSE 80
