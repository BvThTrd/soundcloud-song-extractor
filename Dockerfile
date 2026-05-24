FROM python:3.12-slim

# Install system dependencies: ffmpeg for audio conversion, curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user to run the app
RUN useradd --no-create-home --shell /bin/false appuser

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app source
COPY app.py .
COPY templates/ templates/
COPY static/ static/

# Temp download directory writable by the app user
RUN mkdir -p /tmp/mysoundtube-dl && chown appuser:appuser /tmp/mysoundtube-dl

USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:${PORT:-5000}/login || exit 1

CMD ["python", "app.py"]
