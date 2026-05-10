import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../api';
import {
  Upload, Film, Play, Loader2, CheckCircle, AlertTriangle,
  XCircle, Clock, BarChart3, Eye, Trash2, AlertCircle,
  ChevronRight, Search, Download, RefreshCw, ZoomIn,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/* ─── Helpers ────────────────────────────────────────────────────────────── */
const fmtDur = sec => {
  if (!sec) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
               : `${m}:${String(s).padStart(2, '0')}`;
};

const fmtTs = sec => {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, '0')}.${(sec % 1).toFixed(1).slice(2)}`;
};

const MEDIA = 'http://localhost:8000';

const SEV_STYLE = {
  critical:   { badge: 'bg-red-500/15 text-red-400 border-red-500/25',   dot: '#ef4444' },
  suspicious: { badge: 'bg-amber-500/15 text-amber-400 border-amber-500/25', dot: '#f59e0b' },
  warning:    { badge: 'bg-blue-500/15 text-blue-400 border-blue-500/25',  dot: '#3b82f6' },
};

const StatusBadge = ({ status, progress }) => {
  const cfg = {
    pending:    { cls: 'bg-slate-500/10 text-slate-400 border-slate-500/20', label: 'Pending' },
    processing: { cls: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',   label: `${Math.round(progress)}%` },
    completed:  { cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', label: 'Done' },
    failed:     { cls: 'bg-red-500/10 text-red-400 border-red-500/20',      label: 'Failed' },
  }[status] || { cls: '', label: status };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-widest border ${cfg.cls}`}>
      {status === 'processing' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
      {status === 'completed'  && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
      {cfg.label}
    </span>
  );
};

/* ─── Alert Timeline ─────────────────────────────────────────────────────── */
const Timeline = ({ alerts, duration, onSeek }) => {
  if (!duration || !alerts?.length) return null;
  return (
    <div className="relative w-full h-8">
      <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1 bg-white/[0.06] rounded-full" />
      {alerts.map(a => {
        const pct  = Math.min(98, (a.timestamp_in_video / duration) * 100);
        const dot  = (SEV_STYLE[a.severity] || SEV_STYLE.warning).dot;
        return (
          <div
            key={a.id}
            title={`${a.alert_type.replaceAll('_', ' ')} @ ${fmtTs(a.timestamp_in_video)}`}
            onClick={() => onSeek(a.timestamp_in_video)}
            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full cursor-pointer
                       hover:scale-150 transition-transform z-10 ring-2 ring-black/60"
            style={{ left: `${pct}%`, background: dot }}
          />
        );
      })}
    </div>
  );
};

/* ─── Evidence Lightbox ──────────────────────────────────────────────────── */
const Lightbox = ({ src, onClose }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md"
    onClick={onClose}
  >
    <motion.img
      src={src}
      initial={{ scale: 0.9 }}
      animate={{ scale: 1 }}
      className="max-w-[90vw] max-h-[85vh] rounded-2xl border border-white/[0.08] shadow-2xl object-contain"
      onClick={e => e.stopPropagation()}
    />
  </motion.div>
);

