FROM python:3.12-alpine

# Set environment flags: unbuffered stdout/stderr and default port
ENV PYTHONUNBUFFERED=1 \
    PORT=8080 \
    TZ=UTC

WORKDIR /app

# Install tzdata (required by Python's zoneinfo for .ics calendar timezones and TZ env var)
# and create a standard non-root user (UID 1000 matches default Linux/Ubuntu/Pi users)
RUN apk add --no-cache tzdata && \
    addgroup -g 1000 hubgroup && \
    adduser -u 1000 -G hubgroup -s /bin/sh -D hubuser && \
    mkdir -p /app/data /app/public

# Copy server code and public assets
COPY server.py /app/
COPY public /app/public

# Ensure the non-root user owns the app and data directory for SQLite persistence
RUN chown -R hubuser:hubgroup /app

# Switch to non-root user for security
USER hubuser

# Expose server port
EXPOSE 8080

# Zero-dependency healthcheck using Python's standard library
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python3 -c 'import os, urllib.request; port = os.environ.get("PORT", "8080"); urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state")' || exit 1

CMD ["python3", "server.py"]
