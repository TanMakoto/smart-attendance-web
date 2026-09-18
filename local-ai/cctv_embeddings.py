"""CCTV profiles using the Face API's cached VGG-Face/SSD models."""
import json
import os
import threading
import uuid
import unicodedata
from pathlib import Path
import cv2
import numpy as np
from deepface import DeepFace
from fastapi import APIRouter, File, Form, UploadFile
from fastapi.responses import JSONResponse

router = APIRouter(prefix='/internal/cctv')
ROOT = Path(r'D:\smart-attendance-web-main\Gesture-Recognition-master\known_faces')
STORE = ROOT / 'vgg_profiles.json'
LOCK = threading.RLock()
THRESHOLD = 0.60  # cosine distance; calibrate with held-out footage before deployment
MARGIN = 0.08

def read_profiles():
    if not STORE.exists():
        return {}
    return json.loads(STORE.read_text(encoding='utf-8'))

def save_profiles(profiles):
    ROOT.mkdir(parents=True, exist_ok=True)
    tmp = STORE.with_suffix('.tmp')
    tmp.write_text(json.dumps(profiles, ensure_ascii=False), encoding='utf-8')
    os.replace(tmp, STORE)

def representations(frame):
    try:
        return DeepFace.represent(img_path=frame, model_name='VGG-Face',
                                 detector_backend='ssd', enforce_detection=True, align=True)
    except ValueError as exc:
        if 'face could not be detected' in str(exc).lower():
            return []
        raise

def quality(frame, face):
    a = face['facial_area']
    x, y = max(0, a['x']), max(0, a['y'])
    crop = frame[y:y+a['h'], x:x+a['w']]
    if crop.size == 0 or min(crop.shape[:2]) < 70:
        raise ValueError('ขยับใบหน้าเข้าใกล้กล้องอีกเล็กน้อย')
    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    if gray.mean() < 35 or gray.mean() > 230:
        raise ValueError('แสงมืดหรือสว่างเกินไป กรุณาปรับแสง')
    if cv2.Laplacian(gray, cv2.CV_64F).var() < 30:
        raise ValueError('ภาพใบหน้าไม่ชัด กรุณาอยู่นิ่งและลองอีกครั้ง')

def match(embedding, profiles):
    vector = np.asarray(embedding, dtype=float)
    scores = []
    for name, samples in profiles.items():
        distances = []
        for sample in samples:
            other = np.asarray(sample, dtype=float)
            denom = np.linalg.norm(vector) * np.linalg.norm(other)
            if denom > 0:
                distances.append(float(1 - np.dot(vector, other) / denom))
        if distances:
            scores.append((min(distances), name))
    scores.sort()
    if not scores:
        return 'Unknown', None
    distance, name = scores[0]
    if distance > THRESHOLD or (len(scores) > 1 and scores[1][0] - distance < MARGIN):
        name = 'Unknown'
    return name, distance

def migrate_legacy():
    with LOCK:
        profiles = read_profiles()
        for path in ROOT.glob('*'):
            if path.suffix.lower() not in ('.jpg', '.jpeg', '.png') or path.stem in profiles:
                continue
            try:
                frame = cv2.imdecode(np.frombuffer(path.read_bytes(), np.uint8), cv2.IMREAD_COLOR)
                faces = representations(frame)
                if len(faces) == 1:
                    profiles[path.stem] = [faces[0]['embedding']]
            except Exception as exc:
                print(f'CCTV legacy import skipped {path.name}: {type(exc).__name__}')
        save_profiles(profiles)

@router.get('/profiles')
def profiles_status():
    with LOCK:
        profiles = read_profiles()
        return {'profiles': list(profiles), 'known_profiles': len(profiles), 'model': 'VGG-Face',
                'samples': {name: len(samples) for name, samples in profiles.items()}}

@router.post('/recognize')
async def recognize(file: UploadFile = File(...)):
    frame = cv2.imdecode(np.frombuffer(await file.read(), np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        return JSONResponse(status_code=400, content={'message': 'Invalid image'})
    with LOCK:
        profiles = read_profiles()
        results = []
        for face in representations(frame):
            name, distance = match(face['embedding'], profiles)
            try:
                quality(frame, face)
            except ValueError:
                name = 'Unknown'
            a = face['facial_area']
            results.append({'x': a['x'], 'y': a['y'], 'w': a['w'], 'h': a['h'],
                            'name': name, 'distance': distance})
        return {'faces': results}

@router.post('/enroll')
async def enroll(name: str = Form(...), file: UploadFile = File(...)):
    name = unicodedata.normalize('NFC', name).strip()
    if not name or len(name) > 80 or any(unicodedata.category(c).startswith('C') for c in name):
        return JSONResponse(status_code=400, content={'message': 'กรุณาใส่ชื่อที่ถูกต้อง (ไม่เกิน 80 ตัวอักษร)'})
    raw = await file.read()
    frame = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        return JSONResponse(status_code=400, content={'message': 'ภาพไม่ถูกต้อง กรุณาถ่ายใหม่'})
    with LOCK:
        faces = representations(frame)
        if len(faces) != 1:
            return JSONResponse(status_code=400, content={'message': 'ต้องเห็นใบหน้าชัดเจนเพียงคนเดียวในภาพ'})
        try:
            quality(frame, faces[0])
        except ValueError as exc:
            return JSONResponse(status_code=400, content={'message': str(exc)})
        profiles = read_profiles()
        samples = profiles.setdefault(name, [])
        samples.append(faces[0]['embedding'])
        profiles[name] = samples[-20:]
        # Persist only after detection/quality validation. Names never become paths.
        folder = ROOT / 'samples'
        folder.mkdir(parents=True, exist_ok=True)
        photo = folder / (uuid.uuid4().hex + '.jpg')
        photo.write_bytes(cv2.imencode('.jpg', frame)[1].tobytes())
        try:
            save_profiles(profiles)
        except Exception:
            photo.unlink(missing_ok=True)
            raise
        return {'status': 'success', 'name': name, 'known_profiles': len(profiles),
                'samples': len(profiles[name]), 'model': 'VGG-Face'}
