import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Camera, AlertTriangle, ShieldCheck, UserX, Users,
  ArrowLeft, Activity, History, Settings, Bug,
  Wifi, WifiOff, Cpu, Eye
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import api from '../api';

function cn(...inputs) { return twMerge(clsx(inputs)); }

/* ─── Mini stat chip for header row ─────────────────────────────────────── */
const StatChip = ({ label, value, color }) => (
  <div className="glass rounded-xl px-4 py-2.5 flex flex-col">
    <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{label}</span>
    <span className={`text-lg font-bold font-mono leading-none mt-0.5 ${color}`}>{value}</span>
  </div>
);

/* ─── Severity colours ───────────────────────────────────────────────────── */
const SEV = {
  critical:   { card: 'bg-red-500/[0.08] border-red-500/20',   icon: 'bg-red-500/10 text-red-400',   text: 'text-red-400'   },
  suspicious: { card: 'bg-amber-500/[0.08] border-amber-500/20', icon: 'bg-amber-500/10 text-amber-400', text: 'text-amber-400' },
  warning:    { card: 'bg-blue-500/[0.08] border-blue-500/20',  icon: 'bg-blue-500/10 text-blue-400',  text: 'text-blue-400'  },
};

/* ════════════════════════════════════════════════════════════════════════════
   LiveMonitoring — ALL FUNCTIONAL LOGIC UNCHANGED, only JSX/styles updated
   ════════════════════════════════════════════════════════════════════════════ */
