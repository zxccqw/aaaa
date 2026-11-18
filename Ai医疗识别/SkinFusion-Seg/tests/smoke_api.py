import base64,io,os
os.environ['DEVICE']='cpu'
os.environ['API_KEY']='local-smoke-key'
os.environ['CORS_ORIGINS']='https://example.test'
import numpy as np
from PIL import Image
from fastapi.testclient import TestClient
from service.app import create_app
from service.inference import png64,decode_image


def main():
    rgb=np.random.default_rng(42).integers(0,256,(192,320,3),dtype=np.uint8)
    data=png64(rgb)
    app=create_app()
    with TestClient(app) as client:
        assert client.get('/health').json()['status']=='ready'
        assert client.get('/').status_code==200
        assert '/v1/segment' in client.get('/openapi.json').json()['paths']
        assert client.post('/v1/segment',json={'image_base64':data}).status_code==401
        h={'X-API-Key':'local-smoke-key'}
        r=client.post('/v1/segment',json={'image_base64':'data:image/png;base64,'+data},headers=h)
        assert r.status_code==200,r.text
        result=r.json()
        mask=np.array(Image.open(io.BytesIO(base64.b64decode(result['mask_png_base64']))))
        overlay=Image.open(io.BytesIO(base64.b64decode(result['overlay_png_base64'])))
        assert mask.shape==(192,320) and overlay.size==(320,192)
        assert set(np.unique(mask)) <= {0,255}
        assert result['lesion_area_ratio']==float((mask>0).mean())
        r=client.post('/v1/segment',json={'image_base64':data,'include_overlay':False},headers=h)
        assert r.status_code==200 and r.json()['overlay_png_base64'] is None
        for invalid in ['%%%','YWJj']:
            assert client.post('/v1/segment',json={'image_base64':invalid},headers=h).status_code==400
        assert client.post('/v1/segment',json={},headers=h).status_code==422
        assert client.post('/v1/segment',content=b'{bad',headers={**h,'Content-Type':'application/json'}).status_code==422
        r=client.post('/v1/segment',content=b'x'*12_100_001,headers={**h,'Content-Type':'application/json'})
        assert r.status_code==413
        huge=png64(np.zeros((2001,2000,3),np.uint8))
        assert client.post('/v1/segment',json={'image_base64':huge},headers=h).status_code==400
        r=client.options('/v1/segment',headers={'Origin':'https://example.test','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'X-API-Key,Content-Type'})
        assert r.status_code==200 and r.headers['access-control-allow-origin']=='https://example.test'
        photo=Image.fromarray(rgb);exif=Image.Exif();exif[274]=6
        buf=io.BytesIO();photo.save(buf,format='JPEG',exif=exif)
        assert decode_image(base64.b64encode(buf.getvalue()).decode()).shape==(320,192,3)
        print('PASS: real-weight CPU JSON inference, dimensions/binary mask, optional overlay, auth, invalid image/JSON, size limits, CORS, EXIF')
        print('CPU first request inference_ms:',result['inference_ms'])

if __name__=='__main__':main()
