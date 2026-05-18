ARG NODE_IMAGE=node:24-bookworm
ARG GO_IMAGE=golang:1.23-bookworm
ARG RUNTIME_IMAGE=scratch

FROM ${NODE_IMAGE} AS web-build
WORKDIR /src/apps/web
COPY apps/web/package*.json ./
RUN npm ci
COPY apps/web ./
RUN npm run build

FROM ${GO_IMAGE} AS server-build
ARG GOPROXY=https://proxy.golang.org,direct
WORKDIR /src/backend-skeleton/server
COPY backend-skeleton/server/go.mod backend-skeleton/server/go.sum ./
RUN GOPROXY="$GOPROXY" go mod download
COPY backend-skeleton/server ./
COPY --from=web-build /src/apps/web/dist ./web-dist
RUN CGO_ENABLED=0 GOOS=linux GOPROXY="$GOPROXY" go build -o /out/online-ssh-server ./cmd/app
RUN mkdir -p /runtime/tmp/online-ssh-transfers \
    && chmod 1777 /runtime/tmp \
    && chown 65532:65532 /runtime/tmp/online-ssh-transfers \
    && chmod 0700 /runtime/tmp/online-ssh-transfers \
    && touch /runtime/tmp/online-ssh-transfers/.keep \
    && chown 65532:65532 /runtime/tmp/online-ssh-transfers/.keep \
    && cp /etc/ssl/certs/ca-certificates.crt /runtime/ca-certificates.crt

FROM ${RUNTIME_IMAGE}
WORKDIR /app
COPY --from=server-build /runtime/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=server-build /runtime/tmp /tmp
COPY --from=server-build /out/online-ssh-server /app/online-ssh-server
COPY --from=server-build /src/backend-skeleton/server/migrations /app/migrations
COPY --from=server-build /src/backend-skeleton/server/web-dist /app/web
USER 65532:65532
ENV APP_ENV=production
ENV HTTP_ADDR=:8080
ENV STATIC_DIR=/app/web
ENV MIGRATIONS_DIR=/app/migrations
ENV AUTO_MIGRATE=true
ENV SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt
ENV TMPDIR=/tmp
EXPOSE 8080
ENTRYPOINT ["/app/online-ssh-server"]