/* ─── Main Component ─────────────────────────────────────────────────────── */
const VideoAnalysis = () => {
  const [videos, setVideos]         = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [results, setResults]       = useState(null);   // {video, summary, alerts}
  const [uploading, setUploading]   = useState(false);
  const [uploadPct, setUploadPct]   = useState(0);
  const [dragOver, setDragOver]     = useState(false);
  const [search, setSearch]         = useState('');
  const [lightbox, setLightbox]     = useState(null);
  const [processing, setProcessing] = useState(false);
  const [statusMsg, setStatusMsg]   = useState({ type: '', text: '' });

  const fileInputRef = useRef(null);
  const videoRef     = useRef(null);
  const pollRef      = useRef(null);

  /* ── Fetch video list ─────────────────────────────────────────────────── */
  const fetchVideos = useCallback(async () => {
    try {
      const res = await api.get('videos/');
      setVideos(res.data);
    } catch (err) {
      console.error('Failed to fetch videos', err);
    }
  }, []);

  useEffect(() => { fetchVideos(); }, [fetchVideos]);

  /* ── Poll status when processing ─────────────────────────────────────── */
  useEffect(() => {
    clearInterval(pollRef.current);
    if (!selectedId) return;
    const video = videos.find(v => v.id === selectedId);
    if (!video || video.status !== 'processing') return;

    pollRef.current = setInterval(async () => {
      try {
        const st = await api.get(`videos/${selectedId}/status/`);
        setVideos(prev => prev.map(v =>
          v.id === selectedId ? { ...v, ...st.data } : v
        ));
        
        // Fetch results even during processing if we have new alerts
        if (st.data.alert_count > 0) {
          fetchResults(selectedId);
        }

        if (st.data.status === 'completed') {
          clearInterval(pollRef.current);
          fetchResults(selectedId);
        } else if (st.data.status === 'failed') {
          clearInterval(pollRef.current);
          setStatusMsg({ type: 'error', text: st.data.error_message || 'Processing failed.' });
        }
      } catch {
        clearInterval(pollRef.current);
      }
    }, 2000);
    return () => clearInterval(pollRef.current);
  }, [selectedId, videos.find(v => v.id === selectedId)?.status]); // eslint-disable-line

  /* ── Fetch results ────────────────────────────────────────────────────── */
  const fetchResults = async id => {
    try {
      const res = await api.get(`videos/${id}/results/`);
      setResults(res.data);
    } catch (err) {
      console.error('Failed to fetch results', err);
    }
  };

  /* ── Select video ─────────────────────────────────────────────────────── */
  const selectVideo = async id => {
    setSelectedId(id);
    setResults(null);
    setStatusMsg({ type: '', text: '' });
    const v = videos.find(v => v.id === id);
    if (v?.status === 'completed') fetchResults(id);
  };

  /* ── Upload ───────────────────────────────────────────────────────────── */
  const handleUpload = async file => {
    if (!file) return;
    const allowed = ['video/mp4', 'video/x-msvideo', 'video/quicktime', 'video/x-matroska', 'video/avi'];
    if (!allowed.some(t => file.type.includes(t.split('/')[1])) &&
        !file.name.match(/\.(mp4|avi|mov|mkv)$/i)) {
      setStatusMsg({ type: 'error', text: 'Unsupported file type. Use MP4, AVI, MOV or MKV.' });
      return;
    }
    if (file.size > 2 * 1024 * 1024 * 1024) {
      setStatusMsg({ type: 'error', text: 'File too large (max 2 GB).' });
      return;
    }

    setUploading(true);
    setUploadPct(0);
    setStatusMsg({ type: '', text: '' });

    const formData = new FormData();
    formData.append('title', file.name.replace(/\.[^/.]+$/, ''));
    formData.append('video_file', file);

    try {
      const res = await api.post('videos/', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: e => setUploadPct(Math.round((e.loaded / e.total) * 100)),
      });
      await fetchVideos();
      selectVideo(res.data.id);
      setStatusMsg({ type: 'success', text: 'Video uploaded. Click Analyse to start AI processing.' });
    } catch (err) {
      const msg = err.response?.data ? JSON.stringify(err.response.data) : 'Upload failed.';
      setStatusMsg({ type: 'error', text: msg });
    } finally {
      setUploading(false);
      setUploadPct(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  /* ── Start processing ─────────────────────────────────────────────────── */
  const handleProcess = async () => {
    if (!selectedId || processing) return;
    setProcessing(true);
    setStatusMsg({ type: '', text: '' });
    try {
      await api.post(`videos/${selectedId}/process/`);
      setVideos(prev => prev.map(v =>
        v.id === selectedId ? { ...v, status: 'processing', progress: 0 } : v
      ));
    } catch (err) {
      setStatusMsg({ type: 'error', text: err.response?.data?.error || 'Failed to start processing.' });
    } finally {
      setProcessing(false);
    }
  };

  /* ── Delete video ─────────────────────────────────────────────────────── */
  const handleDelete = async id => {
    if (!window.confirm('Delete this video and all analysis data permanently?')) return;
    try {
      await api.delete(`videos/${id}/`);
      if (selectedId === id) { setSelectedId(null); setResults(null); }
      setVideos(prev => prev.filter(v => v.id !== id));
    } catch { alert('Delete failed.'); }
  };

  /* ── Seek video player ────────────────────────────────────────────────── */
  const seekTo = ts => {
    if (videoRef.current) {
      videoRef.current.currentTime = ts;
      videoRef.current.pause();
    }
  };

  const selected  = videos.find(v => v.id === selectedId);
  const filtered  = videos.filter(v =>
    v.title.toLowerCase().includes(search.toLowerCase())
  );

  /* ── Drag-and-drop ────────────────────────────────────────────────────── */
  const onDrop = e => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUpload(file);
  };

  return (
    <div className="space-y-5">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Video Behaviour Analysis</h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">
            Upload exam recordings for AI-powered behaviour detection and evidence capture.
          </p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600
                     text-white text-sm font-bold rounded-xl shadow-lg shadow-cyan-500/20
                     hover:opacity-90 transition-all disabled:opacity-50"
        >
          <Upload className="w-4 h-4" />
          {uploading ? `Uploading ${uploadPct}%` : 'Upload Video'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp4,.avi,.mov,.mkv,video/*"
          className="hidden"
          onChange={e => handleUpload(e.target.files[0])}
        />
      </div>

      {/* ── Status banner ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {statusMsg.text && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={`flex items-center gap-3 p-4 rounded-xl border text-sm font-medium ${
              statusMsg.type === 'success'
                ? 'bg-emerald-500/[0.08] border-emerald-500/20 text-emerald-400'
                : 'bg-red-500/[0.08] border-red-500/20 text-red-400'
            }`}
          >
            {statusMsg.type === 'success'
              ? <CheckCircle className="w-4 h-4 flex-shrink-0" />
              : <AlertCircle  className="w-4 h-4 flex-shrink-0" />}
            {statusMsg.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Upload progress bar ─────────────────────────────────────────── */}
      <AnimatePresence>
        {uploading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="glass rounded-xl p-4"
          >
            <div className="flex justify-between text-xs font-bold text-slate-400 mb-2">
              <span className="flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-cyan-400" /> Uploading…
              </span>
              <span className="text-cyan-400">{uploadPct}%</span>
            </div>
            <div className="h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full"
                style={{ width: `${uploadPct}%` }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Two-panel layout ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 items-start">

        {/* ── Left: Video list ─────────────────────────────────────────── */}
        <div className="space-y-3">
          {/* Search */}
          <div className="relative group">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-600 group-focus-within:text-cyan-400 transition-colors" />
            <input
              type="text"
              placeholder="Search videos…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-[#0d1525] border border-white/[0.07] rounded-xl text-sm
                         text-slate-200 placeholder:text-slate-600 outline-none focus:border-cyan-500/50
                         focus:ring-2 focus:ring-cyan-500/10 transition-all"
            />
          </div>

          {/* Drop zone (when no videos OR as a quick-add) */}
          {videos.length === 0 && !uploading && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center
                         cursor-pointer transition-all ${
                           dragOver
                             ? 'border-cyan-500/60 bg-cyan-500/[0.04]'
                             : 'border-white/[0.08] hover:border-cyan-500/30 hover:bg-cyan-500/[0.02]'
                         }`}
            >
              <Film className="w-10 h-10 text-slate-700 mb-3" />
              <p className="text-sm font-bold text-slate-400">Drop video here</p>
              <p className="text-xs text-slate-600 mt-1">MP4, AVI, MOV, MKV</p>
            </div>
          )}

          {/* Video cards */}
          <div className="space-y-2 max-h-[70vh] overflow-y-auto custom-scrollbar pr-1">
            {filtered.map(v => (
              <motion.div
                key={v.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => selectVideo(v.id)}
                className={`glass rounded-xl p-3.5 cursor-pointer transition-all group relative ${
                  selectedId === v.id
                    ? 'border-cyan-500/30 bg-cyan-500/[0.04] shadow-[0_0_16px_rgba(6,182,212,0.06)]'
                    : 'border-white/[0.06] hover:border-white/[0.10] hover:bg-white/[0.02]'
                }`}
              >
                {/* Processing progress stripe */}
                {v.status === 'processing' && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-b-xl overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all"
                      style={{ width: `${v.progress}%` }}
                    />
                  </div>
                )}

                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Film className={`w-4 h-4 flex-shrink-0 ${
                      selectedId === v.id ? 'text-cyan-400' : 'text-slate-600'
                    }`} />
                    <span className="text-sm font-semibold text-slate-200 truncate">
                      {v.title}
                    </span>
                  </div>
                  <StatusBadge status={v.status} progress={v.progress} />
                </div>

                <div className="flex items-center gap-3 text-[10px] text-slate-600 font-medium">
                  {v.duration && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />{fmtDur(v.duration)}
                    </span>
                  )}
                  {v.resolution && <span>{v.resolution}</span>}
                  {v.fps && <span>{Math.round(v.fps)} fps</span>}
                </div>

                <button
                  onClick={e => { e.stopPropagation(); handleDelete(v.id); }}
                  className="absolute top-2.5 right-2.5 w-6 h-6 rounded-lg opacity-0 group-hover:opacity-100
                             flex items-center justify-center text-slate-700 hover:text-red-400
                             hover:bg-red-500/10 transition-all"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </motion.div>
            ))}

            {/* "Add another" drop zone at bottom of list */}
            {videos.length > 0 && (
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border border-dashed rounded-xl p-3 flex items-center justify-center gap-2
                           cursor-pointer transition-all text-[11px] font-bold text-slate-600 ${
                             dragOver
                               ? 'border-cyan-500/40 text-cyan-400'
                               : 'border-white/[0.06] hover:border-cyan-500/20 hover:text-cyan-500/60'
                           }`}
              >
                <Upload className="w-3.5 h-3.5" /> Drop or click to add
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Detail panel ──────────────────────────────────────── */}
        <div className="min-h-[400px]">
          {!selected ? (
            /* Empty state */
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`glass rounded-2xl h-full min-h-[400px] flex flex-col items-center
                         justify-center gap-4 border-2 border-dashed transition-all ${
                           dragOver ? 'border-cyan-500/50 bg-cyan-500/[0.03]' : 'border-transparent'
                         }`}
            >
              <div className="w-20 h-20 rounded-2xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center">
                <Film className="w-10 h-10 text-slate-700" />
              </div>
              <div className="text-center">
                <p className="text-slate-400 font-semibold text-sm">No video selected</p>
                <p className="text-slate-600 text-xs mt-1">Upload a video or select one from the list</p>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600
                           text-white text-sm font-bold rounded-xl hover:opacity-90 transition-all"
              >
                <Upload className="w-4 h-4" /> Upload Video
              </button>
            </div>
          ) : (
            <div className="space-y-5">
              {/* ── Video info + actions ──────────────────────────────── */}
              <div className="glass rounded-2xl p-5 flex flex-col sm:flex-row gap-5">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h2 className="text-lg font-bold text-white">{selected.title}</h2>
                    <StatusBadge status={selected.status} progress={selected.progress} />
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 font-medium">
                    {selected.duration  && <span>Duration: {fmtDur(selected.duration)}</span>}
                    {selected.resolution&& <span>Resolution: {selected.resolution}</span>}
                    {selected.fps       && <span>FPS: {Math.round(selected.fps)}</span>}
                    {selected.total_frames && <span>Frames: {selected.total_frames.toLocaleString()}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {selected.status === 'pending' && (
                    <button
                      onClick={handleProcess}
                      disabled={processing}
                      className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600
                                 text-white text-sm font-bold rounded-xl hover:opacity-90 transition-all
                                 disabled:opacity-50"
                    >
                      {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                      Analyse
                    </button>
                  )}
                  {selected.status === 'failed' && (
                    <button
                      onClick={handleProcess}
                      className="flex items-center gap-2 px-4 py-2.5 glass rounded-xl text-sm font-bold
                                 text-slate-400 hover:text-white border border-white/[0.08] transition-all"
                    >
                      <RefreshCw className="w-4 h-4" /> Retry
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(selected.id)}
                    className="w-9 h-9 rounded-xl glass flex items-center justify-center text-slate-600
                               hover:text-red-400 hover:bg-red-500/10 border border-white/[0.06] transition-all"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* ── Processing progress ───────────────────────────────── */}
              {selected.status === 'processing' && (
                <div className="glass rounded-2xl p-5">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                      <span className="text-sm font-bold text-white">AI Processing…</span>
                    </div>
                    <span className="text-sm font-bold text-cyan-400">{Math.round(selected.progress)}%</span>
                  </div>
                  <div className="h-2 bg-white/[0.06] rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full"
                      animate={{ width: `${selected.progress}%` }}
                      transition={{ duration: 0.5 }}
                    />
                  </div>
                  <p className="text-xs text-slate-600 mt-2">
                    Detecting faces, analysing behaviour, capturing evidence frames…
                  </p>
                </div>
              )}

              {/* ── Error state ───────────────────────────────────────── */}
              {selected.status === 'failed' && (
                <div className="glass rounded-2xl p-5 border border-red-500/20">
                  <div className="flex items-center gap-3">
                    <XCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-red-400">Processing Failed</p>
                      <p className="text-xs text-slate-500 mt-0.5">{selected.error_message || 'Unknown error.'}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Results (show if available, even during processing) ───────── */}
              {results && (
                <ResultsPanel
                  video={results.video}
                  summary={results.summary}
                  alerts={results.alerts}
                  videoRef={videoRef}
                  onSeek={seekTo}
                  onLightbox={setLightbox}
                  isProcessing={selected.status === 'processing'}
                />
              )}

              {/* ── Pending hint ──────────────────────────────────────── */}
              {selected.status === 'pending' && (
                <div className="glass rounded-2xl p-8 flex flex-col items-center text-center gap-3">
                  <BarChart3 className="w-12 h-12 text-slate-700" />
                  <p className="text-slate-400 font-semibold text-sm">Ready to analyse</p>
                  <p className="text-slate-600 text-xs max-w-xs">
                    Click the Analyse button to start AI behaviour detection. Processing time depends on video length.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Lightbox ────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
      </AnimatePresence>
    </div>
  );
};

/* ─── Results Panel ──────────────────────────────────────────────────────── */
const ResultsPanel = ({ video, summary, alerts, videoRef, onSeek, onLightbox, isProcessing }) => {
  const [activeAlert, setActiveAlert] = useState(null);
  const [filterSev, setFilterSev]     = useState('all');

  const filteredAlerts = filterSev === 'all'
    ? alerts
    : alerts.filter(a => a.severity === filterSev);

  const sevCounts = alerts.reduce((acc, a) => {
    acc[a.severity] = (acc[a.severity] || 0) + 1; return acc;
  }, {});

  const stats = [
    { label: 'Total Alerts',   value: summary?.total_alerts  ?? alerts.length,           cls: 'text-white'        },
    { label: 'Warning',        value: summary?.warning_count   ?? sevCounts.warning   ?? 0, cls: 'text-blue-400'  },
    { label: 'Suspicious',     value: summary?.suspicious_count ?? sevCounts.suspicious ?? 0, cls: 'text-amber-400'},
    { label: 'Critical',       value: summary?.critical_count  ?? sevCounts.critical  ?? 0, cls: 'text-red-400'   },
    { label: 'Avg Confidence', value: summary ? `${Math.round(summary.average_confidence * 100)}%` : '—', cls: 'text-cyan-400' },
    { label: 'Proc. Time',     value: summary ? `${summary.processing_time}s` : '—',    cls: 'text-slate-300'    },
  ];

  return (
    <div className="space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map(s => (
          <div key={s.label} className="glass rounded-xl p-3.5 text-center">
            <p className={`text-xl font-bold ${s.cls}`}>{s.value}</p>
            <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Video player */}
      {video?.video_file && (
        <div className="glass rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-white/[0.05] flex items-center gap-2">
            <Film className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-bold text-white">Video Player</span>
            <span className="text-xs text-slate-600 ml-auto">Click an alert to seek</span>
          </div>
          <div className="p-4 space-y-3">
            <video
              ref={videoRef}
              src={`${MEDIA}${video.video_file}`}
              controls
              className="w-full rounded-xl bg-black max-h-64 object-contain"
            />
            {/* Timeline */}
            <Timeline
              alerts={alerts}
              duration={video.duration}
              onSeek={ts => { onSeek(ts); setActiveAlert(null); }}
            />
            <div className="flex gap-3 text-[10px] text-slate-600 font-medium">
              {[
                { label: 'Critical',   color: '#ef4444' },
                { label: 'Suspicious', color: '#f59e0b' },
                { label: 'Warning',    color: '#3b82f6' },
              ].map(item => (
                <span key={item.label} className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full" style={{ background: item.color }} />
                  {item.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Alerts table */}
      <div className="glass rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.05] flex items-center gap-3 flex-wrap">
          <AlertTriangle className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-bold text-white">Detected Alerts</span>
          <span className="text-[10px] text-slate-600 font-bold ml-1">{alerts.length} total</span>
          {isProcessing && (
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 text-[9px] font-bold uppercase tracking-widest border border-cyan-500/20 animate-pulse">
              <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Live Results
            </span>
          )}

          {/* Severity filter chips */}
          <div className="ml-auto flex gap-1.5">
            {[
              { key: 'all',       label: `All (${alerts.length})` },
              { key: 'critical',   label: `Critical (${sevCounts.critical || 0})` },
              { key: 'suspicious', label: `Suspicious (${sevCounts.suspicious || 0})` },
              { key: 'warning',    label: `Warning (${sevCounts.warning || 0})` },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setFilterSev(key)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider
                           border transition-all ${
                             filterSev === key
                               ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                               : 'text-slate-600 border-white/[0.06] hover:text-slate-300'
                           }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {filteredAlerts.length === 0 ? (
          <div className="py-14 text-center">
            <Eye className="w-10 h-10 text-slate-700 mx-auto mb-3" />
            <p className="text-slate-500 text-sm font-medium">No alerts match this filter</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/[0.04]">
                  {['Timestamp', 'Type', 'Severity', 'Confidence', 'Behaviour', 'Evidence'].map(h => (
                    <th key={h} className="px-5 py-3 text-[9px] font-bold text-slate-600 uppercase tracking-[0.18em] whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.03]">
                {filteredAlerts.map(alert => {
                  const sev = SEV_STYLE[alert.severity] || SEV_STYLE.warning;
                  return (
                    <tr
                      key={alert.id}
                      className={`group hover:bg-white/[0.02] transition-colors cursor-pointer ${
                        activeAlert?.id === alert.id ? 'bg-cyan-500/[0.03]' : ''
                      }`}
                      onClick={() => { setActiveAlert(alert); onSeek(alert.timestamp_in_video); }}
                    >
                      <td className="px-5 py-3.5">
                        <button className="flex items-center gap-1.5 text-xs font-mono font-bold text-cyan-400 hover:text-cyan-300">
                          <ChevronRight className="w-3 h-3" />
                          {fmtTs(alert.timestamp_in_video)}
                        </button>
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="text-xs font-medium text-slate-300 capitalize">
                          {alert.alert_type.replaceAll('_', ' ')}
                        </p>
                        <p className="text-[10px] text-slate-600 mt-0.5 line-clamp-1">{alert.reason}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={`inline-flex px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-widest border ${sev.badge}`}>
                          {alert.severity}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-xs font-bold text-slate-300">
                          {Math.round(alert.confidence_score * 100)}%
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-xs text-slate-500 font-medium">{alert.behaviour_status}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        {alert.evidence_image ? (
                          <button
                            onClick={e => { e.stopPropagation(); onLightbox(`${MEDIA}${alert.evidence_image}`); }}
                            className="w-9 h-9 rounded-lg overflow-hidden border border-white/[0.08] hover:border-cyan-500/30
                                       hover:scale-110 transition-all relative group/img"
                          >
                            <img
                              src={`${MEDIA}${alert.evidence_image}`}
                              alt="evidence"
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100
                                           transition-opacity flex items-center justify-center">
                              <ZoomIn className="w-3.5 h-3.5 text-white" />
                            </div>
                          </button>
                        ) : (
                          <span className="text-slate-700 text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Evidence grid */}
      {alerts.some(a => a.evidence_image) && (
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Eye className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-bold text-white">Evidence Frames</span>
            <span className="text-[10px] text-slate-600 font-bold ml-1">
              {alerts.filter(a => a.evidence_image).length} captures
            </span>
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
            {alerts
              .filter(a => a.evidence_image)
              .map(a => {
                const sev = SEV_STYLE[a.severity] || SEV_STYLE.warning;
                return (
                  <div key={a.id} className="relative group/ev">
                    <button
                      onClick={() => onLightbox(`${MEDIA}${a.evidence_image}`)}
                      className="block w-full aspect-video rounded-xl overflow-hidden border border-white/[0.06]
                                 hover:border-white/[0.14] hover:scale-105 transition-all"
                    >
                      <img
                        src={`${MEDIA}${a.evidence_image}`}
                        alt="frame"
                        className="w-full h-full object-cover"
                      />
                    </button>
                    <span
                      className="absolute top-1 left-1 w-1.5 h-1.5 rounded-full"
                      style={{ background: sev.dot }}
                    />
                    <span className="absolute bottom-1 left-1 text-[8px] font-bold text-white/80 bg-black/60
                                     rounded px-1 leading-tight">
                      {fmtTs(a.timestamp_in_video)}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* Summary report card */}
      {summary && (
        <div className="glass rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-bold text-white">Analysis Report</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            {[
              ['Total Frames',    summary.total_frames?.toLocaleString()    ],
              ['Processed',       summary.processed_frames?.toLocaleString()],
              ['Avg Confidence',  `${Math.round(summary.average_confidence * 100)}%`],
              ['Processing Time', `${summary.processing_time}s`             ],
            ].map(([k, v]) => (
              <div key={k} className="space-y-1">
                <p className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">{k}</p>
                <p className="text-slate-200 font-semibold">{v}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default VideoAnalysis;
