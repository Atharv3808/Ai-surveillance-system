import { useEffect, useState } from 'react';
import api from '../api';
import { User, ShieldCheck, Search, UserPlus, Trash2, Shield, Filter } from 'lucide-react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';

const fmtDate = ts => {
  try { return new Date(ts).toLocaleDateString(); }
  catch { return '—'; }
};

const StudentRecords = () => {
  const [students, setStudents]     = useState([]);
  const [loading, setLoading]       = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get('students/');
        setStudents(res.data);
      } catch (err) {
        console.error('Failed to fetch students', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this biometric record? This cannot be undone.')) return;
    try {
      await api.delete(`students/${id}/`);
      setStudents(prev => prev.filter(s => s.id !== id));
    } catch (err) {
      console.error('Delete failed', err);
      alert('Failed to delete record. Please try again.');
    }
  };

  const filtered = students.filter(s =>
    (s.name?.toLowerCase().includes(searchTerm.toLowerCase())) ||
    (s.roll_number?.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Biometric Identity Records</h1>
          <p className="text-slate-500 text-sm mt-1 font-medium">
            {students.length} enrolled subject{students.length !== 1 ? 's' : ''} · Biometric profiles for real-time matching
          </p>
        </div>
        <Link
          to="/registration"
          className="flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-sm font-bold rounded-xl shadow-lg shadow-cyan-500/20 hover:opacity-90 transition-all"
        >
          <UserPlus className="w-4 h-4" /> Enroll New Subject
        </Link>
      </div>

      {/* ── Search + Filter ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative group flex-1 max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600 group-focus-within:text-cyan-400 transition-colors" />
          <input
            type="text"
            placeholder="Search by name or roll number…"
            className="w-full pl-11 pr-5 py-3 bg-[#0d1525] border border-white/[0.07] rounded-xl text-sm text-slate-200 placeholder:text-slate-600 font-medium outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/10 transition-all"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
          />
        </div>
        <button className="flex items-center gap-2 px-4 py-2.5 glass rounded-xl text-xs font-bold text-slate-400 hover:text-white transition-all border border-white/[0.06]">
          <Filter className="w-3.5 h-3.5" /> Filter
        </button>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div className="glass rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-white/[0.05]">
                {['Subject Identity', 'Roll / ID', 'System Email', 'Security Status', 'Enrolled', ''].map(h => (
                  <th key={h} className="px-6 py-4 text-[9px] font-bold text-slate-600 uppercase tracking-[0.18em] whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03]">
              {loading ? (
                [1, 2, 3].map(i => (
                  <tr key={i} className="animate-pulse">
                    <td colSpan={6} className="px-6 py-4">
                      <div className="h-10 bg-white/[0.03] rounded-xl" />
                    </td>
                  </tr>
                ))
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-20 text-center">
                    <User className="w-10 h-10 text-slate-700 mx-auto mb-3" />
                    <p className="text-slate-500 text-sm font-medium">No records match your search</p>
                  </td>
                </tr>
              ) : (
                filtered.map((student, idx) => (
                  <motion.tr
                    key={student.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: idx * 0.03 }}
                    className="group hover:bg-white/[0.02] transition-colors"
                  >
                    {/* Avatar + Name */}
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 border border-white/[0.08] bg-[#0d1525]">
                          {student.face_image ? (
                            <img
                              src={`http://localhost:8000${student.face_image}`}
                              alt={student.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-cyan-500/10 text-cyan-400 font-bold text-sm">
                              {student.name?.charAt(0)?.toUpperCase()}
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors">
                            {student.name}
                          </p>
                          <p className="text-[10px] text-slate-600 font-medium">Active Subject</p>
                        </div>
                      </div>
                    </td>

                    {/* Roll */}
                    <td className="px-6 py-4">
                      <span className="px-2.5 py-1 bg-[#0d1525] border border-white/[0.06] rounded-lg text-[11px] font-bold font-mono text-slate-300">
                        {student.roll_number}
                      </span>
                    </td>

                    {/* Email */}
                    <td className="px-6 py-4">
                      <span className="text-sm text-slate-400 font-medium">{student.email}</span>
                    </td>

                    {/* Status */}
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-widest border ${
                        student.is_verified
                          ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                          : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      }`}>
                        {student.is_verified ? <ShieldCheck className="w-3 h-3" /> : <Shield className="w-3 h-3" />}
                        {student.is_verified ? 'Verified' : 'Pending'}
                      </span>
                    </td>

                    {/* Date */}
                    <td className="px-6 py-4">
                      <span className="text-xs text-slate-500 font-medium">{fmtDate(student.created_at)}</span>
                    </td>

                    {/* Delete */}
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleDelete(student.id)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-700 hover:text-red-400 hover:bg-red-500/10 transition-all opacity-0 group-hover:opacity-100"
                        title="Delete record"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default StudentRecords;
