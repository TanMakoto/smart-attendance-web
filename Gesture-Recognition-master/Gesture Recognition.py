import os
import time
import csv
from datetime import datetime
import cv2
import mediapipe as mp
import numpy as np
from gait_detector import (
    StableGaitDetector,
    collect_data_mode,
    draw_skeleton,
    extract_features,
    open_webcam,
)
from gait_recognition import load_profiles, identify_gait

# LBPH reports a lower value for a closer match.  Unknown faces must pass this
# conservative threshold before being assigned an enrolled name.
FACE_CONFIDENCE_THRESHOLD = float(os.getenv("CCTV_FACE_CONFIDENCE_THRESHOLD", "60"))

try:
    mp_pose = mp.solutions.pose
except AttributeError:
    import mediapipe.python.solutions.pose as mp_pose

# ตัวแปร Global สำหรับเก็บเวลาบันทึก Log ล่าสุด
last_log_time = 0


def load_known_faces():
    """โหลดรูปภาพและเตรียมข้อมูลใบหน้าสำหรับเปรียบเทียบด้วย OpenCV Face Recognizer"""
    known_face_encodings = []
    known_face_names = []
    
    faces_dir = os.path.join(os.path.dirname(__file__), "known_faces")
    if not os.path.exists(faces_dir):
        os.makedirs(faces_dir)
        print(f"[INFO] Created folder '{faces_dir}'")
        return known_face_encodings, known_face_names

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
                    known_face_encodings.append(face_roi)
                    name = os.path.splitext(filename)[0]
                    known_face_names.append(name)
                    print(f"Loaded face for: {name}")
                else:
                    print(f"[WARNING] No face found in file {filename}")
            else:
                print(f"[WARNING] Unable to read image file {filename}")
                
    return known_face_encodings, known_face_names


