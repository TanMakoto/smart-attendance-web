import csv
import os
import time
from collections import deque
import cv2
import mediapipe as mp
import numpy as np
import pandas as pd
from sklearn.covariance import EllipticEnvelope

mp_drawing = mp.solutions.drawing_utils
mp_pose = mp.solutions.pose


def draw_skeleton(image, landmarks, width, height):
    """Draw a colored skeleton with dynamic thickness proportional to human body size."""
    face_ids = {
        mp_pose.PoseLandmark.NOSE.value,
        mp_pose.PoseLandmark.LEFT_EYE.value,
        mp_pose.PoseLandmark.RIGHT_EYE.value,
        mp_pose.PoseLandmark.LEFT_EAR.value,
        mp_pose.PoseLandmark.RIGHT_EAR.value,
    }
    left_ids = {lm.value for lm in mp_pose.PoseLandmark if "LEFT" in lm.name}
    right_ids = {lm.value for lm in mp_pose.PoseLandmark if "RIGHT" in lm.name}

    magenta = (180, 0, 180)
    orange = (0, 140, 255)
    cyan = (255, 255, 0)
    left_green = (0, 255, 0)
    right_blue = (255, 0, 0)
    joint_outline = (10, 10, 10)

    try:
        ls = landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER.value]
        rs = landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER.value]
        shoulder_width = np.hypot((ls.x - rs.x) * width, (ls.y - rs.y) * height)
    except Exception:
        shoulder_width = 100

    line_thickness = max(4, int(shoulder_width * 0.08))
    joint_radius = max(3, int(shoulder_width * 0.06))
    spine_thickness = max(6, int(shoulder_width * 0.11))

    spine_coords = None
    try:
        lh = landmarks[mp_pose.PoseLandmark.LEFT_HIP.value]
        rh = landmarks[mp_pose.PoseLandmark.RIGHT_HIP.value]
        top_left = (int(ls.x * width), int(ls.y * height))
        top_right = (int(rs.x * width), int(rs.y * height))
        bottom_left = (int(lh.x * width), int(lh.y * height))
        bottom_right = (int(rh.x * width), int(rh.y * height))

        shoulder_mid = (
            int((ls.x + rs.x) / 2 * width),
            int((ls.y + rs.y) / 2 * height),
        )
        hip_mid = (
            int((lh.x + rh.x) / 2 * width),
            int((lh.y + rh.y) / 2 * height),
        )
        spine_coords = (shoulder_mid, hip_mid)

        cv2.line(image, top_left, bottom_left, left_green, line_thickness + 2)
        cv2.line(image, top_right, bottom_right, right_blue, line_thickness + 2)
    except Exception:
        pass

    for conn in mp_pose.POSE_CONNECTIONS:
        try:
            s = conn[0].value
            e = conn[1].value
        except Exception:
            s = int(conn[0])
            e = int(conn[1])

        if s >= len(landmarks) or e >= len(landmarks):
            continue

        if (
            s
            in {
                mp_pose.PoseLandmark.LEFT_SHOULDER.value,
                mp_pose.PoseLandmark.RIGHT_SHOULDER.value,
            }
            and e
            in {
                mp_pose.PoseLandmark.LEFT_HIP.value,
                mp_pose.PoseLandmark.RIGHT_HIP.value,
            }
        ):
            continue
        if (
            e
            in {
                mp_pose.PoseLandmark.LEFT_SHOULDER.value,
                mp_pose.PoseLandmark.RIGHT_SHOULDER.value,
            }
            and s
            in {
                mp_pose.PoseLandmark.LEFT_HIP.value,
                mp_pose.PoseLandmark.RIGHT_HIP.value,
            }
        ):
            continue

        p1 = landmarks[s]
        p2 = landmarks[e]
        x1, y1 = int(p1.x * width), int(p1.y * height)
        x2, y2 = int(p2.x * width), int(p2.y * height)

        if s in left_ids and e in left_ids:
            color = left_green
            t = line_thickness
        elif s in right_ids and e in right_ids:
            color = right_blue
            t = line_thickness
        else:
            if s in face_ids or e in face_ids:
                color = magenta
                t = max(2, line_thickness - 2)
            else:
                color = orange
                t = max(2, line_thickness - 2)

        cv2.line(image, (x1, y1), (x2, y2), color, t)

    for idx, lm in enumerate(landmarks):
        x, y = int(lm.x * width), int(lm.y * height)
        if idx in face_ids:
            inner = magenta
            r = max(3, joint_radius - 1)
        elif idx in left_ids:
            inner = left_green
            r = joint_radius
        elif idx in right_ids:
            inner = right_blue
            r = joint_radius
        else:
            inner = orange
            r = max(3, joint_radius - 2)

        cv2.circle(image, (x, y), r + 2, joint_outline, -1)
        cv2.circle(image, (x, y), r, inner, -1)

    if spine_coords is not None:
        cv2.line(image, spine_coords[0], spine_coords[1], cyan, spine_thickness)


