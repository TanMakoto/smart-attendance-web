"""Use existing CCTV pose/log handling with shared VGG-Face recognition."""
import sys
from pathlib import Path
import requests
import uvicorn
from fastapi import File, Form, UploadFile
from fastapi.responses import JSONResponse

SOURCE = Path(r'D:\smart-attendance-web-main\Gesture-Recognition-master\cctv_service.py')
sys.path.insert(0, str(SOURCE.parent))
source = SOURCE.read_text(encoding='utf-8')
start = source.index('    # 1. Face Recognition', source.index('async def analyze_frame'))
end = source.index('    # 2. Pose & Gait Detection', start)
source = source[:start] + '''    # Shared VGG-Face inference in the Face API process.
    try:
        reply = requests.post('http://127.0.0.1:8000/internal/cctv/recognize',
                              files={'file': ('frame.jpg', contents, 'image/jpeg')}, timeout=45)
        reply.raise_for_status()
        detected_faces = reply.json()['faces']
    except (requests.RequestException, ValueError, KeyError):
        return JSONResponse(status_code=503, content={'message': 'Face AI unavailable. Please retry.'})
    current_name = next((face['name'] for face in detected_faces if face['name'] != 'Unknown'), 'Unknown')

''' + source[end:]
scope = {'__file__': str(SOURCE), '__name__': 'cctv_runtime', 'requests': requests}
exec(compile(source, str(SOURCE), 'exec'), scope)
app = scope['app']
# Keep the web client's existing endpoints. Remove old LBPH enrollment/status and
# the legacy stream, which otherwise could still return LBPH identities.
app.router.routes = [r for r in app.router.routes if getattr(r, 'path', '') not in
                     ('/api/cctv/enroll_face', '/api/cctv/status', '/api/cctv/stream')]

@app.get('/api/cctv/status')
def status():
    try:
        response = requests.get('http://127.0.0.1:8000/internal/cctv/profiles', timeout=5)
        response.raise_for_status()
        return {'status': 'online', 'cctv_active': scope['CCTV_ACTIVE'], **response.json()}
    except requests.RequestException:
        return JSONResponse(status_code=503, content={'status': 'offline', 'message': 'Face AI not ready'})

@app.post('/api/cctv/enroll_face')
async def enroll(name: str = Form(...), file: UploadFile = File(...)):
    try:
        response = requests.post('http://127.0.0.1:8000/internal/cctv/enroll',
                                 data={'name': name},
                                 files={'file': ('frame.jpg', await file.read(), 'image/jpeg')}, timeout=60)
        return JSONResponse(status_code=response.status_code, content=response.json())
    except (requests.RequestException, ValueError):
        return JSONResponse(status_code=503, content={'message': 'Face AI not ready. Please retry.'})

if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=8001)
