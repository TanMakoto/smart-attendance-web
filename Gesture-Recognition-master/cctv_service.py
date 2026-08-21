import os
import time
import csv
import json
import cv2
import asyncio
import numpy as np
from datetime import datetime
from typing import List, Dict, Optional
from fastapi import FastAPI, File, UploadFile, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
import mediapipe as mp

from gait_detector import StableGaitDetector, draw_skeleton, extract_features, open_webcam
from gait_recognition import load_profiles, identify_gait

app = FastAPI(title="CCTV AI Surveillance API Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global States
CCTV_ACTIVE = False
cap_global = None
known_encodings = []
known_names = []
face_recognizer = None
face_cascade = None
gait_detector = None
gait_profiles = {}
mp_pose = mp.solutions.pose
# LBPH reports a lower value for a closer match.  Keep this conservative so
# people without an enrolled profile remain "Unknown" instead of being mapped
# to the nearest known face.
FACE_CONFIDENCE_THRESHOLD = float(os.getenv("CCTV_FACE_CONFIDENCE_THRESHOLD", "60"))

# In-memory recent logs cache
recent_logs: List[Dict] = []
last_log_time = 0

def load_known_faces():
    """Load face profiles from known_faces directory"""
    global known_encodings, known_names, face_recognizer, face_cascade
    known_encodings = []
    known_names = []
    
    faces_dir = os.path.join(os.path.dirname(__file__), "known_faces")
    if not os.path.exists(faces_dir):
        os.makedirs(faces_dir)
        print(f"[INFO] Created folder '{faces_dir}'")
        return

    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

    for filename in os.listdir(faces_dir):
        if filename.lower().endswith((".jpg", ".jpeg", ".png")):
            path = os.path.join(faces_dir, filename)
            img_cv = cv2.imread(path)
            
            if img_cv is not None:
                gray = cv2.cvtColor(img_cv, cv2.COLOR_BGR2GRAY)
                faces = face_cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
                
                if len(faces) > 0:
                    (x, y, w, h) = faces[0]
                    face_roi = cv2.resize(gray[y:y+h, x:x+w], (100, 100))
                    known_encodings.append(face_roi)
                    name = os.path.splitext(filename)[0]
                    known_names.append(name)
                    print(f"[INFO] Loaded CCTV Face Profile: {name}")

    if hasattr(cv2, 'face') and len(known_encodings) > 0:
        face_recognizer = cv2.face.LBPHFaceRecognizer_create()
        face_recognizer.train(known_encodings, np.array(list(range(len(known_names)))))
    else:
        face_recognizer = None

global_pose = None

def init_ai_models():
    global gait_detector, gait_profiles, face_cascade, global_pose
    if face_cascade is None:
        face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    load_known_faces()
    gait_detector = StableGaitDetector(alpha=0.3)
    gait_profiles = load_profiles()
    try:
        global_pose = mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5)
    except Exception as e:
        print(f"[CCTV] Pose Model Init Warning: {e}")
    print("[CCTV] AI Surveillance Models initialized successfully.")

@app.on_event("startup")
def startup_event():
    init_ai_models()

