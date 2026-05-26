import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, QrCode, ShieldCheck, CheckCircle2, XCircle, Activity, User, Fingerprint, Loader2, Scan, ClipboardList, Clock, Users, ChevronDown, ChevronUp, Database, AlertCircle, RefreshCw } from 'lucide-react';
import jsQR from 'jsqr';

// --- Tunwak's Attendance Backend API ---
const ATTENDANCE_API = import.meta.env.VITE_ATTENDANCE_API_URL || `http://${window.location.hostname}:3000`;

// --- Static User Database (Mocked for QR Scan) ---
const USER_DATABASE = [
  { id: '6612247018', name: 'นายณัฐวุฒิ พุ่มประเสริฐ', role: 'นักศึกษา', dept: 'วิศวกรรมคอมพิวเตอร์' },
  { id: 'EMP002', name: 'วิภาวี รักงาน', role: 'บุคลากร', dept: 'IT Support' },
  // --- Tunwak's test users (synced from MongoDB) ---
  { id: '65010001', name: 'สมชาย ใจดี', role: 'นักศึกษา', dept: 'IT' },
  { id: '65010002', name: 'สมหญิง ตั้งใจ', role: 'นักศึกษา', dept: 'IT' },
  { id: '65010003', name: 'กิตติพงษ์ พัฒนา', role: 'นักศึกษา', dept: 'IT' },
  { id: '65010004', name: 'อรทัย สุขสันต์', role: 'นักศึกษา', dept: 'IT' },
  { id: '65010005', name: 'ธีรภัทร ก้าวหน้า', role: 'นักศึกษา', dept: 'IT' },
];

