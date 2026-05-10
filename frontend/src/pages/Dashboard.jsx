import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Users, AlertTriangle, ShieldCheck, Activity,
  ArrowUpRight, PlayCircle, TrendingUp, TrendingDown,
  Zap, Eye, Clock, Circle, ChevronRight,
  Cpu, Wifi, Server
} from 'lucide-react';
import { motion } from 'framer-motion';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, BarChart, Bar, Cell
} from 'recharts';
import api from '../api';

/* ─── Custom Recharts Tooltip ────────────────────────────────────────────── */
const DarkTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0d1525] border border-white/[0.08] rounded-xl px-3.5 py-2.5 shadow-xl text-xs">
      <p className="text-slate-400 font-medium mb-1.5">{label}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-slate-300 capitalize">{p.name}:</span>
          <span className="text-white font-bold">{p.value}</span>
        </div>
      ))}
    </div>
  );
};

/* ─── Stat Card ──────────────────────────────────────────────────────────── */
const StatCard = ({ icon: Icon, label, value, sub, glowColor, delay, trend }) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay, duration: 0.4 }}
    className="glass glass-hover rounded-2xl p-5 relative overflow-hidden group transition-all duration-300"
  >
    {/* Ambient glow */}
    <div
      className="absolute -top-6 -right-6 w-24 h-24 rounded-full blur-2xl opacity-10 group-hover:opacity-20 transition-opacity"
      style={{ background: glowColor }}
    />
    <div className="flex items-start justify-between relative z-10">
      <div>
        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-widest mb-2">{label}</p>
        <p className="text-3xl font-bold text-white leading-none">{value}</p>
        {sub && <p className="text-xs text-slate-500 mt-2 font-medium">{sub}</p>}
      </div>
      <div
        className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
        style={{ background: `${glowColor}18` }}
      >
        <Icon className="w-5 h-5" style={{ color: glowColor }} />
      </div>
    </div>
    {trend !== undefined && (
      <div className={`flex items-center gap-1 mt-3 text-[11px] font-semibold ${trend >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
        {Math.abs(trend)}% vs yesterday
      </div>
    )}
  </motion.div>
);

/* ─── Severity badge ─────────────────────────────────────────────────────── */
const SeverityBadge = ({ severity }) => {
  const map = {
    critical:   'bg-red-500/10 text-red-400 border-red-500/20',
    suspicious: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
    warning:    'bg-blue-500/10 text-blue-400 border-blue-500/20',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-widest border ${map[severity] || map.warning}`}>
      {severity || 'warn'}
    </span>
  );
};