def log_movement_event(name: str, gait_status: str, features: np.ndarray):
    global last_log_time, recent_logs
    current_time_epoch = time.time()
    if current_time_epoch - last_log_time >= 2.0:  # Log every 2 seconds
        csv_filename = os.path.join(os.path.dirname(__file__), "movement_activity_log.csv")
        file_exists = os.path.isfile(csv_filename)
        current_timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        feat_list = [float(f) for f in features] if features is not None else [0.0]*5
        
        log_entry = {
            "timestamp": current_timestamp,
            "name": name,
            "gait_status": gait_status,
            "hip": round(feat_list[0], 4),
            "ankle": round(feat_list[1], 4),
            "leg": round(feat_list[2], 4),
            "arm": round(feat_list[3], 4),
            "torso": round(feat_list[4], 4),
        }
        
        with open(csv_filename, mode='a', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(["Timestamp", "Person_Name", "Gait_Status", "Hip_Feature", "Ankle_Feature", "Leg_Feature", "Arm_Feature", "Torso_Feature"])
            writer.writerow([
                current_timestamp, 
                name, 
                gait_status, 
                f"{feat_list[0]:.4f}", 
                f"{feat_list[1]:.4f}", 
                f"{feat_list[2]:.4f}", 
                f"{feat_list[3]:.4f}", 
                f"{feat_list[4]:.4f}"
            ])
            
        recent_logs.insert(0, log_entry)
        recent_logs = recent_logs[:50]
        last_log_time = current_time_epoch
        print(f"[CCTV Event Logged]: {current_timestamp} | {name} -> {gait_status}")

@app.get("/api/cctv/status")
def get_status():
    return {
        "status": "online",
        "cctv_active": CCTV_ACTIVE,
        "known_profiles": len(known_names),
        "profiles": known_names
    }

@app.get("/api/cctv/logs")
def get_movement_logs(limit: int = 20):
    """Retrieve the latest movement logs from movement_activity_log.csv"""
    csv_filename = os.path.join(os.path.dirname(__file__), "movement_activity_log.csv")
    logs = []
    if os.path.isfile(csv_filename):
        try:
            with open(csv_filename, mode='r', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    logs.append({
                        "timestamp": row.get("Timestamp", ""),
                        "name": row.get("Person_Name", "Unknown"),
                        "gait_status": row.get("Gait_Status", "Normal gait"),
                        "hip": row.get("Hip_Feature", "0"),
                        "ankle": row.get("Ankle_Feature", "0"),
                        "leg": row.get("Leg_Feature", "0"),
                        "arm": row.get("Arm_Feature", "0"),
                        "torso": row.get("Torso_Feature", "0"),
                    })
        except Exception as e:
            print(f"Error reading CSV logs: {e}")
    
    logs.reverse()  # Show most recent first
    return {"status": "success", "count": len(logs), "logs": logs[:limit]}

@app.post("/api/cctv/analyze_frame")
async def analyze_frame(file: UploadFile = File(...)):
    """API Endpoint for web client to send webcam frames for AI CCTV passerby analysis"""
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    if frame is None:
        return JSONResponse(status_code=400, content={"error": "Invalid frame"})

    h, w, _ = frame.shape
    gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    
    # 1. Face Recognition
    faces = face_cascade.detectMultiScale(gray_frame, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
    detected_faces = []
    current_name = "Unknown"
    
    for (x, y, fw, fh) in faces:
        face_name = "Unknown"
        if face_recognizer and len(known_encodings) > 0:
            face_roi = cv2.resize(gray_frame[y:y+fh, x:x+fw], (100, 100))
            label, confidence = face_recognizer.predict(face_roi)
            if confidence <= FACE_CONFIDENCE_THRESHOLD and label < len(known_names):
                face_name = known_names[label]
                current_name = face_name
        
        detected_faces.append({
            "x": int(x), "y": int(y), "w": int(fw), "h": int(fh),
            "name": face_name
        })

    # 2. Pose & Gait Detection
    gait_result = {"status": "Detecting...", "is_abnormal": False, "score": 0.0}
    landmarks_data = []
    features_to_log = np.zeros(5)
    gait_label_to_log = "Normal gait"
    person_to_log = current_name
    should_log = len(detected_faces) > 0

    if global_pose is not None:
        try:
            image_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = global_pose.process(image_rgb)
            
            if results and results.pose_landmarks:
                should_log = True
                landmarks = results.pose_landmarks.landmark
                landmarks_data = [{"x": lm.x, "y": lm.y, "visibility": lm.visibility} for lm in landmarks]
                
                features = extract_features(landmarks, w, h)
                if features is not None:
                    identified_gait_name = identify_gait(features, gait_profiles)
                    prediction = gait_detector.predict(features, landmarks, w, h)
                    
                    if prediction is not None:
                        pred, score, avg_features = prediction
                        gait_label_to_log = "Abnormal gait" if pred == 1 else "Normal gait"
                        if identified_gait_name:
                            person_to_log = identified_gait_name
                        features_to_log = avg_features
                        
                        gait_result = {
                            "status": gait_label_to_log,
                            "is_abnormal": pred == 1,
                            "score": round(score, 2),
                            "person": person_to_log
                        }
        except Exception as e:
            print(f"[CCTV Pose Error]: {e}")

    if should_log:
        log_movement_event(person_to_log, gait_label_to_log, features_to_log)

    return {
        "status": "success",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "name": current_name,
        "width": w,
        "height": h,
        "faces": detected_faces,
        "gait": gait_result,
        "has_pose": len(landmarks_data) > 0
    }

@app.post("/api/cctv/enroll_face")
async def enroll_cctv_face(name: str = Form(...), file: UploadFile = File(...)):
    """Enroll a new face image into known_faces directory and retrain model"""
    faces_dir = os.path.join(os.path.dirname(__file__), "known_faces")
    if not os.path.exists(faces_dir):
        os.makedirs(faces_dir)
        
    safe_name = "".join(c for c in name if c.isalnum() or c in (' ', '_', '-')).strip()
    if not safe_name:
        safe_name = f"User_{int(time.time())}"
        
    file_path = os.path.join(faces_dir, f"{safe_name}.jpg")
    contents = await file.read()
    with open(file_path, "wb") as f:
        f.write(contents)
        
    load_known_faces()
    return {
        "status": "success",
        "name": safe_name,
        "message": f"Enrolled face profile for {safe_name} successfully!",
        "known_profiles": len(known_names)
    }

def generate_cctv_frames():
    """Video streaming generator for CCTV backend camera"""
    global cap_global, CCTV_ACTIVE
    cap = open_webcam()
    cap_global = cap
    CCTV_ACTIVE = True
    
    with mp_pose.Pose(min_detection_confidence=0.8, min_tracking_confidence=0.8) as pose:
        while CCTV_ACTIVE and cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
                
            frame = cv2.flip(frame, 1)
            h, w, _ = frame.shape
            gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            
            # Face Detection
            faces = face_cascade.detectMultiScale(gray_frame, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))
            current_name = "Unknown"
            for (x, y, fw, fh) in faces:
                cv2.rectangle(frame, (x, y), (x+fw, y+fh), (255, 165, 0), 2)
                if face_recognizer and len(known_encodings) > 0:
                    face_roi = cv2.resize(gray_frame[y:y+fh, x:x+fw], (100, 100))
                    label, confidence = face_recognizer.predict(face_roi)
                    if confidence <= FACE_CONFIDENCE_THRESHOLD and label < len(known_names):
                        current_name = known_names[label]
                cv2.putText(frame, current_name, (x, y - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 165, 0), 2)

            # Gait & Skeleton
            image_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = pose.process(image_rgb)
            gait_label_text = "Detecting..."
            gait_color = (255, 255, 255)
            
            if results.pose_landmarks:
                landmarks = results.pose_landmarks.landmark
                check_joints = [
                    mp_pose.PoseLandmark.LEFT_HIP.value, mp_pose.PoseLandmark.RIGHT_HIP.value,
                    mp_pose.PoseLandmark.LEFT_KNEE.value, mp_pose.PoseLandmark.RIGHT_KNEE.value,
                    mp_pose.PoseLandmark.LEFT_ANKLE.value, mp_pose.PoseLandmark.RIGHT_ANKLE.value,
                ]
                if not any(landmarks[j].visibility < 0.5 for j in check_joints):
                    draw_skeleton(frame, landmarks, w, h)
                    features = extract_features(landmarks, w, h)
                    if features is not None:
                        identified_name = identify_gait(features, gait_profiles)
                        prediction = gait_detector.predict(features, landmarks, w, h)
                        if prediction is not None:
                            pred, score, avg_features = prediction
                            label_str = "Abnormal gait" if pred == 1 else "Normal gait"
                            gait_color = (0, 0, 255) if pred == 1 else (0, 255, 0)
                            gait_label_text = f"{label_str} ({score:.2f})"
                            final_name = identified_name if identified_name else current_name
                            log_movement_event(final_name, label_str, avg_features)

            # UI overlays on video stream
            cv2.putText(frame, f"CCTV AI Surveillance - Live", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2)
            cv2.putText(frame, f"Identity: {current_name}", (20, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (255, 165, 0), 2)
            cv2.putText(frame, f"Gait Status: {gait_label_text}", (20, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.8, gait_color, 2)
            
            ret, buffer = cv2.imencode('.jpg', frame)
            frame_bytes = buffer.tobytes()
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
                   
    cap.release()
    CCTV_ACTIVE = False

@app.get("/api/cctv/stream")
def video_feed():
    """Stream CCTV video with AI bounding boxes and pose landmark overlay"""
    return StreamingResponse(generate_cctv_frames(), media_type="multipart/x-mixed-replace; boundary=frame")

@app.post("/api/cctv/stop")
def stop_cctv():
    global CCTV_ACTIVE
    CCTV_ACTIVE = False
    return {"status": "stopped"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
