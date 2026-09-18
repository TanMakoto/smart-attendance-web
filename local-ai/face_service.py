import sys
from pathlib import Path
import uvicorn
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, r'D:\titan-auth-api-main\titan-auth-api-main\src')
from api import app
from cctv_embeddings import router, migrate_legacy
app.include_router(router)
app.router.on_startup.append(migrate_legacy)
if __name__ == '__main__':
    uvicorn.run(app, host='0.0.0.0', port=8000)
