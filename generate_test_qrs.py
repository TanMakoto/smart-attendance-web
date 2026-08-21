import urllib.request
import os

# Create a folder for test QR codes
qr_dir = "g:/smart-attendance-main/public/test_qrs"
os.makedirs(qr_dir, exist_ok=True)

# List of users to generate QR codes for
test_users = [
    {"id": "6612247018", "filename": "qr_nattawut.png", "label": "Nattawut"},
    {"id": "65010001", "filename": "qr_somchai.png", "label": "Somchai"},
    {"id": "65010002", "filename": "qr_somying.png", "label": "Somying"}
]

print("Starting QR Code generation...")

for user in test_users:
    # URL encoded student ID
    url = f"https://api.qrserver.com/v1/create-qr-code/?size=300x300&data={user['id']}"
    dest_path = os.path.join(qr_dir, user['filename'])
    
    try:
        print(f"Downloading QR for {user['label']} ({user['id']})...")
        urllib.request.urlretrieve(url, dest_path)
        print(f"Saved to: {dest_path}")
    except Exception as e:
        print(f"Error downloading QR for {user['label']}: {e}")

print("QR Code generation complete!")
