import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Video, UserPlus, Users,
  Bell, Settings, LogOut, Shield, Cpu,
  ChevronLeft, ChevronRight, Menu, X, Wifi,
  Clapperboard
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const NAV = [
  { path: '/',             icon: LayoutDashboard, label: 'Intelligence'  },
  { path: '/monitoring',   icon: Video,           label: 'Live Stream',   live: true },
  { path: '/analysis',     icon: Clapperboard,    label: 'Video Analysis' },
  { path: '/registration', icon: UserPlus,        label: 'Enrollment'    },
  { path: '/records',      icon: Users,           label: 'Identities'    },
  { path: '/alerts',       icon: Bell,            label: 'Incidents'     },
  { path: '/settings',     icon: Settings,        label: 'Configuration' },
];

const Sidebar = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem('token');
    navigate('/login');
  };

  const NavItem = ({ path, icon: Icon, label, live }) => {
    const active = path === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(path);
    return (
      <Link
        to={path}
        onClick={() => setMobileOpen(false)}
        className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group
          ${active
            ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 shadow-[0_0_12px_rgba(6,182,212,0.08)]'
            : 'text-slate-500 hover:text-slate-200 hover:bg-white/[0.04] border border-transparent'
          }`}
      >
        {active && (
          <motion.span
            layoutId="nav-pill"
            className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-cyan-400 rounded-r-full"
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          />
        )}
        <Icon className={`w-[18px] h-[18px] flex-shrink-0 ${active ? 'text-cyan-400' : 'text-slate-600 group-hover:text-slate-400'}`} />
        {!collapsed && (
          <span className="text-sm font-medium flex-1">{label}</span>
        )}
        {!collapsed && live && (
          <span className="flex items-center gap-1 ml-auto">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 live-dot" />
            <span className="text-[9px] font-bold text-emerald-400 uppercase tracking-widest">Live</span>
          </span>
        )}
      </Link>
    );
  };

  const SidebarInner = ({ isMobile = false }) => (
    <div className={`flex flex-col h-full transition-all duration-300 ${!isMobile && collapsed ? 'w-[60px]' : 'w-[228px]'}`}>
      {/* Brand */}
      <div className={`flex items-center gap-3 px-4 py-5 border-b border-white/[0.05] ${!isMobile && collapsed ? 'justify-center px-2' : ''}`}>
        <div className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/25">
          <Shield className="w-4 h-4 text-white" />
        </div>
        {(isMobile || !collapsed) && (
          <div>
            <p className="text-[13px] font-bold text-white tracking-wide leading-none">AI Watch</p>
            <p className="text-[9px] text-slate-600 uppercase tracking-[0.2em] mt-0.5">Surveillance OS</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className={`flex-1 overflow-y-auto py-3 space-y-0.5 ${!isMobile && collapsed ? 'px-1' : 'px-2'}`}>
        {NAV.map(item => (
          !isMobile && collapsed
            ? (
              <Link
                key={item.path}
                to={item.path}
                title={item.label}
                className={`flex items-center justify-center w-10 h-10 mx-auto rounded-xl transition-all
                  ${(item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path))
                    ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                    : 'text-slate-600 hover:text-slate-300 hover:bg-white/[0.04] border border-transparent'
                  }`}
              >
                <item.icon className="w-[18px] h-[18px]" />
              </Link>
            )
            : <NavItem key={item.path} {...item} />
        ))}
      </nav>

      {/* Footer */}
      <div className={`border-t border-white/[0.05] pt-3 pb-4 space-y-1 ${!isMobile && collapsed ? 'px-1' : 'px-2'}`}>
        {/* AI Status */}
        {(isMobile || !collapsed) && (
          <div className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/[0.02] border border-white/[0.04] mb-1">
            <div className="w-7 h-7 rounded-lg bg-[#0d1525] border border-white/[0.06] flex items-center justify-center flex-shrink-0">
              <Cpu className="w-3.5 h-3.5 text-cyan-500" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] text-slate-400 font-medium">AI Engine</p>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <span className="text-[9px] text-emerald-400 font-bold uppercase tracking-wider">Online</span>
              </div>
            </div>
            <Wifi className="w-3.5 h-3.5 text-slate-600 flex-shrink-0" />
          </div>
        )}

        <button
          onClick={handleLogout}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-600 hover:text-red-400 hover:bg-red-500/[0.08] border border-transparent hover:border-red-500/[0.12] transition-all duration-200 ${!isMobile && collapsed ? 'justify-center' : ''}`}
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          {(isMobile || !collapsed) && <span className="text-sm font-medium">Disconnect</span>}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside className={`hidden lg:flex flex-col h-screen bg-[#060a12] border-r border-white/[0.05] relative flex-shrink-0 transition-all duration-300 ${collapsed ? 'w-[60px]' : 'w-[228px]'}`}>
        <SidebarInner />
        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(v => !v)}
          className="absolute -right-3 top-[88px] w-6 h-6 bg-[#0a0f1a] border border-white/[0.08] rounded-full flex items-center justify-center text-slate-500 hover:text-cyan-400 hover:border-cyan-500/30 transition-all z-20"
        >
          {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>
      </aside>

      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="lg:hidden fixed top-4 left-4 z-50 w-9 h-9 bg-[#0a0f1a] border border-white/[0.08] rounded-xl flex items-center justify-center text-slate-400"
      >
        <Menu className="w-4 h-4" />
      </button>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="lg:hidden fixed inset-0 bg-black/70 backdrop-blur-sm z-40"
            />
            <motion.aside
              key="drawer"
              initial={{ x: -240 }}
              animate={{ x: 0 }}
              exit={{ x: -240 }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="lg:hidden fixed left-0 top-0 bottom-0 bg-[#060a12] border-r border-white/[0.05] z-50 overflow-y-auto"
            >
              <button
                onClick={() => setMobileOpen(false)}
                className="absolute top-4 right-4 w-8 h-8 rounded-lg bg-white/[0.05] flex items-center justify-center text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
              <SidebarInner isMobile />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  );
};

export default Sidebar;
