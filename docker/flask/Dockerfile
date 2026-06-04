# Flask backend for the Roomie Status app.
FROM python:3.12-slim

# Keep Python output unbuffered and skip .pyc files for cleaner container logs.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install dependencies first so this layer is cached across code changes.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App source.
COPY . .

EXPOSE 8000

# Serve with Gunicorn in the container (app:app = the `app` object in app.py).
CMD ["gunicorn", "--bind", "0.0.0.0:8000", "--workers", "2", "app:app"]
