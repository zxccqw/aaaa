FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu && pip install --no-cache-dir -r requirements.txt
COPY . .
RUN useradd -m api && chown -R api:api /app
USER api
ENV DEVICE=cpu
EXPOSE 8000
CMD ["python","-m","uvicorn","service.app:app","--host","0.0.0.0","--port","8000","--workers","1"]
