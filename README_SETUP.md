# 📘 คู่มือการติดตั้งและเปิดใช้งานระบบบนเครื่องใหม่ (Setup Guide for New Computer)

> **คู่มือฉบับสมบูรณ์สำหรับการย้ายโปรเจกต์ไปติดตั้งและเปิดใช้งานบนเครื่องอื่นตั้งแต่ต้นจนจบ**

---

## 📋 1. สิ่งที่ต้องติดตั้งล่วงหน้าบนเครื่องใหม่ (Prerequisites)

ก่อนเริ่มใช้งาน ให้ดาวน์โหลดและติดตั้งโปรแกรมหลักเหล่านี้บนเครื่องใหม่:

1. **Node.js** (แนะนำเวอร์ชัน 18 ขึ้นไป): [https://nodejs.org/](https://nodejs.org/)
2. **Python** (แนะนำเวอร์ชัน 3.11): [https://www.python.org/downloads/](https://www.python.org/downloads/)
   * ⚠️ **สำคัญตอนติดตั้ง**: ติ๊กเลือก `Add Python to PATH` ด้วยทุกครั้ง
3. **Git**: [https://git-scm.com/](https://git-scm.com/)

---

## 📂 2. โครงสร้างโฟลเดอร์ของโปรเจกต์ (Project Structure)

โปรเจกต์นี้แบ่งออกเป็น **3 ส่วนหลัก** ควรวางโฟลเดอร์ไว้ให้อยู่ในลำดับเดียวกัน:

```text
📁 smart-attendance-main/  (Frontend - React + Vite)
📁 gait_face_auth-main/    (AI Face API - Python FastAPI)
📁 new-data2/              (Backend - Node.js + MongoDB)
```

---

## 🛠️ 3. ขั้นตอนการเตรียมโปรเจกต์บนเครื่องใหม่ (One-Time Setup)

### 🔹 3.1 เตรียมเซิร์ฟเวอร์ฐานข้อมูล (Backend - `new-data2`)
1. เปิด Terminal เข้าไปยังโฟลเดอร์ `new-data2`:
   ```powershell
   cd path/to/new-data2
   ```
2. ติดตั้ง NPM Packages:
   ```powershell
   npm install
   ```
3. สร้างไฟล์ชื่อ `.env` ไว้ในโฟลเดอร์ `new-data2` และใส่ค่า Connection String ของ MongoDB:
   ```env
   MONGO_URI="mongodb://admin:admin123456@ac-ulgvgct-shard-00-00.vtngvue.mongodb.net:27017,ac-ulgvgct-shard-00-01.vtngvue.mongodb.net:27017,ac-ulgvgct-shard-00-02.vtngvue.mongodb.net:27017/attendanceDB?ssl=true&replicaSet=atlas-8ob2z2-shard-0&authSource=admin&appName=Cluster0"
   PORT=3000
   ```

---

### 🔹 3.2 เตรียมเซิร์ฟเวอร์ AI ตรวจจับใบหน้า (AI Face - `gait_face_auth-main`)
1. เปิด Terminal เข้าไปยังโฟลเดอร์ `gait_face_auth-main`:
   ```powershell
   cd path/to/gait_face_auth-main
   ```
2. ติดตั้ง Python Libraries ที่ต้องใช้ตามไฟล์ `requirements.txt`:
   ```powershell
   pip install -r requirements.txt
   ```
   *หากมีข้อผิดพลาดเรื่อง OpenCV ให้รันคำสั่งนี้เพิ่มเติม:*
   ```powershell
   pip install opencv-contrib-python==4.10.0.84
   ```

---

### 🔹 3.3 เตรียมหน้าเว็บ Frontend (`smart-attendance-main`)
1. เปิด Terminal เข้าไปยังโฟลเดอร์ `smart-attendance-main`:
   ```powershell
   cd path/to/smart-attendance-main
   ```
2. ติดตั้ง NPM Packages:
   ```powershell
   npm install
   ```
3. สร้างไฟล์ชื่อ `.env.local` ไว้ในโฟลเดอร์ `smart-attendance-main`:
   ```env
   # สำหรับรันเครื่อง Local:
   VITE_ATTENDANCE_API_URL=http://localhost:3000
   VITE_API_URL=http://localhost:8000/api/verify_face

   # สำหรับรันเซิร์ฟเวอร์ Cloud (Render):
   # VITE_ATTENDANCE_API_URL=https://psru-attendance-db.onrender.com
   # VITE_API_URL=https://titan-auth-api.onrender.com/api/verify_face
   ```

### Vercel: Dynamic QR อายุ 1 นาที

ตั้ง Environment Variables ต่อไปนี้ใน Vercel แล้ว Redeploy:

```env
QR_SECRET=<ค่าสุ่มอย่างน้อย 32 ตัวอักษร>
QR_ADMIN_KEY=<ค่าสุ่มอย่างน้อย 24 ตัวอักษร>
```

สร้าง token จากระบบผู้ดูแลด้วย `POST /api/generate_qr`:

```bash
curl -X POST https://YOUR_VERCEL_DOMAIN/api/generate_qr \
  -H "Content-Type: application/json" \
  -H "x-qr-admin-key: YOUR_QR_ADMIN_KEY" \
  -d '{"student_id":"6612247018"}'
```

นำค่า `token` จากผลลัพธ์ไปสร้างเป็นภาพ QR ระบบสแกนจะตรวจลายเซ็นและหมดอายุภายใน 60 วินาที โดยไม่พึ่งข้อมูลใน memory ของ Vercel instance

หรือเปิดหน้าสร้าง QR ที่มากับระบบได้ที่:

```text
https://YOUR_VERCEL_DOMAIN/qr-generator.html
```

กรอกรหัสนักศึกษาและค่า `QR_ADMIN_KEY` หน้าเว็บจะสร้าง QR ใหม่ให้อัตโนมัติทุก 60 วินาที

---

## 🚀 4. ขั้นตอนการเปิดใช้งาน (Run Project)

เมื่อต้องการเปิดใช้งาน ให้เปิด Terminal ขึ้นมา **3 หน้าต่าง (3 Tabs)** และรันคำสั่งตามลำดับดังนี้:

### 1️⃣ หน้าต่างที่ 1: เปิด AI Face Server (Port 8000)
```powershell
cd path/to/gait_face_auth-main
python src/api.py
```
> ✅ รอจนขึ้นข้อความ `DeepFace VGG-Face model pre-loaded.` และ `Uvicorn running on http://0.0.0.0:8000`

---

### 2️⃣ หน้าต่างที่ 2: เปิด Attendance DB Server (Port 3000)
```powershell
cd path/to/new-data2
node server.js
```
> ✅ รอจนขึ้นข้อความ `Server running on port 3000` และ `MongoDB Connected ✅`

---

### 3️⃣ หน้าต่างที่ 3: เปิด Web Frontend (Port 5173)
```powershell
cd path/to/smart-attendance-main
npm run dev
```
> ✅ เข้าใช้งานผ่านเบราว์เซอร์ที่: **`http://localhost:5173/`**

---

## ❓ 5. การแก้ไขปัญหาที่พบบ่อยบนเครื่องใหม่ (Troubleshooting)

1. **`python : The term 'python' is not recognized...`**:
   * **สาเหตุ**: ยังไม่ได้เลือก `Add Python to PATH` ตอนติดตั้ง
   * **แก้ไข**: ลองเปลี่ยนไปใช้คำสั่ง `py src/api.py` หรือติดตั้ง Python ใหม่และติ๊กเลือก `Add to PATH`

2. **`Exception while calling opencv.dnn module...`**:
   * **สาเหตุ**: ขาดไลบรารี OpenCV DNN
   * **แก้ไข**: รันคำสั่ง `pip install opencv-contrib-python==4.10.0.84`

3. **`กล้องไม่ติด / Camera Access Denied`**:
   * **สาเหตุ**: เบราว์เซอร์บล็อกสิทธิ์กล้อง
   * **แก้ไข**: กดที่รูปแม่กุญแจ 🔒 หน้า URL แล้วกดอนุญาตให้ใช้งานกล้อง (Allow Camera)