def extract_features(landmarks, width, height):
    """สกัดฟีเจอร์ท่าเดินจากจุดโครงกระดูก"""
    def get_point(name):
        try:
            lm = landmarks[name.value]
        except (IndexError, AttributeError):
            return None
        if lm is None:
            return None
        return np.array([lm.x * width, lm.y * height], dtype=float)

    points = {
        "left_shoulder": get_point(mp_pose.PoseLandmark.LEFT_SHOULDER),
        "right_shoulder": get_point(mp_pose.PoseLandmark.RIGHT_SHOULDER),
        "left_hip": get_point(mp_pose.PoseLandmark.LEFT_HIP),
        "right_hip": get_point(mp_pose.PoseLandmark.RIGHT_HIP),
        "left_knee": get_point(mp_pose.PoseLandmark.LEFT_KNEE),
        "right_knee": get_point(mp_pose.PoseLandmark.RIGHT_KNEE),
        "left_ankle": get_point(mp_pose.PoseLandmark.LEFT_ANKLE),
        "right_ankle": get_point(mp_pose.PoseLandmark.RIGHT_ANKLE),
        "left_wrist": get_point(mp_pose.PoseLandmark.LEFT_WRIST),
        "right_wrist": get_point(mp_pose.PoseLandmark.RIGHT_WRIST),
    }

    if any(v is None for v in points.values()):
        return None

    shoulder_width = np.linalg.norm(
        points["left_shoulder"] - points["right_shoulder"]
    )
    if shoulder_width < 1e-5:
        return None

    left_hip = points["left_hip"]
    right_hip = points["right_hip"]
    left_shoulder = points["left_shoulder"]
    right_shoulder = points["right_shoulder"]
    left_knee = points["left_knee"]
    right_knee = points["right_knee"]
    left_ankle = points["left_ankle"]
    right_ankle = points["right_ankle"]
    left_wrist = points["left_wrist"]
    right_wrist = points["right_wrist"]

    hip_asymmetry = abs(left_hip[1] - right_hip[1]) / shoulder_width
    ankle_asymmetry = abs(left_ankle[1] - right_ankle[1]) / shoulder_width
    leg_extension_diff = (
        abs((left_knee[1] - left_hip[1]) - (right_knee[1] - right_hip[1]))
        / shoulder_width
    )
    arm_swing_diff = (
        abs(
            (left_wrist[1] - left_shoulder[1])
            - (right_wrist[1] - right_shoulder[1])
        )
        / shoulder_width
    )
    
    shoulder_mid_x = (left_shoulder[0] + right_shoulder[0]) / 2.0
    hip_mid_x = (left_hip[0] + right_hip[0]) / 2.0
    torso_shift = abs(shoulder_mid_x - hip_mid_x) / shoulder_width

    features = np.array(
        [
            hip_asymmetry,
            ankle_asymmetry,
            leg_extension_diff,
            arm_swing_diff,
            torso_shift,
        ],
        dtype=float,
    )
    return features


