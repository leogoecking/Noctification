FROM nginx:1.27-alpine

COPY gateway/nginx.conf /etc/nginx/conf.d/default.conf

COPY index.html /usr/share/nginx/html/index.html
COPY assets /usr/share/nginx/html/assets
COPY js /usr/share/nginx/html/js
COPY views /usr/share/nginx/html/views
COPY sw.js /usr/share/nginx/html/sw.js
COPY favicon.ico /usr/share/nginx/html/favicon.ico
COPY favicon.jpeg /usr/share/nginx/html/favicon.jpeg