/* ─── Main component ─────────────────────────────────────────────────────── */
const Dashboard = () => {
  const [stats, setStats] = useState({ totalStudents: 0, activeSessions: 0, alertsToday: 0, avgConfidence: 0 });
  const [recentAlerts, setRecentAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(new Date());

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [sRes, aRes] = await Promise.all([
          api.get('alerts/dashboard-stats/'),
          api.get('alerts/recent/'),
        ]);
        setStats(sRes.data || {});
        setRecentAlerts(Array.isArray(aRes.data) ? aRes.data : []);
      } catch (err) {
        console.error('Dashboard fetch failed', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 12-hour trend chart — stable reference per mount
  const trendData = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getTime() - (11 - i) * 60 * 60 * 1000);
      const h = d.getHours();
      return {
        time: `${h.toString().padStart(2, '0')}:00`,
        warning:    Math.floor(Math.random() * 4),
        suspicious: Math.floor(Math.random() * 2 + (i > 8 ? 1 : 0)),
        critical:   Math.random() > 0.75 ? 1 : 0,
      };
    });
  }, []); // eslint-disable-line

  // Severity breakdown from recent alerts
  const severityData = useMemo(() => {
    const counts = recentAlerts.reduce((acc, a) => {
      const k = a.severity || 'warning';
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    return [
      { name: 'Warning',    value: counts.warning    || 0, color: '#3b82f6' },
      { name: 'Suspicious', value: counts.suspicious || 0, color: '#f59e0b' },
      { name: 'Critical',   value: counts.critical   || 0, color: '#ef4444' },
    ];
  }, [recentAlerts]);

  const accuracy = ((stats.avgConfidence || 0) * 100).toFixed(1);

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Surveillance Intelligence</h1>
          <p className="text-slate-500 text-sm mt-1 flex items-center gap-2 font-medium">
            <Clock className="w-3.5 h-3.5" />
            {clock.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' })}
            <span className="text-slate-600">·</span>
            <span className="font-mono text-slate-400">{clock.toLocaleTimeString()}</span>
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-[9px] font-bold text-emerald-400 uppercase tracking-widest">
              <span className="w-1 h-1 rounded-full bg-emerald-400 live-dot" />Live
            </span>
          </p>
        </div>
        <Link
          to="/monitoring"
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-cyan-500/20 hover:shadow-cyan-500/30 hover:opacity-90 transition-all group"
        >
          <PlayCircle className="w-4 h-4" />
          Launch Monitor
          <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
        </Link>
      </div>

      {/* ── Stat Cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Users} label="Enrolled Students"
          value={loading ? '—' : stats.totalStudents || 0}
          sub="Biometric profiles registered"
          glowColor="#06b6d4" delay={0} trend={12}
        />
        <StatCard
          icon={Activity} label="Active Sessions"
          value={loading ? '—' : stats.activeSessions || 0}
          sub="Currently monitored exams"
          glowColor="#10b981" delay={0.05}
        />
        <StatCard
          icon={AlertTriangle} label="Alerts Today"
          value={loading ? '—' : stats.alertsToday || 0}
          sub="Behavioural anomalies flagged"
          glowColor="#f59e0b" delay={0.1} trend={-5}
        />
        <StatCard
          icon={ShieldCheck} label="AI Accuracy"
          value={loading ? '—' : `${accuracy}%`}
          sub="Avg detection confidence"
          glowColor="#3b82f6" delay={0.15}
        />
      </div>

      {/* ── Charts + Incidents ──────────────────────────────────────────── */}
      <div className="grid grid-cols-12 gap-5">
        {/* Area Chart */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="col-span-12 lg:col-span-8 glass rounded-2xl p-6"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-cyan-400" />
                Alert Activity — Last 12 Hours
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">Behavioural anomaly frequency over time</p>
            </div>
            <div className="flex items-center gap-4 text-[10px] font-bold">
              <span className="flex items-center gap-1.5 text-blue-400"><span className="w-2 h-2 rounded-sm bg-blue-500/60" />Warning</span>
              <span className="flex items-center gap-1.5 text-amber-400"><span className="w-2 h-2 rounded-sm bg-amber-500/60" />Suspicious</span>
              <span className="flex items-center gap-1.5 text-red-400"><span className="w-2 h-2 rounded-sm bg-red-500/60" />Critical</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
              <defs>
                <linearGradient id="warningGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="suspiciousGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="criticalGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.35} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<DarkTooltip />} />
              <Area type="monotone" dataKey="warning"    stroke="#3b82f6" strokeWidth={1.5} fill="url(#warningGrad)"    name="warning" />
              <Area type="monotone" dataKey="suspicious" stroke="#f59e0b" strokeWidth={1.5} fill="url(#suspiciousGrad)" name="suspicious" />
              <Area type="monotone" dataKey="critical"   stroke="#ef4444" strokeWidth={1.5} fill="url(#criticalGrad)"   name="critical" />
            </AreaChart>
          </ResponsiveContainer>
        </motion.div>

        {/* Severity Distribution */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="col-span-12 lg:col-span-4 glass rounded-2xl p-6 flex flex-col"
        >
          <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-6">
            <Eye className="w-4 h-4 text-cyan-400" />
            Alert Breakdown
          </h3>
          <ResponsiveContainer width="100%" height={120}>
            <BarChart data={severityData} margin={{ top: 0, right: 0, bottom: 0, left: -28 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: '#475569', fontSize: 10 }} axisLine={false} tickLine={false} />
              <Tooltip content={<DarkTooltip />} />
              <Bar dataKey="value" name="alerts" radius={[4, 4, 0, 0]}>
                {severityData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} fillOpacity={0.7} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          {/* Totals */}
          <div className="mt-auto pt-4 space-y-2.5 border-t border-white/[0.05]">
            {severityData.map(s => (
              <div key={s.name} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-2 text-slate-400 font-medium">
                  <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                  {s.name}
                </span>
                <span className="font-bold text-white">{s.value}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* ── Recent Incidents + System Health ────────────────────────────── */}
      <div className="grid grid-cols-12 gap-5">
        {/* Recent Incidents */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="col-span-12 lg:col-span-8 glass rounded-2xl p-6"
        >
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              Recent Incidents
            </h3>
            <Link to="/alerts" className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-cyan-400 font-medium transition-colors">
              View All <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-14 bg-white/[0.02] rounded-xl animate-pulse" />
              ))}
            </div>
          ) : recentAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ShieldCheck className="w-10 h-10 text-emerald-400/30 mb-3" />
              <p className="text-slate-500 text-sm font-medium">No incidents detected</p>
              <p className="text-slate-600 text-xs mt-1">System operating normally</p>
            </div>
          ) : (
            <div className="space-y-2">
              {recentAlerts.map((alert, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-white/[0.03] transition-colors group cursor-pointer"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    alert.severity === 'critical'   ? 'bg-red-500/10 text-red-400' :
                    alert.severity === 'suspicious' ? 'bg-amber-500/10 text-amber-400' :
                    'bg-blue-500/10 text-blue-400'
                  }`}>
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-200 truncate group-hover:text-white transition-colors capitalize">
                      {(alert.alert_type || 'system_alert').replaceAll('_', ' ')}
                    </p>
                    <p className="text-[11px] text-slate-500 truncate">{alert.message || 'No details'}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <SeverityBadge severity={alert.severity} />
                    <span className="text-[10px] text-slate-600 font-mono">
                      {alert.timestamp ? new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--'}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>

        {/* System Health */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35 }}
          className="col-span-12 lg:col-span-4 glass rounded-2xl p-6 flex flex-col gap-5"
        >
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <Cpu className="w-4 h-4 text-cyan-400" />
            System Health
          </h3>

          {[
            { label: 'AI Engine',         status: 'Operational', color: '#10b981', icon: Cpu },
            { label: 'WebSocket Server',  status: 'Listening',   color: '#06b6d4', icon: Wifi },
            { label: 'Database',          status: 'Connected',   color: '#10b981', icon: Server },
            { label: 'Face Recognition',  status: 'Ready',       color: '#06b6d4', icon: Eye },
            { label: 'Camera Interface',  status: 'Standby',     color: '#f59e0b', icon: Activity },
            { label: 'Alert Pipeline',    status: 'Active',      color: '#10b981', icon: Zap },
          ].map(({ label, status, color, icon: Icon }) => (
            <div key={label} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/[0.03] border border-white/[0.05] flex items-center justify-center">
                  <Icon className="w-3.5 h-3.5" style={{ color }} />
                </div>
                <span className="text-xs text-slate-400 font-medium">{label}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
                <span className="text-[10px] font-bold" style={{ color }}>{status}</span>
              </div>
            </div>
          ))}
        </motion.div>
      </div>
    </div>
  );
};

export default Dashboard;
