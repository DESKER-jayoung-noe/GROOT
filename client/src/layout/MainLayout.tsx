import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { IconCompare, IconFolder, IconHome, IconLock, IconPlus } from "./SidebarIcons";

const tabs = [
  { to: "/home", Icon: IconHome, label: "홈" },
  { to: "/add", Icon: IconPlus, label: "견적내기" },
  { to: "/compare", Icon: IconCompare, label: "비교하기" },
  { to: "/archive", Icon: IconFolder, label: "보관함" },
] as const;

export function MainLayout() {
  const { user, logout } = useAuth();
  const nav = useNavigate();

  return (
    <div className="h-screen flex overflow-hidden">
      <aside className="w-16 shrink-0 bg-white border-r border-slate-200 flex flex-col items-center py-4 gap-2">
        {tabs.map((t) => {
          const TabIcon = t.Icon;
          return (
            <NavLink
              key={t.to}
              to={t.to}
              title={t.label}
              className={({ isActive }) =>
                `w-11 h-11 flex items-center justify-center rounded-full transition-colors ${
                  isActive ? "bg-[#2563eb] shadow-sm" : "hover:bg-slate-100"
                }`
              }
            >
              {({ isActive }) => <TabIcon active={isActive} />}
            </NavLink>
          );
        })}
        <div className="flex-1" />
        {user?.role === "ADMIN" && (
          <NavLink
            to="/admin/db"
            title="관리자 DB"
            className={({ isActive }) =>
              `w-11 h-11 flex items-center justify-center rounded-full transition-colors ${
                isActive ? "bg-[#2563eb] shadow-sm" : "hover:bg-slate-100"
              }`
            }
          >
            {({ isActive }) => <IconLock active={isActive} />}
          </NavLink>
        )}
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-12 shrink-0 border-b border-slate-200 bg-white flex items-center justify-end px-4 gap-3">
          <span className="text-sm text-slate-600">{user?.username}</span>
          <button type="button" className="text-sm text-slate-500 hover:text-slate-800" onClick={() => { logout(); nav("/login"); }}>
            로그아웃
          </button>
        </header>
        <main className="flex-1 flex flex-col min-h-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
