import { useState, useEffect } from 'react';
import api from '../api';
import {
  Settings as SettingsIcon, Plus, Trash2,
  CheckCircle, AlertCircle, Loader2, Clock, Calendar, Zap, Power
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const fmtDate = ts => {
  try { return new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  catch { return '—'; }
};

const Settings = () => {
  const [sessions, setSessions]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [creating, setCreating]   = useState(false);
  const [toggling, setToggling]   = useState(null);
  const [newTitle, setNewTitle]   = useState('');
  const [status, setStatus]       = useState({ type: '', message: '' });

  const fetchSessions = async () => {
    try {
      const res = await api.get('sessions/');
      setSessions(res.data);
    } catch (err) {
      console.error('Failed to fetch sessions', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSessions(); }, []); // eslint-disable-line

  const handleCreate = async e => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const now     = new Date();
      const endTime = new Date(now.getTime() + 3 * 60 * 60 * 1000);
      await api.post('sessions/', {
        title: newTitle.trim(),
        start_time: now.toISOString(),
        end_time:   endTime.toISOString(),
        is_active:  true,
      });
      setStatus({ type: 'success', message: 'Session initialized successfully.' });
      setNewTitle('');
      fetchSessions();
    } catch {
      setStatus({ type: 'error', message: 'Failed to initialize session.' });
    } finally {
      setCreating(false);
    }
  };

  const toggleSession = async (id, current) => {
    setToggling(id);
    try {
      await api.patch(`sessions/${id}/`, { is_active: !current });
      fetchSessions();
    } catch (err) {
      console.error('Toggle failed', err);
    } finally {
      setToggling(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight">System Configuration</h1>
        <p className="text-slate-500 text-sm mt-1 font-medium">
          Manage examination sessions and surveillance parameters.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ── Create panel ──────────────────────────────────────────────── */}
        <div className="lg:col-span-1">
          <div className="glass rounded-2xl p-6 sticky top-6">
            <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-5">
              <Plus className="w-4 h-4 text-cyan-400" />
              Initialize Session
            </h3>

            <form onSubmit={handleCreate} className="space-y-5">
              <div className="space-y-1.5">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-[0.15em]">
                  Session Identity
                </label>
                <input
                  type="text"
                  placeholder="e.g. Final Exam — Math 2026"
                  className="w-full px-4 py-3 bg-[#0d1525] border border-white/[0.07] rounded-xl text-sm text-slate-200 placeholder:text-slate-600 font-medium outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 transition-all"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  required
                />
              </div>

              {/* Duration hint */}
              <div className="flex items-center gap-2 px-3 py-2.5 bg-[#080c14] rounded-xl border border-white/[0.05]">
                <Clock className="w-3.5 h-3.5 text-slate-600" />
                <span className="text-[11px] text-slate-600 font-medium">Default duration: 3 hours</span>
              </div>

              <button
                type="submit"
                disabled={creating || !newTitle.trim()}
                className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-cyan-500/15 hover:opacity-90 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                {creating ? 'Initializing…' : 'Start Session'}
              </button>
            </form>

            {/* Status message */}
            <AnimatePresence>
              {status.message && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={`flex items-center gap-2 p-3.5 mt-4 rounded-xl text-xs font-medium border ${
                    status.type === 'success'
                      ? 'bg-emerald-500/[0.08] border-emerald-500/20 text-emerald-400'
                      : 'bg-red-500/[0.08] border-red-500/20 text-red-400'
                  }`}
                >
                  {status.type === 'success' ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                  {status.message}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* ── Sessions list ─────────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <div className="glass rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.05] flex items-center gap-2">
              <SettingsIcon className="w-4 h-4 text-slate-500" />
              <h3 className="text-sm font-bold text-white">Active & Archive Sessions</h3>
              <span className="ml-auto text-[10px] text-slate-600 font-bold">{sessions.length} total</span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
              </div>
            ) : sessions.length === 0 ? (
              <div className="py-20 text-center">
                <Calendar className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                <p className="text-slate-500 text-sm font-medium">No sessions yet</p>
                <p className="text-slate-600 text-xs mt-1">Create one using the panel on the left.</p>
              </div>
            ) : (
              <div className="divide-y divide-white/[0.04]">
                {sessions.map((session, idx) => (
                  <motion.div
                    key={session.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.04 }}
                    className="px-6 py-5 flex items-center justify-between gap-4 group hover:bg-white/[0.02] transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 mb-1">
                        <h4 className="font-semibold text-slate-200 text-sm truncate group-hover:text-white transition-colors">
                          {session.title}
                        </h4>
                        <span className={`flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-widest border ${
                          session.is_active
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-white/[0.04] text-slate-600 border-white/[0.06]'
                        }`}>
                          {session.is_active && <span className="w-1 h-1 rounded-full bg-emerald-400 live-dot" />}
                          {session.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-[10px] text-slate-600 font-medium">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          Ends: {fmtDate(session.end_time)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          Created: {fmtDate(session.start_time)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => toggleSession(session.id, session.is_active)}
                        disabled={toggling === session.id}
                        className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[11px] font-bold transition-all ${
                          session.is_active
                            ? 'bg-white/[0.05] text-slate-400 hover:bg-white/[0.08] hover:text-white'
                            : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20'
                        }`}
                      >
                        {toggling === session.id
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : <Power className="w-3 h-3" />}
                        {session.is_active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-700 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
