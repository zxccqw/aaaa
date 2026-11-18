import hmac
import os
import threading
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Security
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.security import APIKeyHeader
from pydantic import BaseModel, ConfigDict, Field
from service.inference import Predictor, ROOT, decode_image


class PredictRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    image_base64: str = Field(min_length=1, max_length=12_000_000)
    include_overlay: bool = True


class PredictResponse(BaseModel):
    request_id: str
    model: str
    version: str
    width: int
    height: int
    model_input_size: list[int]
    threshold: float
    mask_png_base64: str
    overlay_png_base64: str | None
    lesion_area_ratio: float
    inference_ms: float


class BodyLimit:
    def __init__(self, app): self.app = app
    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        chunks, size = [], 0
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect': return
            size += len(message.get('body', b''))
            if size > 12_100_000:
                return await JSONResponse({'detail':'请求体超过限制'},status_code=413)(scope, receive, send)
            chunks.append(message)
            if not message.get('more_body', False): break
        async def replay():
            return chunks.pop(0) if chunks else await receive()
        await self.app(scope, replay, send)


def create_app():
    lock = threading.Lock()
    api_key = os.getenv('API_KEY', '')
    @asynccontextmanager
    async def lifespan(app):
        app.state.predictor = Predictor()
        yield
        del app.state.predictor
    app = FastAPI(title='SkinFusion-Seg API',version='1.0.1',lifespan=lifespan)
    app.add_middleware(BodyLimit)
    origins = [x.strip() for x in os.getenv('CORS_ORIGINS','').split(',') if x.strip()]
    if origins:
        app.add_middleware(CORSMiddleware,allow_origins=origins,allow_methods=['GET','POST'],allow_headers=['Content-Type','X-API-Key'])
    key_header = APIKeyHeader(name='X-API-Key',auto_error=False)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Never echo the uploaded image into errors or logs.
        return JSONResponse(status_code=422,content={'detail':[{'loc':list(e['loc']),'msg':e['msg'],'type':e['type']} for e in exc.errors()]})

    @app.get('/health')
    def health():
        return {'status':'ready','model':'SkinFusion-Seg','version':'1.0.1','device':app.state.predictor.device}

    @app.get('/',include_in_schema=False)
    def demo(): return FileResponse(ROOT/'examples/index.html')

    @app.post('/v1/segment',response_model=PredictResponse)
    def segment(body: PredictRequest, supplied_key: str | None = Security(key_header)):
        if api_key and not hmac.compare_digest((supplied_key or '').encode(),api_key.encode()):
            raise HTTPException(401,'API key 无效')
        if not lock.acquire(blocking=False): raise HTTPException(503,'模型忙，请稍后重试',headers={'Retry-After':'1'})
        try:
            try: rgb = decode_image(body.image_base64)
            except ValueError as exc: raise HTTPException(400,str(exc)) from None
            result = app.state.predictor.predict(rgb,body.include_overlay)
            return dict(request_id=uuid.uuid4().hex,**result)
        finally: lock.release()
    return app


app = create_app()