def train_model():
    """เทรนโมเดลจากข้อมูลท่าเดินปกติเท่านั้น"""
    base_dir = os.path.dirname(__file__)
    target_csv = os.path.join(base_dir, "new_gait_dataset.csv")
    if not os.path.exists(target_csv):
        target_csv = os.path.join(base_dir, "gait_dataset.csv")

    X_normal = None
    if os.path.exists(target_csv):
        try:
            df = pd.read_csv(target_csv, header=None)
            df_normal = df[df.iloc[:, -1] == 0]
            if len(df_normal) > 5:
                X_normal = df_normal.iloc[:, :-1].values
        except Exception as e:
            print(f"เกิดข้อผิดพลาดในการโหลด CSV: {e}")

    if X_normal is None or len(X_normal) == 0:
        X_normal = np.array(
            [
                [0.02, 0.01, 0.03, 0.04, 0.08],
                [0.03, 0.02, 0.02, 0.05, 0.10],
                [0.01, 0.03, 0.04, 0.03, 0.07],
                [0.04, 0.02, 0.03, 0.04, 0.09],
            ],
            dtype=float,
        )

    model = EllipticEnvelope(contamination=0.01, random_state=42)
    model.fit(X_normal)
    print("[GaitDetector] Anomaly Detection model trained successfully!")
    return model


class StableGaitDetector:

    def __init__(self, alpha=0.3):
        self.model = train_model()
        self.alpha = alpha
        self.smoothed_features = None
        self.state_history = deque(maxlen=8)

    def predict(self, features, landmarks=None, width=0, height=0):
        if features is None:
            return None

        # --- Rule-based: ตรวจจับท่าชูแขน และ ท่าเดินกระเพก ---
        is_rule_abnormal = False
        
        hip_asymmetry = features[0]
        leg_extension_diff = features[2]

        # 1. เช็คท่าชูแขน
        if landmarks is not None and height > 0:
            try:
                left_wrist_y = landmarks[mp_pose.PoseLandmark.LEFT_WRIST.value].y * height
                right_wrist_y = landmarks[mp_pose.PoseLandmark.RIGHT_WRIST.value].y * height
                left_shoulder_y = landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER.value].y * height
                right_shoulder_y = landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER.value].y * height
                
                if left_wrist_y < left_shoulder_y or right_wrist_y < right_shoulder_y:
                    is_rule_abnormal = True
            except Exception:
                pass

        # 2. ปรับค่า Threshold ให้ปลอดภัยขึ้นจาก 0.06 เป็น 0.09 เพื่อให้เดินปกตินิ่งไม่กะพริบ
        if hip_asymmetry > 0.09 or leg_extension_diff > 0.09:
            is_rule_abnormal = True

        if self.smoothed_features is None:
            self.smoothed_features = features
        else:
            self.smoothed_features = (
                self.alpha * features + (1 - self.alpha) * self.smoothed_features
            )

        # 1 = ปกติ, -1 = ผิดปกติ (Outlier)
        prediction_raw = self.model.predict([self.smoothed_features])[0]
        pred = 0 if prediction_raw == 1 else 1

        if is_rule_abnormal:
            pred = 1
            self.state_history.clear()

        score = 0.95 if pred == 0 else 0.85  

        self.state_history.append(pred)
        
        if is_rule_abnormal:
            stable_pred = 1
        else:
            stable_pred = (
                1
                if sum(self.state_history) > (len(self.state_history) / 2)
                else 0
            )

        return stable_pred, score, self.smoothed_features


