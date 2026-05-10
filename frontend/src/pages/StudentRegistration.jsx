import { useState, useRef } from 'react';
import api from '../api';
import { Upload, CheckCircle, AlertCircle, Loader2, X, User, Hash, Mail, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/* ─── Image compression (unchanged from original) ───────────────────────── */
const compressImage = file =>
  new Promise(resolve => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = ({ target: { result } }) => {
      const img = new Image();
      img.src = result;
      img.onload = () => {
        const MAX = 800;
        let w = img.width, h = img.height;
        if (w > h ? w > MAX : h > MAX) {
          if (w > h) { h *= MAX / w; w = MAX; }
          else       { w *= MAX / h; h = MAX; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          blob => resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() })),
          'image/jpeg', 0.7
        );
      };
    };
  });

/* ─── Input field ────────────────────────────────────────────────────────── */
const Field = ({ label, id, icon: Icon, ...props }) => (
  <div className="space-y-1.5">
    <label htmlFor={id} className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em]">
      {label}
    </label>
    <div className="relative group">
      {Icon && <Icon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 group-focus-within:text-cyan-400 transition-colors" />}
      <input
        id={id}
        {...props}
        className="w-full pl-10 pr-4 py-3 bg-[#0d1525] border border-white/[0.07] rounded-xl text-sm text-slate-200 placeholder:text-slate-600 font-medium outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 transition-all disabled:opacity-40"
      />
    </div>
  </div>
);

