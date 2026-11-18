"""python examples/client.py photo.jpg --url http://127.0.0.1:8000"""
import argparse,base64,json,os,urllib.request
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('image');p.add_argument('--url',default='http://127.0.0.1:8000');p.add_argument('--output',default='client_output');a=p.parse_args()
body=json.dumps({'image_base64':base64.b64encode(Path(a.image).read_bytes()).decode(),'include_overlay':True}).encode()
headers={'Content-Type':'application/json'}
if os.getenv('API_KEY'):headers['X-API-Key']=os.environ['API_KEY']
req=urllib.request.Request(a.url.rstrip('/')+'/v1/segment',data=body,headers=headers)
with urllib.request.urlopen(req,timeout=120) as r:result=json.load(r)
out=Path(a.output);out.mkdir(exist_ok=True,parents=True)
for field,name in [('mask_png_base64','mask.png'),('overlay_png_base64','overlay.png')]:
    if result.get(field):(out/name).write_bytes(base64.b64decode(result.pop(field)))
(out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(result)