export default function App() {
  // --- Core State Machine ---
  // Hands-free Flow: QR_SCAN (Awaiting QR) -> QR_SCANNED -> FACE_SCAN -> VERIFYING -> SUCCESS | ERROR -> (auto reset to QR_SCAN)
  const [status, setStatus] = useState('QR_SCAN');
  const [scanCooldown, setScanCooldown] = useState(false);

  // Data
  const [currentUser, setCurrentUser] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [logs, setLogs] = useState([]);

  // --- Attendance Report State ---
  const [showReport, setShowReport] = useState(false);
  const [reportData, setReportData] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [checkinMessage, setCheckinMessage] = useState('');

  // Refs
  const videoRef = useRef(null);
  const timerRef = useRef(null);
  const cooldownTimerRef = useRef(null);
  const lastScannedCodeRef = useRef({ code: '', time: 0 });

  // --- Initialize Camera ---
  useEffect(() => {
    let isMounted = true;
    let stream = null;
    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (isMounted && videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.error("Camera access denied:", err);
        setErrorMessage("Camera access denied or no camera found.");
      }
    };
    startCamera();
    return () => {
      isMounted = false;
      if (stream) stream.getTracks().forEach(track => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, []);

  // --- Helper: Clear any active timers to prevent race conditions ---
  const clearTimers = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
  };

  // --- Reset to QR_SCAN (Loop Back) ---
  const resetToQrScan = useCallback((delay = 2000) => {
    clearTimers();
    timerRef.current = setTimeout(() => {
      setStatus('QR_SCAN');
      setScanCooldown(true);
      setCurrentUser(null);
      setErrorMessage('');
      setCheckinMessage('');

      cooldownTimerRef.current = setTimeout(() => {
        setScanCooldown(false);
      }, 1500);
    }, delay);
  }, []);

  // --- Loop for scanning QR code from video stream using jsQR ---
  useEffect(() => {
    if (status !== 'QR_SCAN' || scanCooldown) return;

    let active = true;
    let frameId = null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

    const scanQrLoop = () => {
      if (!active) return;
      if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
        const w = videoRef.current.videoWidth;
        const h = videoRef.current.videoHeight;
        if (w > 0 && h > 0) {
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(videoRef.current, 0, 0, w, h);
          const imageData = ctx.getImageData(0, 0, w, h);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });

          if (code) {
            const decodedText = code.data.trim();
            const now = Date.now();

            // ป้องกันการสแกนซ้ำภายใน 5 วินาที สำหรับ QR Code เดิม
            if (decodedText === lastScannedCodeRef.current.code && (now - lastScannedCodeRef.current.time) < 5000) {
              frameId = requestAnimationFrame(scanQrLoop);
              return;
            }

            console.log("QR Code found:", decodedText);
            
            // บันทึกรหัสและเวลาล่าสุดที่สแกนสำเร็จ
            lastScannedCodeRef.current = { code: decodedText, time: now };

            let studentId = decodedText;
            let studentName = `นักศึกษา (${decodedText})`;
            let studentRole = 'นักศึกษา';
            let studentDept = 'มหาวิทยาลัย';

            try {
              const parsed = JSON.parse(decodedText);
              if (parsed.id) studentId = parsed.id.toString().trim();
              if (parsed.name) studentName = parsed.name;
              if (parsed.role) studentRole = parsed.role;
              if (parsed.dept) studentDept = parsed.dept;
            } catch (e) {
              // Plain text ID
            }

            let foundUser = USER_DATABASE.find(u => u.id === studentId);
            if (!foundUser) {
              foundUser = { id: studentId, name: studentName, role: studentRole, dept: studentDept };
            }

            setCurrentUser(foundUser);
            setStatus('QR_SCANNED');
            active = false;

            // --- 2 Second Delay then Auto Face Scan ---
            clearTimers();
            timerRef.current = setTimeout(() => {
              setStatus('FACE_SCAN');
              
              // 1 Second Pose delay in Face Scan before capturing
              timerRef.current = setTimeout(() => {
                setStatus('VERIFYING');
                performCapture(foundUser);
              }, 1000);

            }, 2000);
            return;
          }
        }
      }
      frameId = requestAnimationFrame(scanQrLoop);
    };

    frameId = requestAnimationFrame(scanQrLoop);

    return () => {
      active = false;
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [status, scanCooldown, resetToQrScan]);

  const performCapture = async (userToVerify) => {
    if (!videoRef.current || !userToVerify) {
      setErrorMessage("กล้องไม่พร้อมใช้งาน");
      setStatus('ERROR');
      resetToQrScan(3000);
      return;
    }

    try {
      const canvas = document.createElement('canvas');
      let w = videoRef.current.videoWidth;
      let h = videoRef.current.videoHeight;
      if (w === 0 || h === 0) {
        throw new Error("Camera stream is invalid.");
      }

      const MAX_WIDTH = 640;
      if (w > MAX_WIDTH) {
        h = Math.round((h * MAX_WIDTH) / w);
        w = MAX_WIDTH;
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoRef.current, 0, 0, w, h);

      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      if (!blob) {
        throw new Error("Failed to create image blob.");
      }

      const formData = new FormData();
      formData.append("user_id", userToVerify.id);
      formData.append("file", blob, "snapshot.jpg");

      const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8000/api/verify_face`;
      const response = await fetch(API_URL, {
        method: "POST",
        body: formData
      });

      if (!response.ok) throw new Error("API Connection Failed");

      const data = await response.json();

      if (data.match) {
        setStatus('SUCCESS');
        addLog(userToVerify, data.score);

        try {
          const checkinRes = await fetch(`${ATTENDANCE_API}/api/checkin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userToVerify.id })
          });
          const checkinData = await checkinRes.json();
          setCheckinMessage(checkinData.message || 'บันทึกเวลาเรียนแล้ว');
        } catch (checkinErr) {
          console.warn('Attendance checkin failed:', checkinErr.message);
          setCheckinMessage('⚠️ บันทึกใน MongoDB ไม่สำเร็จ');
        }

        // --- 2 Second Delay then Loop Back to QR Scan ---
        resetToQrScan(2000);
      } else {
        setErrorMessage(data.message || "ใบหน้าไม่ตรงกับฐานข้อมูล");
        setStatus('ERROR');
        
        // If user is not enrolled, we wait longer (e.g. 8s) to allow clicking "enroll"
        if (data.message && (data.message.includes("not enrolled") || data.message.includes("not in user_db"))) {
          resetToQrScan(8000);
        } else {
          resetToQrScan(2000); // Wait 2 seconds before looping back
        }
      }

    } catch (err) {
      console.error(err);
      setErrorMessage(`Error: ${err.message}`);
      setStatus('ERROR');
      resetToQrScan(3000);
    }
  };

  const enrollFace = async () => {
    if (!videoRef.current || !currentUser) return;
    clearTimers();
    setStatus('VERIFYING');

    try {
      const canvas = document.createElement('canvas');
      let w = videoRef.current.videoWidth;
      let h = videoRef.current.videoHeight;
      if (w === 0 || h === 0) {
        throw new Error("กล้องไม่พร้อม");
      }

      const MAX_WIDTH = 640;
      if (w > MAX_WIDTH) {
        h = Math.round((h * MAX_WIDTH) / w);
        w = MAX_WIDTH;
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoRef.current, 0, 0, w, h);

      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
      if (!blob) {
        throw new Error("Failed to capture image.");
      }

      const formData = new FormData();
      formData.append("user_id", currentUser.id);
      formData.append("file", blob, "enroll.jpg");

      const API_URL = import.meta.env.VITE_API_URL_ENROLL || `http://${window.location.hostname}:8000/api/enroll`;
      const response = await fetch(API_URL, {
        method: "POST",
        body: formData
      });

      if (!response.ok) throw new Error("API Connection Failed");

      const data = await response.json();

      if (data.success) {
        setStatus('SUCCESS');
        setCheckinMessage("ลงทะเบียนใบหน้าสำเร็จ! ระบบกำลังกลับหน้าหลัก...");
        
        try {
          await fetch(`${ATTENDANCE_API}/api/checkin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: currentUser.id })
          });
        } catch(e) {}

        resetToQrScan(3000);
      } else {
        setErrorMessage(data.message || "การลงทะเบียนล้มเหลว");
        setStatus('ERROR');
        resetToQrScan(3000);
      }
    } catch (err) {
      console.error(err);
      setErrorMessage(`Error: ${err.message}`);
      setStatus('ERROR');
      resetToQrScan(3000);
    }
  };

  const addLog = (user, score) => {
    const newLog = {
      id: Date.now(),
      time: new Date().toLocaleTimeString('th-TH'),
      name: user.name,
      score: score.toFixed(2)
    };
    setLogs(prev => [newLog, ...prev].slice(0, 15));
  };

  // --- Fetch Attendance Report from Tunwak's Backend ---
  const fetchReport = async () => {
    setReportLoading(true);
    try {
      const res = await fetch(`${ATTENDANCE_API}/api/report`);
      const data = await res.json();
      setReportData(data);
    } catch (err) {
      console.error('Failed to fetch report:', err);
      setReportData([]);
    } finally {
      setReportLoading(false);
    }
  };

  const toggleReport = () => {
    if (!showReport) fetchReport();
    setShowReport(prev => !prev);
  };

  // --- RENDER HELPERS ---
  const renderIcon = () => {
    switch (status) {
      case 'IDLE': return <QrCode size={48} className="text-blue-500" />;
      case 'QR_SCAN': return <QrCode size={48} className="text-emerald-400 animate-pulse" />;
      case 'QR_SCANNED': return <CheckCircle2 size={48} className="text-emerald-400" />;
      case 'FACE_SCAN': return <Scan size={48} className="text-yellow-400 animate-pulse" />;
      case 'VERIFYING': return <Loader2 size={48} className="text-purple-500 animate-spin" />;
      case 'SUCCESS': return <CheckCircle2 size={64} className="text-green-500" />;
      case 'ERROR': return <XCircle size={64} className="text-red-500" />;
      default: return <Camera size={48} />;
    }
  };

  const renderTitle = () => {
    switch (status) {
      case 'IDLE': return "Ready to Scan QR";
      case 'QR_SCAN': return "Scanning QR Code...";
      case 'QR_SCANNED': return "QR Code Verified";
      case 'FACE_SCAN': return "Stand Still...";
      case 'VERIFYING': return "Analyzing Face...";
      case 'SUCCESS': return "Access Granted";
      case 'ERROR': return "Access Denied";
      default: return "";
    }
  };

  const renderDescription = () => {
    switch (status) {
      case 'IDLE': return "กรุณากดปุ่ม 'สแกน QR Code' ด้านล่างเพื่อเริ่มขั้นตอนเช็คอิน";
      case 'QR_SCAN': return "กรุณานำ QR Code ของคุณแสดงต่อหน้ากล้อง";
      case 'QR_SCANNED': return `ผู้ใช้: ${currentUser?.name} — กรุณากดปุ่ม 'สแกนใบหน้า' เพื่อบันทึกเวลา`;
      case 'FACE_SCAN': return `กำลังตรวจสอบใบหน้า: ${currentUser?.name}`;
      case 'VERIFYING': return "กำลังเปรียบเทียบข้อมูลใบหน้าของคุณเพื่อความปลอดภัย...";
      case 'SUCCESS': return checkinMessage ? `${currentUser?.name} — ${checkinMessage}` : `ยินดีต้อนรับ, ${currentUser?.name}!`;
      case 'ERROR': return errorMessage;
      default: return "";
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans selection:bg-blue-600/30 overflow-hidden flex flex-col relative">

      {/* Dynamic Background Gradients */}
      <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-gradient-to-b opacity-20 blur-[120px] rounded-full pointer-events-none transition-colors duration-1000 ${
        status === 'IDLE' ? 'from-blue-600 to-transparent' :
        status === 'QR_SCAN' || status === 'QR_SCANNED' ? 'from-emerald-600 to-transparent' :
        status === 'FACE_SCAN' ? 'from-yellow-500 to-transparent' :
        status === 'VERIFYING' ? 'from-purple-600 to-transparent' :
        status === 'SUCCESS' ? 'from-green-500 to-transparent' :
        'from-red-600 to-transparent'
      }`} />

      {/* Header */}
      <header className="px-6 py-5 flex justify-between items-center border-b border-slate-800/60 bg-slate-900/50 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-500/10 rounded-xl border border-blue-500/20">
            <Fingerprint className="text-blue-400" size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">
              Titan Auth
            </h1>
            <p className="text-xs text-slate-500 font-medium">Next-Gen 2FA System</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-emerald-500" />
          <span className="text-xs font-semibold text-emerald-500 tracking-wider">SECURE</span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 flex flex-col md:flex-row gap-6 md:gap-8 z-10">

        {/* Left: Camera Viewport */}
        <section className="flex-1 flex flex-col">
          <div className={`relative w-full aspect-video md:aspect-[4/3] max-h-[60vh] rounded-3xl overflow-hidden border-2 shadow-2xl transition-all duration-500 ${
            status === 'SUCCESS' ? 'border-green-500/40 shadow-green-900/20' :
            status === 'ERROR' ? 'border-red-500/40 shadow-red-900/20' :
            status === 'FACE_SCAN' ? 'border-yellow-500/50 shadow-yellow-900/20 scale-[1.02]' :
            status === 'QR_SCAN' ? 'border-emerald-500/50 shadow-emerald-900/20 scale-[1.02]' :
            status === 'QR_SCANNED' ? 'border-emerald-500/40 shadow-emerald-900/10' :
            'border-slate-800 shadow-black/50'
          }`}>

            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover transform scale-x-[-1] transition-all duration-700 ${
                status === 'VERIFYING' ? 'grayscale opacity-60 blur-sm' :
                (status === 'SUCCESS' || status === 'ERROR') ? 'brightness-50' : 'brightness-110'
              }`}
            />

            {/* QR Code Scanning Bounding Box & Guides */}
            {status === 'QR_SCAN' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/10">
                {/* QR Code Scan Window Indicator */}
                <div className={`relative w-64 h-64 border-2 rounded-2xl transition-all duration-300 ${
                  scanCooldown
                    ? 'border-slate-500/50 shadow-[0_0_30px_rgba(100,116,139,0.2)]'
                    : 'border-emerald-400/80 shadow-[0_0_50px_rgba(52,211,153,0.3)] animate-pulse'
                }`}>
                  {/* Blinking corners */}
                  <div className={`absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 rounded-tl-lg transition-colors duration-300 ${scanCooldown ? 'border-slate-500' : 'border-emerald-400'}`}></div>
                  <div className={`absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 rounded-tr-lg transition-colors duration-300 ${scanCooldown ? 'border-slate-500' : 'border-emerald-400'}`}></div>
                  <div className={`absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 rounded-bl-lg transition-colors duration-300 ${scanCooldown ? 'border-slate-500' : 'border-emerald-400'}`}></div>
                  <div className={`absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 rounded-br-lg transition-colors duration-300 ${scanCooldown ? 'border-slate-500' : 'border-emerald-400'}`}></div>
                  
                  {/* Pulse scan line */}
                  {!scanCooldown && (
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-[scan_2s_ease-in-out_infinite] shadow-[0_0_15px_rgba(52,211,153,0.8)]"></div>
                  )}
                </div>
                <div className="absolute bottom-8 px-4 py-2 bg-slate-900/80 backdrop-blur-md border border-slate-700/50 rounded-xl text-center">
                  <p className={`text-xs font-medium tracking-wide transition-colors duration-300 ${scanCooldown ? 'text-slate-400' : 'text-emerald-300'}`}>
                    {scanCooldown ? 'กำลังเตรียมความพร้อมสำหรับการสแกนถัดไป...' : 'กรุณาแสดงคิวอาร์โค้ดต่อหน้ากล้อง'}
                  </p>
                </div>
              </div>
            )}

            {/* Face Scanning Overlay Effect */}
            {status === 'FACE_SCAN' && (
              <>
                <div className="absolute inset-0 bg-yellow-500/10 mix-blend-overlay"></div>
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-yellow-400 to-transparent animate-[scan_1.5s_ease-in-out_infinite] shadow-[0_0_20px_rgba(250,204,21,0.8)]"></div>

                {/* Crosshairs */}
                <div className="absolute top-8 left-8 w-12 h-12 border-t-4 border-l-4 border-yellow-400 rounded-tl-xl opacity-80"></div>
                <div className="absolute top-8 right-8 w-12 h-12 border-t-4 border-r-4 border-yellow-400 rounded-tr-xl opacity-80"></div>
                <div className="absolute bottom-8 left-8 w-12 h-12 border-b-4 border-l-4 border-yellow-400 rounded-bl-xl opacity-80"></div>
                <div className="absolute bottom-8 right-8 w-12 h-12 border-b-4 border-r-4 border-yellow-400 rounded-br-xl opacity-80"></div>
              </>
            )}

            {/* QR Code Scanned Info Display */}
            {status === 'QR_SCANNED' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                <div className="bg-slate-900/90 border border-emerald-500/30 rounded-2xl p-6 text-center max-w-xs w-full shadow-2xl mx-4">
                  <div className="inline-flex p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full mb-4">
                    <CheckCircle2 size={32} />
                  </div>
                  <h3 className="text-emerald-400 font-bold text-lg mb-1">สแกน QR สำเร็จ</h3>
                  <p className="text-slate-400 text-xs font-semibold tracking-wider font-mono mb-4">ID: {currentUser?.id}</p>
                  
                  <div className="bg-slate-800/50 rounded-xl p-3 border border-slate-700/30 text-left mb-4 text-xs space-y-1">
                    <div className="text-slate-400 font-medium">ชื่อ: <span className="text-white font-semibold">{currentUser?.name}</span></div>
                    <div className="text-slate-400 font-medium">ตำแหน่ง: <span className="text-white font-semibold">{currentUser?.role}</span></div>
                    <div className="text-slate-400 font-medium">สาขา: <span className="text-white font-semibold">{currentUser?.dept}</span></div>
                  </div>

                  <p className="text-[10px] text-slate-500 font-medium">พร้อมสำหรับการตรวจสอบใบหน้าขั้นถัดไป</p>
                </div>
              </div>
            )}

            {/* Standby Overlay */}
            {status === 'IDLE' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
                <div className="text-center">
                  <Scan size={48} className="mx-auto text-slate-500 mb-4 opacity-50" />
                  <p className="text-slate-400 font-medium">Awaiting QR Code Scan</p>
                </div>
              </div>
            )}
          </div>

          {/* Action Status Indicator (Hands-free kiosk mode) */}
          <div className="mt-6 flex flex-col items-center gap-2 text-center">
            <div className="px-6 py-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-2xl text-xs font-bold tracking-wide flex items-center justify-center gap-2.5 animate-pulse shadow-md shadow-emerald-950/20">
              <span className="w-2.5 h-2.5 bg-emerald-400 rounded-full inline-block animate-ping"></span>
              ระบบเช็คอินอัตโนมัติ (Hands-Free Kiosk)
            </div>
            <p className="text-[11px] text-slate-500 font-medium max-w-sm">
              หัน QR Code หน้ากล้องเพื่อเริ่มสแกน ระบบจะหน่วงเวลาสแกนหน้าและเช็คอินอัตโนมัติ
            </p>
            {status !== 'QR_SCAN' && (
              <button
                onClick={() => resetToQrScan(0)}
                className="mt-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700/60 rounded-xl text-[11px] text-slate-400 font-medium flex items-center gap-1.5 transition-all shadow active:scale-95"
              >
                <RefreshCw size={12} className="animate-[spin_4s_linear_infinite]" /> ข้ามไปหน้าสแกน QR Code
              </button>
            )}
          </div>
        </section>

        {/* Right: Status Panel & Logs */}
        <section className="w-full md:w-[400px] flex flex-col gap-6 shrink-0">

          {/* Status Display Card */}
          <div className="bg-slate-900/80 backdrop-blur-xl border border-slate-700/50 rounded-3xl p-8 flex flex-col items-center justify-center text-center min-h-[280px] relative overflow-hidden shadow-xl">
            <div className={`absolute inset-0 opacity-10 blur-xl transition-all duration-1000 ${status === 'IDLE' ? 'bg-blue-500' :
              status === 'FACE_SCAN' ? 'bg-yellow-500' :
                status === 'VERIFYING' ? 'bg-purple-500' :
                  status === 'SUCCESS' ? 'bg-green-500' : 'bg-red-500'
              }`}></div>

            <div className="z-10 bg-slate-800/50 p-6 rounded-3xl border border-slate-700/50 shadow-inner mb-6">
              {renderIcon()}
            </div>

            <h2 className={`text-2xl font-bold mb-2 z-10 transition-colors duration-300 ${status === 'SUCCESS' ? 'text-green-400' :
              status === 'ERROR' ? 'text-red-400' :
                'text-white'
              }`}>
              {renderTitle()}
            </h2>

            <div className="z-10 w-full flex justify-center">
              {status === 'ERROR' ? (
                <div className="bg-red-500/20 w-full p-4 rounded-xl border border-red-500/50 mt-2 flex flex-col items-center gap-3">
                  <p className="text-red-200 text-sm font-semibold sm:text-base leading-snug">
                    {renderDescription()}
                  </p>
                  {currentUser && (errorMessage.toLowerCase().includes("not enrolled") || 
                    errorMessage.toLowerCase().includes("user_db") || 
                    errorMessage.includes("ไม่พบ")) && (
                    <button
                      onClick={enrollFace}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 border border-emerald-500/30 text-white text-xs font-bold rounded-xl transition-all shadow active:scale-95 flex items-center gap-1.5"
                    >
                      <Camera size={14} /> ลงทะเบียนใบหน้าใหม่
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-slate-400 text-sm max-w-[250px]">
                  {renderDescription()}
                </p>
              )}
            </div>
          </div>

          {/* Activity Log */}
          <div className="flex-1 bg-slate-900/60 border border-slate-800 rounded-3xl overflow-hidden flex flex-col shadow-xl">
            <div className="px-6 py-4 border-b border-slate-800 flex items-center gap-3">
              <Activity className="text-blue-500" size={18} />
              <h3 className="font-semibold text-sm tracking-wide">Recent Activity</h3>
            </div>
            <div className="flex-1 p-2 overflow-y-auto space-y-1 custom-scrollbar">
              {logs.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-600 text-xs font-medium">
                  No recent logs
                </div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="p-3 bg-slate-800/40 rounded-xl border border-slate-700/30 flex justify-between items-center group hover:bg-slate-800/80 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-green-500/10 rounded-lg text-green-500">
                        <User size={14} />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-slate-200">{log.name}</div>
                        <div className="text-[10px] text-slate-500">{log.time}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] text-slate-400">Match</div>
                      <div className="text-xs font-semibold text-green-400">{log.score}</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

        </section>
      </main>

      {/* Attendance Report Panel (from Tunwak's Backend) */}
      <div className="max-w-7xl w-full mx-auto px-4 md:px-8 pb-8 z-10">
        <button
          onClick={toggleReport}
          className="w-full flex items-center justify-between px-6 py-4 bg-slate-900/80 backdrop-blur-xl border border-slate-700/50 rounded-2xl hover:bg-slate-800/80 transition-all shadow-xl group"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
              <ClipboardList className="text-indigo-400" size={20} />
            </div>
            <div className="text-left">
              <h3 className="font-semibold text-sm">Attendance Report</h3>
              <p className="text-[10px] text-slate-500">ข้อมูลจากระบบ Tunwak — MongoDB</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {reportData.length > 0 && (
              <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-2 py-1 rounded-full font-semibold">
                {reportData.length} records
              </span>
            )}
            {showReport ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
          </div>
        </button>

        {showReport && (
          <div className="mt-3 bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden shadow-xl animate-[fadeIn_0.3s_ease]">
            {reportLoading ? (
              <div className="p-8 flex items-center justify-center gap-3 text-slate-500">
                <Loader2 size={20} className="animate-spin" />
                <span className="text-sm">กำลังโหลดข้อมูล...</span>
              </div>
            ) : reportData.length === 0 ? (
              <div className="p-8 text-center text-slate-600 text-sm">
                <Database size={32} className="mx-auto mb-3 opacity-40" />
                <p>ไม่พบข้อมูล — Attendance Backend อาจยังไม่ได้เปิด (port 3000)</p>
                <button onClick={fetchReport} className="mt-3 text-indigo-400 text-xs hover:underline">ลองอีกครั้ง</button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700/50 text-slate-400">
                      <th className="px-4 py-3 text-left font-semibold text-xs">รหัส</th>
                      <th className="px-4 py-3 text-left font-semibold text-xs">ชื่อ</th>
                      <th className="px-4 py-3 text-left font-semibold text-xs">วันที่</th>
                      <th className="px-4 py-3 text-left font-semibold text-xs">เวลา</th>
                      <th className="px-4 py-3 text-left font-semibold text-xs">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.map((row, i) => (
                      <tr key={i} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-slate-300">{row.user_id}</td>
                        <td className="px-4 py-3 text-slate-200 font-medium">{row.full_name || '—'}</td>
                        <td className="px-4 py-3 text-slate-400 text-xs">{row.attend_date || '—'}</td>
                        <td className="px-4 py-3 text-slate-400 text-xs flex items-center gap-1">
                          <Clock size={12} className="text-slate-500" />
                          {row.time || '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                            row.status === 'ตรงเวลา' ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' :
                            row.status === 'สาย' ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' :
                            'bg-red-500/15 text-red-400 border border-red-500/30'
                          }`}>
                            {row.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Global Animations */}
      <style>{`
        @keyframes scan {
          0% { top: 0; opacity: 0; }
          15% { opacity: 1; }
          85% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(51, 65, 85, 0.5); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(51, 65, 85, 0.8); }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

    </div>
  );
}