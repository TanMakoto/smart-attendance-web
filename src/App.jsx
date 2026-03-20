import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, QrCode, ShieldCheck, CheckCircle2, XCircle, Activity, User, Fingerprint, Loader2, Scan } from 'lucide-react';

// --- Static User Database (Mocked for QR Scan) ---
const USER_DATABASE = [
  { id: '6612247018', name: 'นายณัฐวุฒิ พุ่มประเสริฐ', role: 'นักศึกษา', dept: 'วิศวกรรมคอมพิวเตอร์' },
  { id: 'EMP002', name: 'วิภาวี รักงาน', role: 'บุคลากร', dept: 'IT Support' },
];

export default function App() {
  // --- Core State Machine ---
  // Flow: IDLE -> FACE_SCAN -> VERIFYING -> SUCCESS | ERROR -> (auto reset)
  const [status, setStatus] = useState('IDLE');

  // Data
  const [currentUser, setCurrentUser] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [logs, setLogs] = useState([]);

  // Refs
  const videoRef = useRef(null);
  const timerRef = useRef(null);

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
  };

  const resetToIdle = useCallback((delay = 3000) => {
    clearTimers();
    timerRef.current = setTimeout(() => {
      setStatus('IDLE');
      setCurrentUser(null);
      setErrorMessage('');
    }, delay);
  }, []);

  // --- Step 1: Scan QR (Simulated via Button) ---
  const handleQrScan = (id) => {
    if (status !== 'IDLE') return; // Only accept QR from IDLE state
    clearTimers();

    const foundUser = USER_DATABASE.find(u => u.id === id);
    if (foundUser) {
      setCurrentUser(foundUser);
      setStatus('FACE_SCAN');

      // Auto-capture face after 1.5 seconds giving user time to pose
      timerRef.current = setTimeout(() => {
        setStatus('VERIFYING');
        // Do not put async side effects in setState updaters! Run it here directly.
        performCapture(foundUser);
      }, 1500);

    } else {
      setErrorMessage('User not found in system.');
      setStatus('ERROR');
      resetToIdle();
    }
  };

  const performCapture = async (userToVerify) => {
    if (!videoRef.current || !userToVerify) {
      setErrorMessage("Camera not ready. Make sure your browser allows camera access.");
      setStatus('ERROR');
      resetToIdle(4000);
      return;
    }

    try {
      // 1. Capture Frame to Blob
      const canvas = document.createElement('canvas');
      let w = videoRef.current.videoWidth;
      let h = videoRef.current.videoHeight;
      if (w === 0 || h === 0) {
        throw new Error("Camera stream is invalid (0x0 resolution).");
      }

      // Speed Optimization: Downscale image to max 640px width
      const MAX_WIDTH = 640;
      if (w > MAX_WIDTH) {
        h = Math.round((h * MAX_WIDTH) / w);
        w = MAX_WIDTH;
      }

      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      // Draw optimized image
      ctx.drawImage(videoRef.current, 0, 0, w, h);

      // Compress JPEG slightly for faster upload (0.8 quality instead of 0.9)
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));

      if (!blob) {
        throw new Error("Failed to create image blob from camera.");
      }

      // 2. Prepare Form Data
      const formData = new FormData();
      formData.append("user_id", userToVerify.id);
      formData.append("file", blob, "snapshot.jpg");

      // 3. Send to API dynamically using the host IP or Vercel Environment Variable
      const API_URL = import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8000/api/verify_face`;
      const response = await fetch(API_URL, {
        method: "POST",
        body: formData
      });

      if (!response.ok) throw new Error("API Connection Failed");

      const data = await response.json();

      // 4. Handle Result
      if (data.match) {
        setStatus('SUCCESS');
        addLog(userToVerify, data.score);
        resetToIdle(3000);
      } else {
        setErrorMessage(data.message || "Face not recognized.");
        setStatus('ERROR');
        resetToIdle(3000);
      }

    } catch (err) {
      console.error(err);
      setErrorMessage(`Error: ${err.message}`);
      setStatus('ERROR');
      resetToIdle(4000);
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

  // --- RENDER HELPERS ---
  const renderIcon = () => {
    switch (status) {
      case 'IDLE': return <QrCode size={48} className="text-blue-500 animate-pulse" />;
      case 'FACE_SCAN': return <Scan size={48} className="text-yellow-400 animate-pulse" />;
      case 'VERIFYING': return <Loader2 size={48} className="text-purple-500 animate-spin" />;
      case 'SUCCESS': return <CheckCircle2 size={64} className="text-green-500" />;
      case 'ERROR': return <XCircle size={64} className="text-red-500" />;
      default: return <Camera size={48} />;
    }
  };

  const renderTitle = () => {
    switch (status) {
      case 'IDLE': return "Ready to Scan";
      case 'FACE_SCAN': return "Stand Still...";
      case 'VERIFYING': return "Analyzing Face...";
      case 'SUCCESS': return "Access Granted";
      case 'ERROR': return "Access Denied";
      default: return "";
    }
  };

  const renderDescription = () => {
    switch (status) {
      case 'IDLE': return "Present your ID or QR Code to begin.";
      case 'FACE_SCAN': return `Verifying: ${currentUser?.name}`;
      case 'VERIFYING': return "Matching against the database securely.";
      case 'SUCCESS': return `Welcome back, ${currentUser?.name}!`;
      case 'ERROR': return errorMessage;
      default: return "";
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] text-slate-200 font-sans selection:bg-blue-600/30 overflow-hidden flex flex-col relative">

      {/* Dynamic Background Gradients */}
      <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-gradient-to-b opacity-20 blur-[120px] rounded-full pointer-events-none transition-colors duration-1000 ${status === 'IDLE' ? 'from-blue-600 to-transparent' :
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
          <div className={`relative w-full aspect-video md:aspect-[4/3] max-h-[60vh] rounded-3xl overflow-hidden border-2 shadow-2xl transition-all duration-500 ${status === 'SUCCESS' ? 'border-green-500/40 shadow-green-900/20' :
            status === 'ERROR' ? 'border-red-500/40 shadow-red-900/20' :
              status === 'FACE_SCAN' ? 'border-yellow-500/50 shadow-yellow-900/20 scale-[1.02]' :
                'border-slate-800 shadow-black/50'
            }`}>

            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`w-full h-full object-cover transform scale-x-[-1] transition-all duration-700 ${status === 'VERIFYING' ? 'grayscale opacity-60 blur-sm' :
                (status === 'SUCCESS' || status === 'ERROR') ? 'brightness-50' : 'brightness-110'
                }`}
            />

            {/* Scanning Overlay Effect */}
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

            {/* Standby Overlay */}
            {status === 'IDLE' && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
                <div className="text-center">
                  <Scan size={48} className="mx-auto text-slate-500 mb-4 opacity-50" />
                  <p className="text-slate-400 font-medium">Awaiting Initial QR Scan</p>
                </div>
              </div>
            )}
          </div>

          {/* Test Buttons (Replacing real scanner) */}
          <div className="mt-6 flex flex-wrap gap-4 justify-center">
            <button
              onClick={() => handleQrScan('6612247018')}
              disabled={status !== 'IDLE'}
              className="px-6 py-3 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-700 rounded-xl font-medium transition-all shadow-lg active:scale-95 flex items-center gap-2"
            >
              <QrCode size={18} /> Mock: Natthawut (Valid)
            </button>
            <button
              onClick={() => handleQrScan('INVALID999')}
              disabled={status !== 'IDLE'}
              className="px-6 py-3 bg-red-900/30 hover:bg-red-900/50 disabled:opacity-50 disabled:cursor-not-allowed border border-red-900/50 text-red-200 rounded-xl font-medium transition-all shadow-lg active:scale-95 flex items-center gap-2"
            >
              <XCircle size={18} /> Mock: Invalid ID
            </button>
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
                <div className="bg-red-500/20 w-full p-4 rounded-xl border border-red-500/50 mt-2">
                  <p className="text-red-200 text-sm font-semibold sm:text-base leading-snug">
                    {renderDescription()}
                  </p>
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
      `}</style>

    </div>
  );
}