import Sidebar from './Sidebar';

const Layout = ({ children }) => (
  <div className="flex h-screen bg-[#060a12] overflow-hidden">
    <Sidebar />
    <main className="flex-1 overflow-y-auto overflow-x-hidden">
      <div className="max-w-[1600px] mx-auto px-6 py-7 page-enter">
        {children}
      </div>
    </main>
  </div>
);

export default Layout;
