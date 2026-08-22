import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Camera, QrCode, ShieldCheck, CheckCircle2, XCircle, Activity, User,
  Fingerprint, Loader2, Scan, ClipboardList, Clock, ChevronDown, ChevronUp,
  Database, RefreshCw, Video, Eye, Footprints, Users, Radio, PlusCircle
} from 'lucide-react';
import jsQR from 'jsqr';

// --- API Configuration ---
const ATTENDANCE_API = (import.meta.env.VITE_ATTENDANCE_API_URL || 'https://psru-attendance-db.onrender.com').replace(/\/+$/, '');
// Set these in Vercel so each service can use its own public URL (for example, ngrok).
// VITE_API_URL remains supported for deployments that already use the old name.
// Helper to get dynamic host based on browser address (e.g. 192.168.1.176 or localhost)
const getDynamicHost = (port) => {
  if (typeof window !== 'undefined' && window.location.hostname) {
    return 'http://' + window.location.hostname + ':' + port;
  }
  return 'http://localhost:' + port;
};

const FACE_API_URL = import.meta.env.VITE_FACE_API_URL || import.meta.env.VITE_API_URL || (getDynamicHost(8000) + '/api/verify_face');
const ENROLL_API_URL = import.meta.env.VITE_API_URL_ENROLL || FACE_API_URL.replace('/verify_face', '/enroll');
const CCTV_API_URL = import.meta.env.VITE_CCTV_API_URL || getDynamicHost(8001);
const QR_API_URL = (import.meta.env.VITE_QR_API_URL || getDynamicHost(5000)).replace(/\/+$/, '');

// --- Static User Database (Mocked for QR Scan) ---
const USER_DATABASE = [
  { id: '6612247018', name: 'นายณัฐวุฒิ พุ่มประเสริฐ', role: 'นักศึกษา', dept: 'วิศวกรรมคอมพิวเตอร์' },
  { id: 'EMP002', name: 'วิภาวี รักงาน', role: 'บุคลากร', dept: 'IT Support' },
  { id: '65010001', name: 'สมชาย ใจดี', role: 'นักศึกษา', dept: 'IT' },
  { id: '65010002', name: 'สมหญิง ตั้งใจ', role: 'นักศึกษา', dept: 'IT' },
  { id: '65010003', name: 'กิตติพงษ์ พัฒนา', role: 'นักศึกษา', dept: 'IT' },
  { id: '65010004', name: 'อรทัย สุขสันต์', role: 'นักศึกษา', dept: 'IT' },
  { id: '65010005', name: 'ธีรภัทร ก้าวหน้า', role: 'นักศึกษา', dept: 'IT' },
];