const LiveMonitoring = () => {
  const { sessionId: paramSessionId } = useParams();
  const navigate = useNavigate();
  const [sessionId, setSessionId]       = useState(paramSessionId);
  const [isConnected, setIsConnected]   = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [detections, setDetections]     = useState([]);
  const [alerts, setAlerts]             = useState([]);
  const [fps, setFps]                   = useState(0);
  const [debugMode, setDebugMode]       = useState(false);

  const videoRef          = useRef(null);
  const canvasRef         = useRef(null);
  const wsRef             = useRef(null);
  const frameIdRef        = useRef(null);
  const reconnectAttempts = useRef(0);
  const lastFrameTime     = useRef(Date.now());
  const framesCount       = useRef(0);
  const mountedRef        = useRef(true);
  const streamRef         = useRef(null);
  const isSendingRef      = useRef(false);

  const captureWidthRef  = useRef(640);
  const captureHeightRef = useRef(480);

  // ── Fetch active session if not in URL ────────────────────────────────────
  useEffect(() => {
    if (!sessionId) {
      (async () => {
        try {
          const res    = await api.get('sessions/');
          const active = res.data.find(s => s.is_active);
          if (active) { setSessionId(active.id); }
          else { alert('No active exam session found.'); navigate('/'); }
        } catch { navigate('/'); }
      })();
    }
  }, [sessionId, navigate]);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current   = false;
      isSendingRef.current = false;
      if (frameIdRef.current) clearTimeout(frameIdRef.current);
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  // ── WebSocket with exponential backoff ────────────────────────────────────
  useEffect(() => {
    if (!sessionId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl    = `${protocol}//${window.location.host}/ws/monitoring/${sessionId}/`;

    const mergeAlerts = (prev, incoming) => {
      const now       = Date.now();
      const newAlerts = incoming
        .filter(a => !prev.some(ex =>
          ex.type === a.type &&
          ex.student_roll === a.student_roll &&
          (now - (ex.receivedAt || 0)) < 15000
        ))
        .map(a => ({ ...a, receivedAt: now }));
      if (newAlerts.length === 0) return prev;
      return [...newAlerts, ...prev].slice(0, 50);
    };

    const connectWS = () => {
      if (!mountedRef.current) return;
      wsRef.current = new WebSocket(wsUrl);

      wsRef.current.onopen = () => {
        setIsConnected(true);
        reconnectAttempts.current = 0;
      };

      wsRef.current.onclose = () => {
        setIsConnected(false);
        if (!mountedRef.current) return;
        const backoff = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current += 1;
        setTimeout(connectWS, backoff);
      };

      wsRef.current.onerror = (err) => { console.error('WS error:', err); };

      wsRef.current.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); }
        catch (e) { console.warn('WS JSON parse error:', e); return; }

        if (data.detections) setDetections(data.detections);
        if (data.alerts?.length > 0) setAlerts(prev => mergeAlerts(prev, data.alerts));
        if (data.broadcast_alerts?.length > 0) setAlerts(prev => mergeAlerts(prev, data.broadcast_alerts));

        framesCount.current += 1;
        const now = Date.now();
        if (now - lastFrameTime.current >= 1000) {
          setFps(framesCount.current);
          framesCount.current   = 0;
          lastFrameTime.current = now;
        }
      };
    };

    connectWS();
    return () => wsRef.current?.close();
  }, [sessionId]);

  // ── sendFrame — aspect-ratio-preserving capture ───────────────────────────
  const sendFrame = useCallback(function sendFrameImpl() {
    if (!isSendingRef.current) return;
    if (wsRef.current?.readyState === WebSocket.OPEN && videoRef.current) {
      const vw = videoRef.current.videoWidth;
      const vh = videoRef.current.videoHeight;
      if (vw && vh) {
        const capW = 640;
        const capH = Math.round(vh * (capW / vw));
        captureWidthRef.current  = capW;
        captureHeightRef.current = capH;

        const cap    = document.createElement('canvas');
        cap.width    = capW;
        cap.height   = capH;
        cap.getContext('2d').drawImage(videoRef.current, 0, 0, capW, capH);
        wsRef.current.send(JSON.stringify({ frame: cap.toDataURL('image/jpeg', 0.6) }));
      }
    }
    frameIdRef.current = setTimeout(() => requestAnimationFrame(sendFrameImpl), 200);
  }, []);

  // ── Start camera ──────────────────────────────────────────────────────────
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, frameRate: { ideal: 30 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current.play();
          setIsCameraActive(true);
          isSendingRef.current = true;
          requestAnimationFrame(sendFrame);
        };
      }
    } catch (err) {
      console.error('Camera Error:', err);
      alert('Camera access denied or hardware not found.');
    }
  };

  // ── Canvas overlay drawing ────────────────────────────────────────────────
  useEffect(() => {
    const drawOverlays = () => {
      if (!canvasRef.current || !videoRef.current) return;
      const ctx = canvasRef.current.getContext('2d');
      const vw  = videoRef.current.videoWidth;
      const vh  = videoRef.current.videoHeight;
      if (!vw || !vh) return;

      if (canvasRef.current.width  !== vw) canvasRef.current.width  = vw;
      if (canvasRef.current.height !== vh) canvasRef.current.height = vh;
      ctx.clearRect(0, 0, vw, vh);

      const scaleX = vw / captureWidthRef.current;
      const scaleY = vh / captureHeightRef.current;

      detections.forEach(det => {
        const left   = det.bbox[0] * scaleX;
        const top    = det.bbox[1] * scaleY;
        const right  = det.bbox[2] * scaleX;
        const bottom = det.bbox[3] * scaleY;
        const w      = right - left;
        const h      = bottom - top;

        let boxColor, bgFill;
        if (det.status === 'Calibrating') {
          boxColor = '#06b6d4'; bgFill = 'rgba(6,182,212,0.85)';
        } else if (det.status === 'Suspicious' || det.name === 'Unknown') {
          boxColor = '#ef4444'; bgFill = 'rgba(239,68,68,0.90)';
        } else if (det.status === 'Warning') {
          boxColor = '#f59e0b'; bgFill = 'rgba(245,158,11,0.85)';
        } else {
          boxColor = '#10b981'; bgFill = 'rgba(16,185,129,0.85)';
        }

        ctx.strokeStyle = boxColor;
        ctx.lineWidth   = 2;
        ctx.setLineDash([10, 5]);
        ctx.strokeRect(left, top, w, h);

        ctx.setLineDash([]);
        ctx.lineWidth = 2.5;
        const bl = Math.min(20, w * 0.15, h * 0.15);
        ctx.beginPath();
        ctx.moveTo(left, top + bl);    ctx.lineTo(left, top);    ctx.lineTo(left + bl, top);
        ctx.moveTo(right - bl, top);   ctx.lineTo(right, top);   ctx.lineTo(right, top + bl);
        ctx.moveTo(left, bottom - bl); ctx.lineTo(left, bottom); ctx.lineTo(left + bl, bottom);
        ctx.moveTo(right - bl, bottom);ctx.lineTo(right, bottom);ctx.lineTo(right, bottom - bl);
        ctx.stroke();

        if (det.head_direction && det.head_direction !== 'Center') {
          const cx = left + w / 2;
          const cy = top  + h / 2;
          const al = 50;
          let ax = cx, ay = cy;
          if (det.head_direction === 'Left')  ax = left  - al;
          if (det.head_direction === 'Right') ax = right + al;
          if (det.head_direction === 'Up')    ay = top   - al;
          if (det.head_direction === 'Down')  ay = bottom + al;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(ax, ay);
          ctx.strokeStyle = boxColor; ctx.lineWidth = 3; ctx.stroke();
          ctx.beginPath(); ctx.arc(ax, ay, 5, 0, 2 * Math.PI);
          ctx.fillStyle = boxColor; ctx.fill();
        }

        const labelH = 36;
        const labelY = top >= labelH ? top - labelH : bottom;
        ctx.fillStyle = bgFill;
        ctx.fillRect(left, labelY, w, labelH);

        ctx.fillStyle = '#fff';
        ctx.font      = 'bold 12px monospace';
        let line1;
        if (det.status === 'Calibrating') {
          const d = det._debug || {};
          line1 = `Calibrating baseline  [${d.frames && d.target ? `${d.frames}/${d.target}` : '…'}]`;
        } else {
          line1 = `${det.name}  ${Math.round(det.confidence * 100)}%  [${det.status}]`;
        }
        ctx.fillText(line1, left + 6, labelY + 14);

        ctx.font = '600 10px monospace';
        let line2;
        if (det.status === 'Calibrating') {
          line2 = `Hold still — measuring natural head position…`;
        } else {
          const ry = Math.round(det.rel_yaw   || 0);
          const rp = Math.round(det.rel_pitch || 0);
          line2 = `Head:${det.head_direction || 'Center'}  Eyes:${det.gaze || 'Center'}  rY:${ry > 0 ? '+' : ''}${ry}°  rP:${rp > 0 ? '+' : ''}${rp}°`;
        }
        ctx.fillText(line2, left + 6, labelY + 28);

        if (debugMode && det._debug) {
          const d = det._debug;
          const dbgLines = d.phase === 'active' ? [
            `phase: ${d.phase}  state: ${d.state}  zone: ${d.zone}`,
            `rel_yaw: ${d.rel_yaw}°  rel_pitch: ${d.rel_pitch}°`,
            `s_yaw: ${d.smoothed_yaw}°  s_pitch: ${d.smoothed_pitch}°`,
            `baseline_yaw: ${d.baseline_yaw}°  baseline_pitch: ${d.baseline_pitch}°`,
            `raw_yaw: ${d.raw_yaw}°  raw_pitch: ${d.raw_pitch}°`,
            `gaze_count: ${d.gaze_count}  abnormal_s: ${d.abnormal_s}s`,
            `frame: ${captureWidthRef.current}×${captureHeightRef.current}  display: ${vw}×${vh}`,
          ] : [
            `phase: calibrating  ${d.frames}/${d.target} frames`,
            `raw_yaw: ${d.raw_yaw}°  raw_pitch: ${d.raw_pitch}°`,
            `smoothed_yaw: ${d.smoothed_yaw}°  smoothed_pitch: ${d.smoothed_pitch}°`,
          ];
          const panelH = dbgLines.length * 14 + 8;
          ctx.fillStyle = 'rgba(15,23,42,0.88)';
          ctx.fillRect(left, bottom + 4, w, panelH);
          ctx.fillStyle = '#a5f3fc';
          ctx.font = '10px monospace';
          dbgLines.forEach((line, i) => ctx.fillText(line, left + 4, bottom + 14 + i * 14));
        }
      });

      // FPS counter
      ctx.fillStyle = 'rgba(6,10,18,0.7)';
      ctx.beginPath(); ctx.roundRect(vw - 110, 20, 90, 30, 8); ctx.fill();
      ctx.fillStyle = fps >= 4 ? '#10b981' : '#f59e0b';
      ctx.font      = 'bold 12px monospace';
      ctx.fillText(`${fps} FPS`, vw - 95, 40);
    };
    if (isCameraActive) drawOverlays();
  }, [detections, isCameraActive, debugMode, fps]);

  /* ════════════════════════════════════════════════════════════════════════
     RENDER — dark premium UI wrapping the unchanged canvas/WS logic above
     ════════════════════════════════════════════════════════════════════════ */
  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="w-9 h-9 glass rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/[0.07] transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">Live Monitoring</h1>
            <div className="flex items-center gap-2 mt-0.5">
              {isConnected
                ? <><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-dot" /><span className="text-[11px] text-emerald-400 font-medium">Active Stream</span></>
                : <><span className="w-1.5 h-1.5 rounded-full bg-red-500" /><span className="text-[11px] text-red-400 font-medium">System Offline</span></>
              }
            </div>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setDebugMode(v => !v)}
            className={cn(
              'flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all border',
              debugMode
                ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
                : 'glass text-slate-400 hover:text-white border-transparent'
            )}
          >
            <Bug className="w-3.5 h-3.5" />
            {debugMode ? 'Debug ON' : 'Debug'}
          </button>
          <button className="flex items-center gap-2 px-3.5 py-2 glass rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-all border border-transparent hover:border-white/[0.08]">
            <History className="w-3.5 h-3.5" /> Logs
          </button>
          <button className="flex items-center gap-2 px-3.5 py-2 bg-gradient-to-r from-cyan-500/80 to-blue-600/80 text-white rounded-xl text-xs font-bold shadow-lg shadow-cyan-500/10 hover:opacity-90 transition-all">
            <Settings className="w-3.5 h-3.5" /> Session
          </button>
        </div>
      </div>

      {/* ── Stats row ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatChip label="Frame Rate"      value={`${fps} FPS`}              color={fps >= 4 ? 'text-emerald-400' : 'text-amber-400'} />
        <StatChip label="Subjects"        value={detections.length}         color="text-cyan-400" />
        <StatChip label="WebSocket"       value={isConnected ? 'Online' : 'Offline'}  color={isConnected ? 'text-emerald-400' : 'text-red-400'} />
        <StatChip label="Incidents"       value={alerts.length}             color={alerts.length > 0 ? 'text-amber-400' : 'text-emerald-400'} />
      </div>

      {/* ── Main grid ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-12 gap-5">
        {/* ── Video feed ─────────────────────────────────────────────── */}
        <div className="col-span-12 xl:col-span-8 space-y-4">
          <div className="relative aspect-video bg-[#080c14] rounded-2xl overflow-hidden border border-white/[0.06] shadow-glass-lg">
            {/* Camera-off overlay */}
            {!isCameraActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-[#080c14]/95 backdrop-blur-sm">
                <motion.div
                  animate={{ y: [0, -6, 0] }}
                  transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-5"
                >
                  <Camera className="w-8 h-8 text-cyan-400" />
                </motion.div>
                <h3 className="text-lg font-bold text-white mb-1.5">Initialize Visual Stream</h3>
                <p className="text-slate-500 text-sm mb-7 max-w-xs text-center font-medium">
                  Grant camera access to start real-time behavioural analytics
                </p>
                <button
                  onClick={startCamera}
                  disabled={!isConnected}
                  className="px-8 py-3.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold rounded-xl shadow-xl shadow-cyan-500/20 hover:shadow-cyan-500/30 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm"
                >
                  {isConnected ? 'Start Monitoring' : 'Waiting for connection…'}
                </button>
              </div>
            )}

            {/* Scan line while active */}
            {isCameraActive && <div className="scan-line" />}

            <video
              ref={videoRef}
              className="w-full h-full object-contain"
              muted
              playsInline
            />
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full z-20 pointer-events-none"
              style={{ objectFit: 'contain' }}
            />

            {/* Live badges */}
            <div className="absolute top-4 left-4 z-30 flex gap-2">
              <div className="glass rounded-lg px-3 py-1.5 flex items-center gap-2 shadow-glass">
                <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">AI Core</span>
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-dot" />
              </div>
              <div className="glass rounded-lg px-3 py-1.5 flex items-center gap-2 shadow-glass">
                <Users className="w-3.5 h-3.5 text-slate-400" />
                <span className="text-[10px] font-bold text-slate-300">{detections.length} Subjects</span>
              </div>
            </div>

            {/* WS indicator */}
            <div className="absolute top-4 right-4 z-30">
              <div className={cn(
                'glass rounded-lg px-3 py-1.5 flex items-center gap-1.5 shadow-glass',
                isConnected ? 'border-emerald-500/20' : 'border-red-500/20'
              )}>
                {isConnected
                  ? <><Wifi className="w-3.5 h-3.5 text-emerald-400" /><span className="text-[10px] font-bold text-emerald-400">Connected</span></>
                  : <><WifiOff className="w-3.5 h-3.5 text-red-400" /><span className="text-[10px] font-bold text-red-400">Disconnected</span></>
                }
              </div>
            </div>
          </div>

          {/* Behavior intensity placeholder */}
          <div className="glass rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                Behaviour Intensity Index
              </h3>
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Real-time</span>
            </div>
            <div className="h-[80px] flex items-center justify-center border border-dashed border-white/[0.05] rounded-xl">
              <p className="text-[11px] text-slate-600 font-bold uppercase tracking-widest">
                Gaze & Posture Analytics Active
              </p>
            </div>
          </div>
        </div>

        {/* ── Incident stream ─────────────────────────────────────────── */}
        <div className="col-span-12 xl:col-span-4">
          <div className="glass rounded-2xl flex flex-col" style={{ height: 'calc(100vh - 18rem)' }}>
            {/* Panel header */}
            <div className="px-5 py-4 border-b border-white/[0.05] flex items-center justify-between flex-shrink-0">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                Incident Stream
              </h3>
              <div className="flex items-center gap-2">
                <span className={cn(
                  'px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-widest border',
                  alerts.length > 0
                    ? 'bg-red-500/10 text-red-400 border-red-500/20'
                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                )}>
                  {alerts.length > 0 ? `${alerts.length} Active` : 'Clear'}
                </span>
                {alerts.length > 0 && (
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 live-dot" />
                )}
              </div>
            </div>

            {/* Alert list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
              <AnimatePresence initial={false}>
                {alerts.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center py-12">
                    <ShieldCheck className="w-12 h-12 text-emerald-400/20 mb-3" />
                    <p className="text-slate-500 text-sm font-medium">All clear</p>
                    <p className="text-slate-600 text-xs mt-1">No incidents detected</p>
                  </div>
                ) : (
                  alerts.map((alert, idx) => {
                    const s = SEV[alert.severity] || SEV.warning;
                    return (
                      <motion.div
                        key={`${alert.type}-${alert.student_roll}-${alert.receivedAt}`}
                        initial={{ opacity: 0, x: 16 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.25 }}
                        className={cn(
                          'p-4 rounded-xl border transition-all',
                          s.card
                        )}
                      >
                        <div className="flex gap-3">
                          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', s.icon)}>
                            {alert.type === 'multiple_faces' ? <Users className="w-4 h-4" /> :
                             alert.type === 'face_missing'   ? <UserX className="w-4 h-4" /> :
                             <AlertTriangle className="w-4 h-4" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={cn('text-xs font-bold mb-0.5 uppercase tracking-tight truncate', s.text)}>
                              {alert.message}
                            </p>
                            <p className="text-[10px] text-slate-600 font-medium">
                              {alert.student_roll ? `ID: ${alert.student_roll}` : 'Unidentified'}
                              {' · '}
                              {new Date(alert.receivedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </p>
                            <span className={cn('inline-block mt-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest border', s.icon, 'border-current/20')}>
                              {alert.severity}
                            </span>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LiveMonitoring;