/* ─── Main component ─────────────────────────────────────────────────────── */
const StudentRegistration = () => {
  const [formData, setFormData] = useState({ name: '', roll_number: '', email: '', face_image: null });
  const [previewUrl, setPreviewUrl]   = useState(null);
  const [loading, setLoading]         = useState(false);
  const [loadingStep, setLoadingStep] = useState('');
  const [status, setStatus]           = useState({ type: '', message: '' });
  const fileInputRef = useRef(null);

  const set = (key, val) => setFormData(prev => ({ ...prev, [key]: val }));

  const validateForm = () => {
    if (!formData.name.trim())                             return 'Name is required';
    if (!formData.roll_number.trim())                      return 'Roll number is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) return 'Invalid email format';
    if (!formData.face_image)                              return 'Face image is required';
    return null;
  };

  const handleFileChange = e => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setStatus({ type: 'error', message: 'Image must be under 5 MB' });
      return;
    }
    set('face_image', file);
    setPreviewUrl(URL.createObjectURL(file));
    setStatus({ type: '', message: '' });
  };

  const removeImage = () => {
    set('face_image', null);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async e => {
    e.preventDefault();
    const err = validateForm();
    if (err) { setStatus({ type: 'error', message: err }); return; }

    setLoading(true);
    setLoadingStep('Optimizing image…');
    setStatus({ type: '', message: '' });

    try {
      const optimized = await compressImage(formData.face_image);
      setLoadingStep('Extracting facial embeddings…');

      const data = new FormData();
      data.append('name',         formData.name.trim());
      data.append('roll_number',  formData.roll_number.trim());
      data.append('email',        formData.email.trim());
      data.append('face_image',   optimized);

      await api.post('students/', data, { headers: { 'Content-Type': 'multipart/form-data' } });

      setStatus({ type: 'success', message: 'Student enrolled successfully — face embedding generated.' });
      setFormData({ name: '', roll_number: '', email: '', face_image: null });
      setPreviewUrl(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      const msg = err.response?.data
        ? Object.values(err.response.data).flat().join(', ')
        : 'Server error. Please try again.';
      setStatus({ type: 'error', message: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="mb-7">
        <h1 className="text-2xl font-bold text-white tracking-tight">Student Enrollment</h1>
        <p className="text-slate-500 text-sm mt-1 font-medium">
          Register subjects with biometric profiles for real-time AI recognition.
        </p>
      </div>

      {/* ── Status banner ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {status.message && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={`flex items-center gap-3 p-4 mb-6 rounded-xl border text-sm font-medium ${
              status.type === 'success'
                ? 'bg-emerald-500/[0.08] border-emerald-500/20 text-emerald-400'
                : 'bg-red-500/[0.08] border-red-500/20 text-red-400'
            }`}
          >
            {status.type === 'success'
              ? <CheckCircle className="w-4 h-4 flex-shrink-0" />
              : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
            {status.message}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Form ───────────────────────────────────────────────────────── */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="glass rounded-2xl p-6 space-y-5">
            <Field
              label="Full Identity Name" id="name" icon={User}
              type="text" placeholder="e.g. Alexander Pierce"
              value={formData.name} disabled={loading}
              onChange={e => set('name', e.target.value)}
            />
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Roll / ID" id="roll" icon={Hash}
                type="text" placeholder="ID-001"
                value={formData.roll_number} disabled={loading}
                onChange={e => set('roll_number', e.target.value)}
              />
              <Field
                label="Email System" id="email" icon={Mail}
                type="email" placeholder="name@system.com"
                value={formData.email} disabled={loading}
                onChange={e => set('email', e.target.value)}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white font-bold rounded-xl shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2.5 disabled:opacity-60 disabled:cursor-not-allowed text-sm"
          >
            {loading ? (
              <><Loader2 className="w-4 h-4 animate-spin" />{loadingStep}</>
            ) : (
              <><CheckCircle className="w-4 h-4" />Finalize Enrollment</>
            )}
          </button>

          {/* Steps indicator */}
          <div className="glass rounded-xl p-4">
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-3">Enrollment Process</p>
            <div className="space-y-2.5">
              {[
                { n: '01', label: 'Fill identity details' },
                { n: '02', label: 'Upload clear face photo' },
                { n: '03', label: 'AI extracts facial embedding' },
                { n: '04', label: 'Subject registered for monitoring' },
              ].map(({ n, label }) => (
                <div key={n} className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center text-[9px] font-bold flex-shrink-0">
                    {n}
                  </span>
                  <span className="text-xs text-slate-400 font-medium">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </form>

        {/* ── Image upload ────────────────────────────────────────────────── */}
        <div className="glass rounded-2xl p-6 flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <Camera className="w-4 h-4 text-cyan-400" />
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Biometric Face Profile</p>
          </div>

          {previewUrl ? (
            <div className="relative flex-1 min-h-[280px] rounded-xl overflow-hidden border border-white/[0.06] group">
              <img src={previewUrl} alt="Preview" className="w-full h-full object-cover" />
              {/* Overlay on hover */}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <button
                  type="button"
                  onClick={removeImage}
                  className="w-12 h-12 rounded-xl bg-red-500/80 backdrop-blur-sm flex items-center justify-center text-white hover:bg-red-500 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              {/* Verified overlay */}
              <div className="absolute bottom-3 left-3 flex items-center gap-2 glass px-3 py-1.5 rounded-lg shadow-glass">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-[10px] text-emerald-400 font-bold">Image ready</span>
              </div>
            </div>
          ) : (
            <div
              onClick={() => !loading && fileInputRef.current?.click()}
              className={`flex-1 min-h-[280px] border-2 border-dashed border-white/[0.06] rounded-xl flex flex-col items-center justify-center bg-[#080c14] transition-all group ${
                loading ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:border-cyan-500/30 hover:bg-cyan-500/[0.02]'
              }`}
            >
              <motion.div
                animate={{ y: [0, -5, 0] }}
                transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-4 group-hover:bg-cyan-500/15 transition-colors"
              >
                <Upload className="w-7 h-7 text-cyan-400" />
              </motion.div>
              <p className="text-sm font-bold text-slate-300 mb-1">Upload Biometric Photo</p>
              <p className="text-xs text-slate-600 text-center px-6 font-medium">
                Clear frontal face image for accurate AI recognition
              </p>
              <p className="text-[10px] text-slate-700 mt-3 font-medium">JPG, PNG · Max 5 MB</p>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="hidden"
                disabled={loading}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default StudentRegistration;