def log_movement_data(name, gait_status, features):
    """บันทึกข้อมูล Log ลงไฟล์ CSV (จะบันทึกทุกๆ 2 วินาที เพื่อไม่ให้ไฟล์ข้อมูลซ้ำรวดเร็วเกินไป)"""
    global last_log_time
    current_time_epoch = time.time()
    if current_time_epoch - last_log_time >= 2.0:  # บันทึกทุก 2 วินาที
        csv_filename = os.path.join(os.path.dirname(__file__), "movement_activity_log.csv")
        file_exists = os.path.isfile(csv_filename)
        
        current_timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        
        with open(csv_filename, mode='a', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            # ถ้ายังไม่มีไฟล์ ให้สร้าง Header ก่อน
            if not file_exists:
                writer.writerow(["Timestamp", "Person_Name", "Gait_Status", "Hip_Feature", "Ankle_Feature", "Leg_Feature", "Arm_Feature", "Torso_Feature"])
            
            # บันทึกข้อมูล
            writer.writerow([
                current_timestamp, 
                name, 
                gait_status, 
                f"{features[0]:.4f}", 
                f"{features[1]:.4f}", 
                f"{features[2]:.4f}", 
                f"{features[3]:.4f}", 
                f"{features[4]:.4f}"
            ])
            
        print(f"[LOGGED]: [{current_timestamp}] {name} -> {gait_status}")
        last_log_time = current_time_epoch


def main():
    print("=== ระบบตรวจสอบท่าทางการเดินและจดจำบุคคลพร้อมบันทึก Log ===")
    choice = (
        input(
            "ต้องการเก็บข้อมูลท่าเดินปกติเพิ่มไหม? \nกด '0' = เก็บข้อมูลปกติ, กด Enter = เริ่มตรวจจับเลย: "
        )
        .strip()
        .lower()
    )

    if choice == "0":
        collect_data_mode(target_rows=600)

    print("กำลังโหลดฐานข้อมูลใบหน้า...")
    known_encodings, known_names = load_known_faces()
    
    face_recognizer = cv2.face.LBPHFaceRecognizer_create() if hasattr(cv2, 'face') else None
    if face_recognizer and len(known_encodings) > 0:
        face_recognizer.train(known_encodings, np.array(list(range(len(known_names)))))

    face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

    detector = StableGaitDetector(alpha=0.3)
    gait_profiles = load_profiles()
    cap = open_webcam()
    if cap is None or not cap.isOpened():
        print("Unable to open webcam. Please check your camera.")
        return

    cv2.namedWindow("Gait & Face Recognition", cv2.WINDOW_NORMAL)
    
    with mp_pose.Pose(
        min_detection_confidence=0.8, min_tracking_confidence=0.8
    ) as pose:
        while True:
            ret, frame = cap.read()
            if not ret:
                print("Warning: Can't receive frame. Retrying...")
                time.sleep(0.01)
                continue

            frame = cv2.flip(frame, 1)
            h, w, _ = frame.shape

            # --- 1. ส่วนการจดจำใบหน้า ---
            gray_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = face_cascade.detectMultiScale(gray_frame, scaleFactor=1.1, minNeighbors=5, minSize=(30, 30))

            current_name = "Unknown"
            for (x, y, fw, fh) in faces:
                cv2.rectangle(frame, (x, y), (x+fw, y+fh), (255, 165, 0), 2)
                if face_recognizer and len(known_encodings) > 0:
                    face_roi = cv2.resize(gray_frame[y:y+fh, x:x+fw], (100, 100))
                    label, confidence = face_recognizer.predict(face_roi)
                    if confidence <= FACE_CONFIDENCE_THRESHOLD and label < len(known_names): 
                        current_name = known_names[label]

            # --- 2. ส่วนการตรวจจับท่าเดินและการเคลื่อนไหว ---
            image_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            image_rgb.flags.writeable = False
            results = pose.process(image_rgb)
            image_rgb.flags.writeable = True
            image = cv2.cvtColor(image_rgb, cv2.COLOR_RGB2BGR)

            gait_label_text = "Detecting..."
            gait_color = (255, 255, 255)
            info_text = ""

            if results.pose_landmarks:
                landmarks = results.pose_landmarks.landmark
                check_joints = [
                    mp_pose.PoseLandmark.LEFT_HIP.value,
                    mp_pose.PoseLandmark.RIGHT_HIP.value,
                    mp_pose.PoseLandmark.LEFT_KNEE.value,
                    mp_pose.PoseLandmark.RIGHT_KNEE.value,
                    mp_pose.PoseLandmark.LEFT_ANKLE.value,
                    mp_pose.PoseLandmark.RIGHT_ANKLE.value,
                ]

                is_blocked = any(
                    landmarks[joint].visibility < 0.5 for joint in check_joints
                )

                if is_blocked:
                    gait_label_text = "Posture blocked"
                else:
                    draw_skeleton(image, landmarks, w, h)
                    features = extract_features(landmarks, w, h)
                    if features is not None:
                        identified_name = identify_gait(features, gait_profiles)
                        prediction = detector.predict(features, landmarks, w, h)

                        if prediction is not None:
                            pred, score, avg_features = prediction
                            label_str = "Abnormal gait" if pred == 1 else "Normal gait"
                            gait_color = (0, 0, 255) if pred == 1 else (0, 255, 0)
                            gait_label_text = f"{label_str} ({score:.2f})"

                            info_text = (
                                f"hip={avg_features[0]:.2f} ankle={avg_features[1]:.2f} "
                                f"leg={avg_features[2]:.2f} arm={avg_features[3]:.2f} torso={avg_features[4]:.2f}"
                            )

                            # บันทึกข้อมูลลง Log (ไฟล์ CSV) อัตโนมัติ
                            log_movement_data(identified_name if identified_name else current_name, label_str, avg_features)

            # --- 3. แสดงผลหน้าจอ ---
            cv2.putText(image, f"Name: {current_name}", (50, 60), cv2.FONT_HERSHEY_SIMPLEX, 1.3, (255, 165, 0), 3)
            cv2.putText(image, f"Gait: {gait_label_text}", (50, 120), cv2.FONT_HERSHEY_SIMPLEX, 1.3, gait_color, 3)

            if info_text:
                cv2.putText(image, info_text, (50, 180), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 255, 255), 2)

            cv2.putText(image, "Press q or Esc to quit", (50, h - 40), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (255, 255, 255), 2)
            cv2.imshow("Gait & Face Recognition", image)

            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), ord("Q"), 27):
                break

            if cv2.getWindowProperty("Gait & Face Recognition", cv2.WND_PROP_VISIBLE) < 1:
                break

    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