export default function App() {
  // --- Navigation Mode State ---
  const [appMode, setAppMode] = useState('ATTENDANCE');

  // --- Core State Machine for Attendance ---
  const [status, setStatus] = useState('QR_SCAN');
  const [scanCooldown, setScanCooldown] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [logs, setLogs] = useState([]);

  // --- Attendance Report State ---
  const [showReport, setShowReport] = useState(false);
  const [reportData, setReportData] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [checkinMessage, setCheckinMessage] = useState('');

  // --- CCTV AI Surveillance State ---
  const [cctvLogs, setCctvLogs] = useState([]);
  const [cctvStatus, setCctvStatus] = useState({ online: false, active: false, count: 0 });
  const [cctvFrameAnalysis, setCctvFrameAnalysis] = useState(null);

  // --- CCTV Face Enroll Modal State ---
  const [showCctvEnrollModal, setShowCctvEnrollModal] = useState(false);
  const [cctvEnrollName, setCctvEnrollName] = useState('');
  const [cctvEnrollLoading, setCctvEnrollLoading] = useState(false);
  const [cctvEnrollMessage, setCctvEnrollMessage] = useState('');

  // Refs
  const videoRef = useRef(null);
  const cctvVideoRef = useRef(null);
  const timerRef = useRef(null);
  const subTimerRef = useRef(null);
  const cooldownTimerRef = useRef(null);
  const lastScannedCodeRef = useRef({ code: '', time: 0 });

  // Helper: Clear active timers
  const clearTimers = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (subTimerRef.current) clearTimeout(subTimerRef.current);
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    timerRef.current = null;
    subTimerRef.current = null;
    cooldownTimerRef.current = null;
  }, []);

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
  }, [clearTimers]);

  // --- Camera Initialization ---
  useEffect(() => {
    let isMounted = true;
    let activeStream = null;

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (isMounted) {
          activeStream = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
          if (cctvVideoRef.current) {
            cctvVideoRef.current.srcObject = stream;
          }
        } else {
          stream.getTracks().forEach(track => track.stop());
        }
      } catch (err) {
        if (isMounted) {
          console.error("Camera access error:", err);
          setErrorMessage("Camera access denied or no camera found.");
        }
      }
    };

    startCamera();

    return () => {
      isMounted = false;
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [appMode]);

  // --- Fetch CCTV Passerby Logs from Python AI Service ---
  const fetchCctvLogs = useCallback(async () => {
    try {
      const res = await fetch(`${CCTV_API_URL}/api/cctv/logs?limit=25`);
      if (res.ok) {
        const data = await res.json();
        setCctvLogs(data.logs || []);
        setCctvStatus(prev => ({ ...prev, online: true, count: data.logs?.length || 0 }));
      } else {
        setCctvStatus(prev => ({ ...prev, online: false }));
      }
    } catch {
      setCctvStatus(prev => ({ ...prev, online: false }));
    }
  }, []);

  // Poll CCTV logs when in CCTV_SURVEILLANCE mode
  useEffect(() => {
    if (appMode !== 'CCTV_SURVEILLANCE') return;

    fetchCctvLogs();
    const interval = setInterval(fetchCctvLogs, 2500);
    return () => clearInterval(interval);
  }, [appMode, fetchCctvLogs]);

  // Continuously analyze frame in CCTV mode
  useEffect(() => {
    if (appMode !== 'CCTV_SURVEILLANCE') return;

    let isScanning = true;
    const analyzeCctvFrame = async () => {
      if (!isScanning || !cctvVideoRef.current) return;
      const video = cctvVideoRef.current;
      if (video.readyState < 2 || video.videoWidth === 0) {
        setTimeout(analyzeCctvFrame, 1000);
        return;
      }

      try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(video.videoWidth, 640);
        canvas.height = Math.min(video.videoHeight, 480);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.7));
        if (blob) {
          const formData = new FormData();
          formData.append('file', blob, 'frame.jpg');

          const response = await fetch(`${CCTV_API_URL}/api/cctv/analyze_frame`, {
            method: 'POST',
            body: formData,
          });

          if (response.ok) {
            const data = await response.json();
            setCctvFrameAnalysis(data);
            setCctvStatus(prev => ({ ...prev, online: true }));
          }
        }
      } catch {
        // Backend offline or processing
      }

      if (isScanning) {
        setTimeout(analyzeCctvFrame, 1200);
      }
    };

    analyzeCctvFrame();

    return () => {
      isScanning = false;
    };
  }, [appMode]);

  // CCTV Face Enrollment Handler
  const handleCctvFaceEnroll = async () => {
    if (!cctvVideoRef.current || !cctvEnrollName.trim()) return;
    setCctvEnrollLoading(true);
    setCctvEnrollMessage('');

    try {
      const video = cctvVideoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(video.videoWidth, 640);
      canvas.height = Math.min(video.videoHeight, 480);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (!blob) throw new Error('Failed to capture snapshot');

      const formData = new FormData();
      formData.append('name', cctvEnrollName.trim());
      formData.append('file', blob, 'cctv_enroll.jpg');

      const res = await fetch(`${CCTV_API_URL}/api/cctv/enroll_face`, {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (res.ok && data.status === 'success') {
        setCctvEnrollMessage(`✅ บันทึกใบหน้า "${data.name}" สำเร็จ! AI จะจำคุณได้ทันที`);
        setTimeout(() => {
          setShowCctvEnrollModal(false);
          setCctvEnrollName('');
          setCctvEnrollMessage('');
        }, 1800);
      } else {
        throw new Error(data.message || 'Enrollment failed');
      }
    } catch (err) {
      setCctvEnrollMessage(`❌ เกิดข้อผิดพลาด: ${err.message}`);
    } finally {
      setCctvEnrollLoading(false);
    }
  };

  // Log Helper for Attendance
  const addLog = useCallback((user, score) => {
    const scoreNum = typeof score === 'number' ? score : (parseFloat(score) || 0);
    const newLog = {
      id: Date.now(),
      time: new Date().toLocaleTimeString('th-TH'),
      name: user.name,
      score: scoreNum.toFixed(2)
    };
    setLogs(prev => [newLog, ...prev].slice(0, 15));
  }, []);

  // Face Capture & Verification for Attendance
  const performCapture = useCallback(async (userToVerify) => {
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
      if (w === 0 || h === 0) throw new Error("Camera stream is invalid.");

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
      if (!blob) throw new Error("Failed to create image blob.");

      const userIdStr = String(userToVerify?.id || "").trim();
      if (!userIdStr) throw new Error("ไม่พบรหัสผู้ใช้งานที่ถูกต้อง");

      const formData = new FormData();
      formData.append("user_id", userIdStr);
      formData.append("file", blob, "snapshot.jpg");

      const response = await fetch(FACE_API_URL, {
        method: "POST",
        body: formData
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        let errDetail = data.message;
        if (!errDetail && Array.isArray(data.detail)) {
          errDetail = data.detail.map(d => `${d.loc?.join('.') || 'field'}: ${d.msg}`).join(', ');
        }
        throw new Error(errDetail || `API Error (${response.status})`);
      }

      if (data.match) {
        setStatus('SUCCESS');
        addLog(userToVerify, data.score);

        try {
          const checkinRes = await fetch(`${ATTENDANCE_API}/api/checkin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              user_id: userToVerify.id,
              full_name: userToVerify.name
            })
          });
          const checkinData = await checkinRes.json();
          setCheckinMessage(checkinData.message || 'บันทึกเวลาเรียนแล้ว');
          fetchReport();
        } catch (checkinErr) {
          console.warn('Attendance checkin failed:', checkinErr?.message || checkinErr);
          setCheckinMessage('⚠️ บันทึกใน MongoDB ไม่สำเร็จ');
        }

        resetToQrScan(2000);
      } else {
        setErrorMessage(data.message || "ใบหน้าไม่ตรงกับฐานข้อมูล");
        setStatus('ERROR');
        if (data.message && (data.message.includes("not enrolled") || data.message.includes("not in user_db"))) {
          resetToQrScan(8000);
        } else {
          resetToQrScan(2000);
        }
      }
    } catch (err) {
      console.error(err);
      setErrorMessage(`Error: ${err.message}`);
      setStatus('ERROR');
      resetToQrScan(3000);
    }
  }, [resetToQrScan, addLog]);

  // QR Code Scanning Loop
  useEffect(() => {
    if (appMode !== 'ATTENDANCE') return;
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

            if (!decodedText || decodedText.length < 3) {
              frameId = requestAnimationFrame(scanQrLoop);
              return;
            }

            if (decodedText === lastScannedCodeRef.current.code && (now - lastScannedCodeRef.current.time) < 5000) {
              frameId = requestAnimationFrame(scanQrLoop);
              return;
            }

            lastScannedCodeRef.current = { code: decodedText, time: now };

            const handleSuccessUser = (user) => {
              setCurrentUser(user);
              setStatus('QR_SCANNED');
              active = false;
              clearTimers();
              timerRef.current = setTimeout(() => {
                setStatus('FACE_SCAN');
                subTimerRef.current = setTimeout(() => {
                  setStatus('VERIFYING');
                  performCapture(user);
                }, 1000);
              }, 2000);
            };

            const handleErrorUser = () => {
              active = false;
              clearTimers();
              setCurrentUser(null);
              setErrorMessage('QR นี้ไม่ใช่รหัสสำหรับเช็คชื่อ หรือไม่พบผู้ใช้งานในระบบ');
              setStatus('ERROR');
              resetToQrScan(2500);
            };

            // 1. Static Student ID check
            const foundUser = USER_DATABASE.find(u => u.id === decodedText);
            if (foundUser) {
              handleSuccessUser(foundUser);
              return;
            }

            // 2. Resolve Dynamic QR Token via Flask/ngrok server
            active = false;
            fetch(`${QR_API_URL}/resolve_qr?token=${encodeURIComponent(decodedText)}`, {
              headers: { 'ngrok-skip-browser-warning': 'true' }
            })
              .then(res => res.ok ? res.json() : null)
              .then(data => {
                if (data && data.status === 'success' && data.student_id) {
                  const resolvedId = data.student_id;
                  const matchedUser = USER_DATABASE.find(u => u.id === resolvedId) || {
                    id: resolvedId,
                    name: `นักศึกษา ${resolvedId}`,
                    role: 'นักศึกษา',
                    dept: 'วิศวกรรมคอมพิวเตอร์'
                  };
                  handleSuccessUser(matchedUser);
                } else {
                  handleErrorUser();
                }
              })
              .catch(() => handleErrorUser());

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
  }, [appMode, status, scanCooldown, resetToQrScan, clearTimers, performCapture]);

  const enrollFace = async () => {
    if (!videoRef.current || !currentUser) return;
    clearTimers();
    setStatus('VERIFYING');

    try {
      const canvas = document.createElement('canvas');
      let w = videoRef.current.videoWidth;
      let h = videoRef.current.videoHeight;
      if (w === 0 || h === 0) throw new Error("กล้องไม่พร้อม");

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
      if (!blob) throw new Error("Failed to capture image.");

      const userIdStr = String(currentUser?.id || "").trim();
      if (!userIdStr) throw new Error("ไม่พบรหัสผู้ใช้งานที่ถูกต้อง");

      const formData = new FormData();
      formData.append("user_id", userIdStr);
      formData.append("file", blob, "enroll.jpg");

      const response = await fetch(ENROLL_API_URL, {
        method: "POST",
        body: formData
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        let errDetail = data.message;
        if (!errDetail && Array.isArray(data.detail)) {
          errDetail = data.detail.map(d => `${d.loc?.join('.') || 'field'}: ${d.msg}`).join(', ');
        }
        throw new Error(errDetail || `API Error (${response.status})`);
      }

      if (data.success) {
        setStatus('SUCCESS');
        setCheckinMessage("ลงทะเบียนใบหน้าสำเร็จ! ระบบกำลังกลับหน้าหลัก...");

        try {
          await fetch(`${ATTENDANCE_API}/api/checkin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: currentUser.id })
          });
        } catch {
          // Ignore background checkin error
        }

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

  const fetchReport = async () => {
    setReportLoading(true);
    try {
      const res = await fetch(`${ATTENDANCE_API}/api/report`);
      const data = await res.json();
      const rawArray = Array.isArray(data) ? data : [];
      const mapped = rawArray.map(row => {
        const found = USER_DATABASE.find(u => u.id === String(row.user_id).trim());
        const hasRealName = row.full_name && row.full_name !== row.user_id;
        return {
          ...row,
          full_name: hasRealName ? row.full_name : (found ? found.name : row.full_name || row.user_id)
        };
      });
      setReportData(mapped);
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

  // Render Helpers for Attendance Mode
  const renderIcon = () => {
    switch (status) {
      case 'IDLE': return <QrCode size={48} className="text-emerald-500" />;
      case 'QR_SCAN': return <QrCode size={48} className="text-emerald-600 animate-pulse" />;
      case 'QR_SCANNED': return <CheckCircle2 size={48} className="text-emerald-600" />;
      case 'FACE_SCAN': return <Scan size={48} className="text-amber-500 animate-pulse" />;
      case 'VERIFYING': return <Loader2 size={48} className="text-teal-600 animate-spin" />;
      case 'SUCCESS': return <CheckCircle2 size={64} className="text-emerald-600" />;
      case 'ERROR': return <XCircle size={64} className="text-rose-500" />;
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
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans selection:bg-emerald-500/20 overflow-x-hidden flex flex-col relative">

      {/* Dynamic Background Emerald Gradients */}
      <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[550px] bg-gradient-to-b opacity-40 blur-[130px] rounded-full pointer-events-none transition-all duration-1000 ${appMode === 'CCTV_SURVEILLANCE' ? 'from-cyan-400/40 via-blue-300/20 to-transparent' :
          status === 'IDLE' ? 'from-teal-300/40 via-emerald-200/20 to-transparent' :
            status === 'QR_SCAN' || status === 'QR_SCANNED' ? 'from-emerald-400/40 via-teal-300/20 to-transparent' :
              status === 'FACE_SCAN' ? 'from-amber-300/40 via-yellow-200/20 to-transparent' :
                status === 'VERIFYING' ? 'from-teal-400/40 via-emerald-300/20 to-transparent' :
                  status === 'SUCCESS' ? 'from-emerald-400/50 via-green-300/20 to-transparent' :
                    'from-rose-400/40 via-red-200/20 to-transparent'
        }`} />

      {/* Header */}
      <header className="px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-4 border-b border-emerald-100 bg-white/80 backdrop-blur-md z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20 text-emerald-600 shadow-sm">
            <Fingerprint size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-emerald-800 via-emerald-600 to-teal-700 bg-clip-text text-transparent">
              Titan Auth & CCTV AI
            </h1>
            <p className="text-xs text-emerald-600/80 font-medium">Smart Attendance & AI Surveillance System</p>
          </div>
        </div>

        {/* Navigation Mode Switcher */}
        <div className="flex items-center bg-slate-100 p-1 rounded-2xl border border-slate-200 shadow-inner">
          <button
            onClick={() => setAppMode('ATTENDANCE')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${appMode === 'ATTENDANCE'
                ? 'bg-white text-emerald-700 shadow-md border border-emerald-100'
                : 'text-slate-500 hover:text-slate-800'
              }`}
          >
            <QrCode size={15} />
            <span>📌 ระบบเช็คชื่อ (QR + Face)</span>
          </button>

          <button
            onClick={() => setAppMode('CCTV_SURVEILLANCE')}
            className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 ${appMode === 'CCTV_SURVEILLANCE'
                ? 'bg-cyan-600 text-white shadow-md border border-cyan-500 animate-pulse'
                : 'text-slate-500 hover:text-slate-800'
              }`}
          >
            <Video size={15} />
            <span>📹 CCTV AI ตรวจจับผู้เดินผ่าน</span>
          </button>
        </div>

        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200/70 rounded-full shadow-sm">
          <ShieldCheck size={16} className="text-emerald-600" />
          <span className="text-xs font-semibold text-emerald-700 tracking-wider">Pibulsongkram Rajabhat University</span>
        </div>
      </header>

      {/* Main Content Area */}
      {appMode === 'ATTENDANCE' ? (
        /* ==================== 1. ATTENDANCE CHECK-IN MODE ==================== */
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 flex flex-col md:flex-row gap-6 md:gap-8 z-10">

          {/* Left: Camera Viewport */}
          <section className="flex-1 flex flex-col">
            <div className={`relative w-full aspect-video md:aspect-[4/3] max-h-[60vh] rounded-3xl overflow-hidden border-2 shadow-xl bg-slate-900 transition-all duration-500 ${status === 'SUCCESS' ? 'border-emerald-500 shadow-emerald-500/20 ring-4 ring-emerald-500/15' :
                status === 'ERROR' ? 'border-rose-400 shadow-rose-400/20 ring-4 ring-rose-400/15' :
                  status === 'FACE_SCAN' ? 'border-amber-400 shadow-amber-400/20 scale-[1.01]' :
                    status === 'QR_SCAN' ? 'border-emerald-400 shadow-emerald-400/20 scale-[1.01]' :
                      status === 'QR_SCANNED' ? 'border-emerald-400 shadow-emerald-400/15' :
                        'border-emerald-100 shadow-slate-200'
              }`}>

              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover transform scale-x-[-1] transition-all duration-700 ${status === 'VERIFYING' ? 'grayscale opacity-60 blur-sm' :
                    (status === 'SUCCESS' || status === 'ERROR') ? 'brightness-75' : 'brightness-105'
                  }`}
              />

              {/* QR Code Scanning Overlay */}
              {status === 'QR_SCAN' && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/15">
                  <div className={`relative w-64 h-64 border-2 rounded-2xl transition-all duration-300 ${scanCooldown
                      ? 'border-slate-400/60 shadow-[0_0_30px_rgba(148,163,184,0.3)]'
                      : 'border-emerald-400 shadow-[0_0_40px_rgba(52,211,153,0.4)] animate-pulse'
                    }`}>
                    <div className={`absolute -top-1 -left-1 w-6 h-6 border-t-4 border-l-4 rounded-tl-lg transition-colors duration-300 ${scanCooldown ? 'border-slate-400' : 'border-emerald-400'}`}></div>
                    <div className={`absolute -top-1 -right-1 w-6 h-6 border-t-4 border-r-4 rounded-tr-lg transition-colors duration-300 ${scanCooldown ? 'border-slate-400' : 'border-emerald-400'}`}></div>
                    <div className={`absolute -bottom-1 -left-1 w-6 h-6 border-b-4 border-l-4 rounded-bl-lg transition-colors duration-300 ${scanCooldown ? 'border-slate-400' : 'border-emerald-400'}`}></div>
                    <div className={`absolute -bottom-1 -right-1 w-6 h-6 border-b-4 border-r-4 rounded-br-lg transition-colors duration-300 ${scanCooldown ? 'border-slate-400' : 'border-emerald-400'}`}></div>

                    {!scanCooldown && (
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-[scan_2s_ease-in-out_infinite] shadow-[0_0_15px_rgba(52,211,153,0.9)]"></div>
                    )}
                  </div>
                  <div className="absolute bottom-8 px-4 py-2 bg-white/90 backdrop-blur-md border border-emerald-100 rounded-xl text-center shadow-lg">
                    <p className={`text-xs font-medium tracking-wide transition-colors duration-300 ${scanCooldown ? 'text-slate-500' : 'text-emerald-700 font-semibold'}`}>
                      {scanCooldown ? 'กำลังเตรียมความพร้อมสำหรับการสแกนถัดไป...' : 'กรุณาแสดงคิวอาร์โค้ดต่อหน้ากล้อง'}
                    </p>
                  </div>
                </div>
              )}

              {/* Face Scanning Overlay */}
              {status === 'FACE_SCAN' && (
                <>
                  <div className="absolute inset-0 bg-amber-500/10 mix-blend-overlay"></div>
                  <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-amber-400 to-transparent animate-[scan_1.5s_ease-in-out_infinite] shadow-[0_0_20px_rgba(251,191,36,0.9)]"></div>
                  <div className="absolute top-8 left-8 w-12 h-12 border-t-4 border-l-4 border-amber-400 rounded-tl-xl opacity-90"></div>
                  <div className="absolute top-8 right-8 w-12 h-12 border-t-4 border-r-4 border-amber-400 rounded-tr-xl opacity-90"></div>
                  <div className="absolute bottom-8 left-8 w-12 h-12 border-b-4 border-l-4 border-amber-400 rounded-bl-xl opacity-90"></div>
                  <div className="absolute bottom-8 right-8 w-12 h-12 border-b-4 border-r-4 border-amber-400 rounded-br-xl opacity-90"></div>
                </>
              )}

              {/* QR Code Scanned Info Display */}
              {status === 'QR_SCANNED' && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
                  <div className="bg-white border border-emerald-200 rounded-3xl p-6 text-center max-w-xs w-full shadow-2xl mx-4">
                    <div className="inline-flex p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-full mb-3">
                      <CheckCircle2 size={32} />
                    </div>
                    <h3 className="text-emerald-700 font-bold text-lg mb-0.5">สแกน QR สำเร็จ</h3>
                    <p className="text-slate-500 text-xs font-semibold tracking-wider font-mono mb-4">ID: {currentUser?.id}</p>
                    <div className="bg-emerald-50/60 rounded-2xl p-3.5 border border-emerald-100 text-left mb-4 text-xs space-y-1.5">
                      <div className="text-slate-600 font-medium">ชื่อ: <span className="text-slate-900 font-semibold">{currentUser?.name}</span></div>
                      <div className="text-slate-600 font-medium">ตำแหน่ง: <span className="text-slate-900 font-semibold">{currentUser?.role}</span></div>
                      <div className="text-slate-600 font-medium">สาขา: <span className="text-slate-900 font-semibold">{currentUser?.dept}</span></div>
                    </div>
                    <p className="text-[11px] text-emerald-600 font-medium">กำลังสแกนใบหน้าอัตโนมัติ...</p>
                  </div>
                </div>
              )}
            </div>

            {/* Kiosk Mode Status Indicator */}
            <div className="mt-5 flex flex-col items-center gap-2 text-center">
              <div className="px-5 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-2xl text-xs font-bold tracking-wide flex items-center justify-center gap-2.5 shadow-sm">
                <span className="w-2.5 h-2.5 bg-emerald-500 rounded-full inline-block animate-ping"></span>
                ระบบเช็คอินอัตโนมัติ (Hands-Free Kiosk)
              </div>
              <p className="text-[11px] text-slate-500 font-medium max-w-sm">
                หัน QR Code หน้ากล้องเพื่อเริ่มสแกน ระบบจะหน่วงเวลาสแกนหน้าและเช็คอินอัตโนมัติ
              </p>
              {status !== 'QR_SCAN' && (
                <button
                  onClick={() => resetToQrScan(0)}
                  className="mt-1 px-3 py-1.5 bg-white hover:bg-emerald-50 border border-emerald-200 rounded-xl text-[11px] text-emerald-700 font-semibold flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
                >
                  <RefreshCw size={12} className="animate-[spin_4s_linear_infinite]" /> ข้ามไปหน้าสแกน QR Code
                </button>
              )}
            </div>
          </section>

          {/* Right: Status Panel & Logs */}
          <section className="w-full md:w-[400px] flex flex-col gap-6 shrink-0">
            <div className="bg-white/90 backdrop-blur-xl border border-emerald-100 rounded-3xl p-7 flex flex-col items-center justify-center text-center min-h-[280px] relative overflow-hidden shadow-xl shadow-emerald-950/5">
              <div className={`absolute inset-0 opacity-15 blur-2xl transition-all duration-1000 ${status === 'IDLE' ? 'bg-teal-400' :
                  status === 'FACE_SCAN' ? 'bg-amber-400' :
                    status === 'VERIFYING' ? 'bg-teal-500' :
                      status === 'SUCCESS' ? 'bg-emerald-500' : 'bg-rose-500'
                }`}></div>

              <div className="z-10 bg-emerald-50/80 p-5 rounded-3xl border border-emerald-100 shadow-sm mb-5">
                {renderIcon()}
              </div>

              <h2 className={`text-2xl font-bold mb-2 z-10 transition-colors duration-300 ${status === 'SUCCESS' ? 'text-emerald-600' :
                  status === 'ERROR' ? 'text-rose-600' : 'text-slate-800'
                }`}>
                {renderTitle()}
              </h2>

              <div className="z-10 w-full flex justify-center">
                {status === 'ERROR' ? (
                  <div className="bg-rose-50 w-full p-4 rounded-2xl border border-rose-200 mt-2 flex flex-col items-center gap-3 shadow-sm">
                    <p className="text-rose-700 text-xs font-semibold sm:text-sm leading-snug">
                      {renderDescription()}
                    </p>
                    {currentUser && (errorMessage.toLowerCase().includes("not enrolled") ||
                      errorMessage.toLowerCase().includes("user_db") ||
                      errorMessage.includes("ไม่พบ")) && (
                        <button
                          onClick={enrollFace}
                          className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 border border-emerald-500/30 text-white text-xs font-bold rounded-xl transition-all shadow-md active:scale-95 flex items-center gap-1.5"
                        >
                          <Camera size={14} /> ลงทะเบียนใบหน้าใหม่
                        </button>
                      )}
                  </div>
                ) : (
                  <p className="text-slate-500 text-sm max-w-[260px]">
                    {renderDescription()}
                  </p>
                )}
              </div>
            </div>

            {/* Attendance Activity Log */}
            <div className="flex-1 bg-white/90 backdrop-blur-xl border border-emerald-100 rounded-3xl overflow-hidden flex flex-col shadow-xl shadow-emerald-950/5">
              <div className="px-6 py-4 border-b border-emerald-100 bg-emerald-50/40 flex items-center gap-3">
                <Activity className="text-emerald-600" size={18} />
                <h3 className="font-bold text-sm tracking-wide text-emerald-950">Recent Attendance Logs</h3>
              </div>
              <div className="flex-1 p-3 overflow-y-auto space-y-2 custom-scrollbar">
                {logs.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-400 text-xs font-medium py-8">
                    No recent logs
                  </div>
                ) : (
                  logs.map((log) => (
                    <div key={log.id} className="p-3 bg-emerald-50/40 rounded-2xl border border-emerald-100/60 flex justify-between items-center group hover:bg-emerald-50/80 transition-colors shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-emerald-500/10 rounded-xl text-emerald-600">
                          <User size={14} />
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-slate-800">{log.name}</div>
                          <div className="text-[10px] text-slate-400">{log.time}</div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] text-slate-400 font-medium">Match</div>
                        <div className="text-xs font-bold text-emerald-600 bg-emerald-100/80 px-2 py-0.5 rounded-md">{log.score}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </section>
        </main>
      ) : (
        /* ==================== 2. CCTV AI SURVEILLANCE MODE ==================== */
        <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 flex flex-col gap-6 z-10">

          {/* Top Banner Stats */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white/90 backdrop-blur-md p-5 rounded-2xl border border-slate-200/80 shadow-md flex items-center gap-4">
              <div className="p-3.5 bg-cyan-500/10 text-cyan-600 rounded-2xl border border-cyan-500/20">
                <Eye size={24} />
              </div>
              <div>
                <div className="text-xs text-slate-500 font-medium">ระบบ CCTV AI</div>
                <div className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 rounded-full ${cctvStatus.online ? 'bg-emerald-500 animate-ping' : 'bg-amber-400'}`}></span>
                  {cctvStatus.online ? 'Active / Surveillance' : 'Connecting...'}
                </div>
              </div>
            </div>

            <div className="bg-white/90 backdrop-blur-md p-5 rounded-2xl border border-slate-200/80 shadow-md flex items-center gap-4">
              <div className="p-3.5 bg-indigo-500/10 text-indigo-600 rounded-2xl border border-indigo-500/20">
                <Footprints size={24} />
              </div>
              <div>
                <div className="text-xs text-slate-500 font-medium">บันทึกผู้เดินผ่านทั้งหมด</div>
                <div className="text-2xl font-bold text-indigo-700">{cctvStatus.count} <span className="text-xs font-normal text-slate-400">รายการ</span></div>
              </div>
            </div>

            <div className="bg-white/90 backdrop-blur-md p-5 rounded-2xl border border-slate-200/80 shadow-md flex items-center gap-4">
              <div className="p-3.5 bg-emerald-500/10 text-emerald-600 rounded-2xl border border-emerald-500/20">
                <Users size={24} />
              </div>
              <div>
                <div className="text-xs text-slate-500 font-medium">ระบุตัวตนสำเร็จ (Identified)</div>
                <div className="text-2xl font-bold text-emerald-700">
                  {cctvLogs.filter(l => l.name && l.name !== 'Unknown').length} <span className="text-xs font-normal text-slate-400">คน</span>
                </div>
              </div>
            </div>

            <div className="bg-white/90 backdrop-blur-md p-5 rounded-2xl border border-slate-200/80 shadow-md flex items-center gap-4">
              <div className="p-3.5 bg-amber-500/10 text-amber-600 rounded-2xl border border-amber-500/20">
                <Activity size={24} />
              </div>
              <div>
                <div className="text-xs text-slate-500 font-medium">ตรวจพบท่าทางผิดปกติ (Abnormal)</div>
                <div className="text-2xl font-bold text-amber-600">
                  {cctvLogs.filter(l => l.gait_status?.includes('Abnormal')).length} <span className="text-xs font-normal text-slate-400">ครั้ง</span>
                </div>
              </div>
            </div>
          </div>

          {/* CCTV Feed & Real-time Passerby Table */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

            {/* CCTV Camera Stream */}
            <div className="lg:col-span-7 flex flex-col gap-3">
              <div className="relative w-full aspect-video rounded-3xl overflow-hidden border-2 border-cyan-500/30 shadow-2xl bg-slate-950">
                <video
                  ref={cctvVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover transform scale-x-[-1]"
                />

                {/* CCTV Live Indicator Tag */}
                <div className="absolute top-4 left-4 px-3 py-1.5 bg-black/70 backdrop-blur-md border border-cyan-500/40 rounded-xl text-cyan-400 text-xs font-mono font-semibold flex items-center gap-2 shadow-lg">
                  <Radio size={14} className="text-cyan-400 animate-pulse" />
                  <span>CAM-01 [PASSERBY AI MONITOR]</span>
                </div>

                {/* Interactive Face Bounding Boxes Overlay */}
                {cctvFrameAnalysis && cctvFrameAnalysis.faces && cctvFrameAnalysis.faces.map((face, i) => {
                  const fw = cctvFrameAnalysis.width || 640;
                  const fh = cctvFrameAnalysis.height || 480;
                  const leftPct = ((fw - (face.x + face.w)) / fw) * 100;
                  const topPct = (face.y / fh) * 100;
                  const widthPct = (face.w / fw) * 100;
                  const heightPct = (face.h / fh) * 100;

                  return (
                    <div
                      key={i}
                      style={{
                        left: `${leftPct}%`,
                        top: `${topPct}%`,
                        width: `${widthPct}%`,
                        height: `${heightPct}%`
                      }}
                      className="absolute border-2 border-emerald-400 rounded-2xl shadow-[0_0_25px_rgba(52,211,153,0.7)] pointer-events-none transition-all duration-200 flex flex-col justify-between p-1"
                    >
                      {/* Top Corner brackets */}
                      <div className="flex justify-between">
                        <span className="w-2 h-2 border-t-2 border-l-2 border-emerald-300"></span>
                        <span className="w-2 h-2 border-t-2 border-r-2 border-emerald-300"></span>
                      </div>

                      {/* Name Label Tag */}
                      <div className="absolute -top-7 left-0 px-2.5 py-0.5 bg-emerald-500 text-slate-950 font-bold text-[11px] rounded-md shadow-md whitespace-nowrap flex items-center gap-1">
                        <User size={12} /> {face.name}
                      </div>

                      {/* Bottom Corner brackets */}
                      <div className="flex justify-between">
                        <span className="w-2 h-2 border-b-2 border-l-2 border-emerald-300"></span>
                        <span className="w-2 h-2 border-b-2 border-r-2 border-emerald-300"></span>
                      </div>
                    </div>
                  );
                })}

                {/* Live Face Detection Overlay Info Banner */}
                {cctvFrameAnalysis && cctvFrameAnalysis.faces && cctvFrameAnalysis.faces.length > 0 && (
                  <div className="absolute bottom-4 left-4 right-4 p-3 bg-black/80 backdrop-blur-md border border-emerald-500/40 rounded-2xl text-xs text-emerald-300 flex justify-between items-center shadow-lg z-10">
                    <div className="flex items-center gap-2">
                      <User size={16} className="text-emerald-400" />
                      <span>ตรวจพบผู้เดินผ่าน: <strong className="text-white font-bold">{cctvFrameAnalysis.name}</strong></span>
                    </div>
                    {cctvFrameAnalysis.gait && (
                      <span className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${cctvFrameAnalysis.gait.is_abnormal ? 'bg-rose-500/30 text-rose-300 border border-rose-500/50' : 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/50'
                        }`}>
                        {cctvFrameAnalysis.gait.status}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Action Controls & Enroll Face Button */}
              <div className="p-3 bg-white border border-slate-200 rounded-2xl flex flex-col sm:flex-row justify-between items-center gap-3 text-xs text-slate-500">
                <span>💡 ระบบ CCTV AI ประมวลผล Face Recognition + Mediapipe Gait Detection แบบเรียลไทม์</span>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => setShowCctvEnrollModal(true)}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold flex items-center justify-center gap-1.5 transition-all shadow-md active:scale-95 w-full sm:w-auto"
                  >
                    <PlusCircle size={14} /> เพิ่มใบหน้าของคุณเข้า CCTV
                  </button>
                  <button
                    onClick={fetchCctvLogs}
                    className="px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl font-semibold flex items-center justify-center gap-1 transition-colors"
                  >
                    <RefreshCw size={12} /> รีเฟรช
                  </button>
                </div>
              </div>
            </div>

            {/* Movement Activity Logs List */}
            <div className="lg:col-span-5 bg-white/90 backdrop-blur-xl border border-slate-200 rounded-3xl p-5 flex flex-col shadow-xl max-h-[520px]">
              <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Activity size={18} className="text-cyan-600" />
                  <h3 className="font-bold text-sm text-slate-800">ประวัติผู้เดินผ่าน (Passerby Log)</h3>
                </div>
                <span className="text-[11px] text-cyan-600 font-semibold bg-cyan-50 px-2 py-0.5 rounded-full border border-cyan-200">
                  `movement_activity_log.csv`
                </span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2.5 custom-scrollbar pr-1">
                {cctvLogs.length === 0 ? (
                  <div className="h-48 flex flex-col items-center justify-center text-slate-400 text-xs gap-2">
                    <Footprints size={32} className="opacity-40" />
                    <span>ยังไม่มีประวัติการเดินผ่าน</span>
                  </div>
                ) : (
                  cctvLogs.map((log, index) => (
                    <div
                      key={index}
                      className="p-3 bg-slate-50 hover:bg-cyan-50/50 rounded-2xl border border-slate-200/80 transition-all text-xs flex flex-col gap-1.5 shadow-sm"
                    >
                      <div className="flex justify-between items-center">
                        <div className="font-bold text-slate-800 flex items-center gap-1.5">
                          <User size={14} className={log.name !== 'Unknown' ? 'text-emerald-600' : 'text-slate-400'} />
                          <span>{log.name || 'Unknown'}</span>
                        </div>
                        <span className={`px-2 py-0.5 rounded-md font-bold text-[10px] ${log.gait_status?.includes('Abnormal')
                            ? 'bg-rose-100 text-rose-700 border border-rose-200'
                            : 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                          }`}>
                          {log.gait_status || 'Normal gait'}
                        </span>
                      </div>

                      <div className="flex justify-between items-center text-[11px] text-slate-500">
                        <span className="flex items-center gap-1 font-mono text-[10px]"><Clock size={10} /> {log.timestamp}</span>
                        <span className="text-[10px] font-mono text-slate-400">
                          hip:{log.hip || 0} leg:{log.leg || 0}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </main>
      )}

      {/* CCTV Face Enroll Modal */}
      {showCctvEnrollModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-[fadeIn_0.2s_ease]">
          <div className="bg-white rounded-3xl border border-slate-200 p-6 max-w-md w-full shadow-2xl">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2 text-emerald-700 font-bold text-base">
                <PlusCircle size={20} />
                <span>ลงทะเบียนใบหน้า CCTV AI</span>
              </div>
              <button
                onClick={() => setShowCctvEnrollModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold px-2 py-1"
              >
                ✕
              </button>
            </div>

            <p className="text-slate-600 text-xs mb-4">
              ถ่ายภาพใบหน้าปัจจุบันของคุณและตั้งชื่อ เมื่อบันทึกแล้ว ระบบ CCTV AI จะจดจำและแสดงชื่อคุณเมื่อเดินผ่านกล้องทันที
            </p>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">ชื่อ-นามสกุล หรือ ชื่อเล่น</label>
                <input
                  type="text"
                  value={cctvEnrollName}
                  onChange={(e) => setCctvEnrollName(e.target.value)}
                  placeholder="เช่น คุณแทน (Tan)"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
                />
              </div>

              {cctvEnrollMessage && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700">
                  {cctvEnrollMessage}
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowCctvEnrollModal(false)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  onClick={handleCctvFaceEnroll}
                  disabled={cctvEnrollLoading || !cctvEnrollName.trim()}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-md"
                >
                  {cctvEnrollLoading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                  <span>บันทึกใบหน้า</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Attendance Report Drawer (Tunwak's MongoDB) */}
      {appMode === 'ATTENDANCE' && (
        <div className="max-w-7xl w-full mx-auto px-4 md:px-8 pb-8 z-10">
          <button
            onClick={toggleReport}
            className="w-full flex items-center justify-between px-6 py-4 bg-white/90 backdrop-blur-xl border border-emerald-100 rounded-2xl hover:bg-emerald-50/50 transition-all shadow-lg shadow-emerald-950/5 group"
          >
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                <ClipboardList className="text-emerald-600" size={20} />
              </div>
              <div className="text-left">
                <h3 className="font-bold text-sm text-slate-800">Attendance Report</h3>
                <p className="text-[10px] text-slate-500">ข้อมูลจากระบบ Tunwak — MongoDB</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {reportData.length > 0 && (
                <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2.5 py-1 rounded-full font-bold">
                  {reportData.length} records
                </span>
              )}
              {showReport ? <ChevronUp size={18} className="text-slate-500" /> : <ChevronDown size={18} className="text-slate-500" />}
            </div>
          </button>

          {showReport && (
            <div className="mt-3 bg-white border border-emerald-100 rounded-2xl overflow-hidden shadow-xl animate-[fadeIn_0.3s_ease]">
              {reportLoading ? (
                <div className="p-8 flex items-center justify-center gap-3 text-emerald-600">
                  <Loader2 size={20} className="animate-spin" />
                  <span className="text-sm font-medium">กำลังโหลดข้อมูล...</span>
                </div>
              ) : reportData.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-sm">
                  <Database size={32} className="mx-auto mb-3 opacity-40 text-emerald-600" />
                  <p>ไม่พบข้อมูล — Attendance Backend อาจยังไม่ได้เปิด (port 3000)</p>
                  <button onClick={fetchReport} className="mt-3 text-emerald-600 text-xs font-bold hover:underline">ลองอีกครั้ง</button>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm table-fixed">
                    <thead>
                      <tr className="border-b border-emerald-100 bg-emerald-50/50 text-slate-600">
                        <th className="w-[18%] px-4 py-3 text-left font-semibold text-xs">รหัส</th>
                        <th className="w-[32%] px-4 py-3 text-left font-semibold text-xs">ชื่อ</th>
                        <th className="w-[18%] px-4 py-3 text-left font-semibold text-xs">วันที่</th>
                        <th className="w-[18%] px-4 py-3 text-left font-semibold text-xs">เวลา</th>
                        <th className="w-[14%] px-4 py-3 text-center font-semibold text-xs">สถานะ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportData.map((row, i) => (
                        <tr key={row._id || `${row.user_id}-${row.attend_date}-${row.time}-${i}`} className="border-b border-emerald-50 hover:bg-emerald-50/40 transition-colors">
                          <td className="px-4 py-3 font-mono text-xs text-slate-700 font-medium truncate" title={row.user_id}>{row.user_id}</td>
                          <td className="px-4 py-3 text-slate-900 font-semibold truncate" title={row.full_name}>{row.full_name || '—'}</td>
                          <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{row.attend_date || '—'}</td>
                          <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                            <span className="inline-flex items-center gap-1">
                              <Clock size={12} className="text-emerald-500 shrink-0" />
                              {row.time || '—'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center whitespace-nowrap">
                            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${row.status === 'ตรงเวลา' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' :
                                row.status === 'สาย' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                                  'bg-rose-100 text-rose-800 border border-rose-200'
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
      )}

      {/* Global CSS animations & scrollbar */}
      <style>{`
        @keyframes scan {
          0% { top: 0; opacity: 0; }
          15% { opacity: 1; }
          85% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(16, 185, 129, 0.2); border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(16, 185, 129, 0.4); }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

    </div>
  );
}
