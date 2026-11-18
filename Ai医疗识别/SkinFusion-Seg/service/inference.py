import base64
import binascii
import hashlib
import io
import json
import os
import time
import warnings
from pathlib import Path

import cv2
import numpy as np
import torch
from PIL import Image, ImageOps, UnidentifiedImageError
from model import SkinFusionSeg

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 8 * 1024 * 1024
MAX_PIXELS = 4_000_000


def decode_image(value):
    if value.startswith('data:'):
        header, sep, value = value.partition(',')
        if not sep or header not in ('data:image/png;base64', 'data:image/jpeg;base64', 'data:image/webp;base64'):
            raise ValueError('仅支持 PNG/JPEG/WebP 的 Base64 Data URL')
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, binascii.Error):
        raise ValueError('image_base64 不是有效的 Base64') from None
    if len(raw) > MAX_BYTES:
        raise ValueError('图片文件不得超过 8 MiB')
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as im:
                if im.format not in ('JPEG', 'PNG', 'WEBP') or getattr(im, 'n_frames', 1) != 1:
                    raise ValueError('请上传单帧 JPG、PNG 或 WebP 图片')
                if im.width * im.height > MAX_PIXELS:
                    raise ValueError('图片不得超过 400 万像素，请在网页上传前等比例缩小')
                if im.mode not in ('RGB', 'RGBA', 'L', 'LA', 'P', 'CMYK'):
                    raise ValueError('请使用 8 位图片')
                im = ImageOps.exif_transpose(im)
                if im.mode in ('RGBA', 'LA', 'P'):
                    rgba = im.convert('RGBA')
                    bg = Image.new('RGBA', rgba.size, 'white')
                    im = Image.alpha_composite(bg, rgba)
                return np.array(im.convert('RGB'))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise ValueError('无法解码图片或图片尺寸过大') from None


def preprocess(rgb):
    # Match the evaluation path: float32 -> OpenCV linear resize -> global min-max.
    a = cv2.resize(rgb.astype(np.float32), (256, 256), interpolation=cv2.INTER_LINEAR)
    lo, hi = float(a.min()), float(a.max())
    a = (a-lo)/(hi-lo) if hi > lo else np.zeros_like(a)
    return torch.from_numpy(np.ascontiguousarray(a.transpose(2, 0, 1))).unsqueeze(0)


def png64(array):
    buf = io.BytesIO()
    Image.fromarray(array).save(buf, format='PNG')
    return base64.b64encode(buf.getvalue()).decode('ascii')


class Predictor:
    def __init__(self):
        torch.set_num_threads(int(os.getenv('CPU_THREADS', '2')))
        requested = os.getenv('DEVICE', 'auto')
        self.device = ('cuda:0' if torch.cuda.is_available() else 'cpu') if requested == 'auto' else requested
        manifest = json.loads((ROOT/'MODEL_MANIFEST.json').read_text())
        weight = ROOT/'weights/skinfusion_seg_v1.pth'
        self.sha256 = hashlib.sha256(weight.read_bytes()).hexdigest()
        if self.sha256 != manifest['checkpoint_sha256']:
            raise RuntimeError('Checkpoint hash differs from MODEL_MANIFEST.json')
        self.model = SkinFusionSeg()
        self.model.load_state_dict(torch.load(weight, map_location='cpu', weights_only=True), strict=True)
        self.model.to(self.device).eval()

    def predict(self, rgb, include_overlay=True):
        started = time.perf_counter()
        x = preprocess(rgb).to(self.device)
        with torch.inference_mode():
            probability = self.model(x)[0, 0].cpu().numpy()
        inference_ms = (time.perf_counter()-started)*1000
        h, w = rgb.shape[:2]
        mask = cv2.resize((probability >= .5).astype(np.uint8)*255, (w, h), interpolation=cv2.INTER_NEAREST)
        overlay64 = None
        if include_overlay:
            overlay = rgb.copy()
            selected = mask > 0
            overlay[selected] = (rgb[selected]*.65 + np.array([255,60,60])*.35).astype(np.uint8)
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(overlay, contours, -1, (0,220,200), max(1,round(min(w,h)/256)))
            overlay64 = png64(overlay)
        return dict(model='SkinFusion-Seg', version='1.0.1', width=w, height=h,
                    model_input_size=[256,256], threshold=.5,
                    mask_png_base64=png64(mask), overlay_png_base64=overlay64,
                    lesion_area_ratio=float((mask>0).mean()), inference_ms=round(inference_ms,2))