def open_webcam():
    cap = cv2.VideoCapture(0, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        cap = cv2.VideoCapture(1, cv2.CAP_DSHOW)
    if not cap.isOpened():
        cap = cv2.VideoCapture(1)

    if cap.isOpened():
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
        cap.set(cv2.CAP_PROP_FPS, 30)
        
    return cap


def collect_data_mode(target_rows=600):
    """โหมดบันทึกเฉพาะข้อมูลท่าเดินปกติ (Label = 0)"""
    cap = open_webcam()
    if cap is None or not cap.isOpened():
        print("ไม่สามารถเปิดกล้องได้")
        return

    output_filename = "new_gait_dataset.csv"

    print(f"\n--- โหมดบันทึกข้อมูลท่าเดินปกติ ไปที่ไฟล์ {output_filename} ---")
    print(f"เตรียมนับถอยหลัง 3 วินาที แล้วระบบจะบันทึกอัตโนมัติจนครบ {target_rows} แถว")

    data_rows = []
    feature_window = deque(maxlen=10)

    with mp_pose.Pose(
        min_detection_confidence=0.5, min_tracking_confidence=0.5
    ) as pose:
        countdown_start = time.time()
        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break
            frame = cv2.flip(frame, 1)
            h, w, _ = frame.shape

            elapsed = time.time() - countdown_start
            remaining = int(3 - elapsed)

            if remaining >= 0:
                cv2.putText(
                    frame,
                    f"Get Ready: {remaining + 1}",
                    (w // 2 - 150, h // 2),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    2.5,
                    (0, 165, 255),
                    5,
                )
                cv2.imshow("Data Collection Mode", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    cap.release()
                    cv2.destroyAllWindows()
                    return
            else:
                break

        print(">>> เริ่มบันทึกข้อมูลปกติอัตโนมัติแล้ว...")

        while cap.isOpened():
            ret, frame = cap.read()
            if not ret:
                break

            frame = cv2.flip(frame, 1)
            h, w, _ = frame.shape
            
            image_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            results = pose.process(image_rgb)

            if results.pose_landmarks:
                landmarks = results.pose_landmarks.landmark
                draw_skeleton(frame, landmarks, w, h)
                features = extract_features(landmarks, w, h)

                if features is not None:
                    feature_window.append(features)

                if len(feature_window) == 10:
                    window_arr = np.array(feature_window)
                    mean_vals = np.mean(window_arr, axis=0)
                    std_vals = np.std(window_arr, axis=0)

                    current_feat = feature_window[-1]
                    is_outlier = np.any(
                        np.abs(current_feat - mean_vals)
                        > (2 * (std_vals + 1e-5))
                    )

                    if not is_outlier:
                        row = list(mean_vals) + [0]
                        data_rows.append(row)

            progress_text = f"RECORDING: {len(data_rows)} / {target_rows}"
            cv2.putText(
                frame,
                progress_text,
                (50, 60),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.2,
                (0, 255, 0),
                3,
            )
            cv2.putText(
                frame,
                "Press 'q' to stop & save",
                (50, 120),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.0,
                (0, 0, 255),
                2,
            )
            cv2.imshow("Data Collection Mode", frame)

            if len(data_rows) >= target_rows:
                print(f"บันทึกครบ {target_rows} แถวเรียบร้อยแล้ว!")
                break

            key = cv2.waitKey(1) & 0xFF
            if key in (ord("q"), ord("Q"), 27):
                print("ผู้ใช้กดหยุดการบันทึกก่อนกำหนด")
                break

    cap.release()
    cv2.destroyAllWindows()

    if data_rows:
        with open(output_filename, mode="a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerows(data_rows)
        print(f"📁 บันทึกข้อมูลลงในไฟล์ '{output_filename}' สำเร็จ! เพิ่มข้อมูลไปทั้งสิ้น {len(data_rows)} แถว")
    else:
        print("⚠️ ไม่พบข้อมูลโครงกระดูกที่บันทึกได้ กรุณาลองใหม่อีกครั้ง")