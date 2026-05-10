import React, { useEffect, useState } from 'react';
import api from '../api';
import {
  Search, Filter, Download, Calendar,
  ShieldAlert, Eye, Trash2, AlertTriangle, ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

/* ─── Severity helpers ───────────────────────────────────────────────────── */
const SEV = {
  critical:   { badge: 'bg-red-500 text-white',            chip: 'bg-red-500/10 text-red-400 border-red-500/20'    },
  suspicious: { badge: 'bg-amber-500 text-white',          chip: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
  warning:    { badge: 'bg-blue-500/80 text-white',        chip: 'bg-blue-500/10 text-blue-400 border-blue-500/20'  },
};

const fmtDate = ts => {
  try {
    const d = new Date(ts);
    return `${d.toLocaleDateString()} · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch { return 'Invalid date'; }
};

/* ─── Loading skeleton ───────────────────────────────────────────────────── */
const Skeleton = () => (
  <div className="glass rounded-2xl overflow-hidden animate-pulse">
    <div className="bg-white/[0.03] aspect-[16/10]" />
    <div className="p-5 space-y-3">
      <div className="h-4 bg-white/[0.04] rounded-lg w-2/3" />
      <div className="h-3 bg-white/[0.03] rounded-lg w-1/2" />
      <div className="h-3 bg-white/[0.03] rounded-lg w-4/5" />
    </div>
  </div>
);

/* ─── Main Component ─────────────────────────────────────────────────────── */
const AlertsLogs = () => {
  const [alerts, setAlerts]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterSev, setFilterSev]   = useState('all');

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('alerts/');
        setAlerts(res.data);
      } catch (err) {
        console.error('Failed to fetch alerts', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this incident record permanently?')) return;
    try {
      await api.delete(`alerts/${id}/`);
      setAlerts(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      console.error('Delete failed', err);
    }
  };

  const filtered = alerts.filter(a => {
    const matchSearch =
      (a.student_name?.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (a.alert_type?.toLowerCase().includes(searchTerm.toLowerCase()));
    const matchSev = filterSev === 'all' || a.severity === filterSev;
    return matchSearch && matchSev;
  });

  const severityCounts = alerts.reduce((acc, a) => {
    acc[a.severity] = (acc[a.severity] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Incident Intelligence Logs</h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">
            Comprehensive audit trail of all behavioural anomalies and biometric evidence.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="flex items-center gap-2 px-4 py-2.5 glass rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-all border border-white/[0.06] hover:border-white/[0.10]">
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <button className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-cyan-500/80 to-blue-600/80 text-white rounded-xl text-xs font-bold shadow-lg shadow-cyan-500/10 hover:opacity-90 transition-all">
            <Filter className="w-3.5 h-3.5" /> Filter
          </button>
        </div>
      </div>

      {/* ── Summary chips ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {[
          { key: 'all',       label: `All  (${alerts.length})`,                       cls: 'bg-white/[0.06] text-slate-300 border-white/[0.08]' },
          { key: 'critical',   label: `Critical  (${severityCounts.critical   || 0})`, cls: 'bg-red-500/10 text-red-400 border-red-500/20'       },
          { key: 'suspicious', label: `Suspicious  (${severityCounts.suspicious || 0})`, cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
          { key: 'warning',    label: `Warning  (${severityCounts.warning    || 0})`,  cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20'    },
        ].map(({ key, label, cls }) => (
          <button
            key={key}
            onClick={() => setFilterSev(key)}
            className={`px-3.5 py-1.5 rounded-xl text-[11px] font-bold uppercase tracking-widest border transition-all ${cls} ${filterSev === key ? 'ring-2 ring-offset-1 ring-offset-[#060a12] ring-current' : 'opacity-70 hover:opacity-100'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Search ─────────────────────────────────────────────────────── */}
      <div className="relative group max-w-xl">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 group-focus-within:text-cyan-400 transition-colors" />
        <input
          type="text"
          placeholder="Search by student, ID or incident type…"
          className="w-full pl-11 pr-5 py-3 bg-[#0d1525] border border-white/[0.07] rounded-xl text-sm text-slate-200 placeholder:text-slate-600 font-medium outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 transition-all"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
        />
      </div>

      {/* ── Grid ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass rounded-2xl p-20 text-center">
          <ShieldAlert className="w-14 h-14 text-slate-700 mx-auto mb-4" />
          <h3 className="text-lg font-bold text-white mb-1">No Incidents Found</h3>
          <p className="text-slate-500 text-sm font-medium max-w-xs mx-auto">
            Adjust your search or filter to find specific incidents.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          <AnimatePresence>
            {filtered.map((alert, idx) => {
              const sev = SEV[alert.severity] || SEV.warning;
              return (
                <motion.div
                  key={alert.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: idx * 0.03 }}
                  className="glass glass-hover rounded-2xl overflow-hidden group transition-all duration-300 hover:shadow-glass-lg"
                >
                  {/* Evidence thumbnail */}
                  <div className="relative aspect-[16/9] bg-[#080c14] overflow-hidden">
                    {alert.evidence?.screenshot ? (
                      <img
                        src={`http://localhost:8000${alert.evidence.screenshot}`}
                        alt="Evidence"
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-slate-700">
                        <Eye className="w-8 h-8" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">No Visual Data</span>
                      </div>
                    )}
                    {/* Severity badge */}
                    <span className={`absolute top-3 left-3 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-lg backdrop-blur-sm ${sev.badge}`}>
                      {(alert.alert_type || 'incident').replaceAll('_', ' ')}
                    </span>
                    {/* Delete */}
                    <button
                      onClick={e => handleDelete(alert.id, e)}
                      className="absolute top-3 right-3 w-7 h-7 rounded-lg bg-black/50 backdrop-blur-sm flex items-center justify-center text-slate-400 hover:text-red-400 hover:bg-red-500/20 transition-all opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Card body */}
                  <div className="p-5">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-bold text-slate-100 text-sm group-hover:text-white transition-colors">
                          {alert.student_name || 'Unidentified Subject'}
                        </h3>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Calendar className="w-3 h-3 text-slate-600" />
                          <span className="text-[10px] text-slate-600 font-medium">{fmtDate(alert.timestamp)}</span>
                        </div>
                      </div>
                      <span className={`px-2 py-0.5 rounded-lg text-[9px] font-bold uppercase tracking-widest border ${sev.chip}`}>
                        {alert.severity}
                      </span>
                    </div>

                    <p className="text-xs text-slate-500 leading-relaxed mb-4 line-clamp-2 italic">
                      "{alert.message || 'No details available.'}"
                    </p>

                    <div className="flex items-center justify-between pt-3 border-t border-white/[0.05]">
                      <div>
                        <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">Confidence</p>
                        <p className="text-xs font-bold text-white mt-0.5">
                          {Math.round((alert.confidence_score || 0) * 100)}%
                        </p>
                      </div>
                      <button className="flex items-center gap-1.5 px-3 py-1.5 glass rounded-lg text-[10px] font-bold text-slate-400 hover:text-white transition-all">
                        Audit <ExternalLink className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
};

export default AlertsLogs;
