'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, ReactNode, useState } from 'react';
import {
  LayoutDashboard,
  QrCode,
  ClipboardList,
  LogOut,
  ChevronRight,
  Menu,
  X,
  Settings,
  Globe,
  Building2,
  Users,
  UserCheck,
  Dumbbell,
  CreditCard,
  ShieldCheck,
  BarChart3,
  BookOpen,
} from 'lucide-react';
import { useApp } from '../../app/providers';
import { cn } from '@/lib/cn';
import { Avatar, Badge } from './shared';

/* ── Nav definitions ─────────────────────────────────────── */
type NavItem = {
  href: string;
  labelKey: string;
  icon: React.ElementType;
  groupKey?: string;
};

const OPERATOR_NAV: NavItem[] = [
  { href: '/dashboard', labelKey: 'nav.dashboard',  icon: LayoutDashboard },
  { href: '/scan',      labelKey: 'nav.scan',       icon: QrCode },
  { href: '/checkins',  labelKey: 'nav.checkins',   icon: ClipboardList },
];

const ADMIN_NAV: NavItem[] = [
  { href: '/admin',              labelKey: 'admin.nav.overview',      icon: LayoutDashboard, groupKey: 'nav.group.platform' },
  { href: '/admin/gyms',         labelKey: 'admin.nav.gyms',          icon: Building2,       groupKey: 'nav.group.platform' },
  { href: '/admin/owners',       labelKey: 'admin.nav.owners',        icon: UserCheck,       groupKey: 'nav.group.platform' },
  { href: '/admin/members',      labelKey: 'admin.nav.members',       icon: Users,           groupKey: 'nav.group.platform' },
  { href: '/admin/trainers',     labelKey: 'admin.nav.trainers',      icon: Dumbbell,        groupKey: 'nav.group.platform' },
  { href: '/admin/distributions', labelKey: 'admin.nav.distributions', icon: BarChart3,       groupKey: 'nav.group.finance' },
  { href: '/admin/book-keeping',  labelKey: 'admin.nav.bookkeeping',   icon: BookOpen,        groupKey: 'nav.group.finance' },
  { href: '/admin/payments',     labelKey: 'admin.nav.payments',      icon: CreditCard,      groupKey: 'nav.group.operations' },
  { href: '/admin/approvals',    labelKey: 'admin.nav.approvals',     icon: ShieldCheck,     groupKey: 'nav.group.operations' },
  { href: '/admin/settings',     labelKey: 'admin.nav.settings',      icon: Settings,        groupKey: 'nav.group.system' },
];

/* ── SidebarLink ─────────────────────────────────────────── */
function SidebarLink({
  href,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  active: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        'group flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-medium transition-colors',
        active
          ? 'bg-[var(--color-sidebar-active)] text-white'
          : 'text-[var(--color-sidebar-text)] hover:bg-[var(--color-sidebar-hover)] hover:text-white',
      )}
    >
      <Icon className="h-5 w-5 shrink-0" strokeWidth={active ? 2.5 : 1.75} />
      <span className="flex-1 truncate">{label}</span>
      {active && <ChevronRight className="h-4 w-4 shrink-0 opacity-60" />}
    </Link>
  );
}

function resolveLabel(t: (key: any) => string, key: string): string {
  const resolved = t(key);
  // If translation returns the key itself, fall back to a human-readable version
  return resolved === key ? key.split('.').pop()?.replace(/([A-Z])/g, ' $1').trim() || key : resolved;
}

/* ── Sidebar content (shared by mobile drawer + desktop) ─── */
function SidebarContent({
  nav,
  onLinkClick,
}: {
  nav: NavItem[];
  onLinkClick?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { t, user, signOut, locale, setLocale } = useApp();

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 shrink-0 items-center gap-3 px-4 border-b border-[var(--color-gray-800)]">
        <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-brand-600)]">
          <span className="text-white font-bold text-sm">FF</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-semibold text-white">FitFlex Af</p>
          <p className="truncate text-xs text-[var(--color-gray-500)]">
            {user?.userType === 'admin' ? 'Pilot Console' : 'Operator Portal'}
          </p>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {(() => {
          const groups: string[] = [];
          nav.forEach(item => { if (item.groupKey && !groups.includes(item.groupKey)) groups.push(item.groupKey); });
          const ungrouped = nav.filter(item => !item.groupKey);
          return (
            <>
              {ungrouped.map(item => (
                <SidebarLink
                  key={item.href}
                  href={item.href}
                  label={resolveLabel(t, item.labelKey)}
                  icon={item.icon}
                  active={item.href === '/admin' ? pathname === '/admin' : (pathname === item.href || pathname.startsWith(item.href + '/'))}
                  onClick={onLinkClick}
                />
              ))}
              {groups.map(groupKey => (
                <div key={groupKey} className="mt-4">
                  <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-gray-600)]">{resolveLabel(t, groupKey)}</p>
                  {nav.filter(item => item.groupKey === groupKey).map(item => (
                    <SidebarLink
                      key={item.href}
                      href={item.href}
                      label={resolveLabel(t, item.labelKey)}
                      icon={item.icon}
                      active={item.href === '/admin' ? pathname === '/admin' : (pathname === item.href || pathname.startsWith(item.href + '/'))}
                      onClick={onLinkClick}
                    />
                  ))}
                </div>
              ))}
            </>
          );
        })()}
      </nav>

      {/* Footer */}
      <div className="shrink-0 px-3 py-4 border-t border-[var(--color-gray-800)] space-y-1">
        {/* Locale toggle */}
        <div className="flex items-center gap-2 px-3 py-2">
          <Globe className="h-4 w-4 text-[var(--color-gray-500)]" />
          <select
            data-testid="locale-select"
            value={locale}
            onChange={e => setLocale(e.target.value as 'en' | 'sw')}
            className="flex-1 bg-transparent text-xs text-[var(--color-gray-400)] border-none outline-none cursor-pointer"
          >
            <option value="en">English</option>
            <option value="sw">Kiswahili</option>
          </select>
        </div>

        {/* User row + sign out */}
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2">
          <Avatar name={user?.id ?? 'User'} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="truncate text-xs font-medium text-white">{user?.id ?? '—'}</p>
            <p className="truncate text-xs text-[var(--color-gray-500)] capitalize">{user?.userType}</p>
          </div>
          <button
            onClick={() => { signOut(); router.replace('/login'); }}
            className="shrink-0 text-[var(--color-gray-500)] hover:text-white transition-colors"
            title={t('nav.signout')}
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Shell ───────────────────────────────────────────────── */
export function Shell({ children }: { children: ReactNode }) {
  const { ready, token, user } = useApp();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (!token && pathname !== '/login' && pathname !== '/') router.replace('/login');
    if (token && user?.userType !== 'admin' && pathname.startsWith('/admin')) router.replace('/dashboard');
    if (token && user?.userType === 'admin' && ['/dashboard', '/scan', '/checkins'].includes(pathname)) router.replace('/admin');
  }, [ready, token, user, pathname, router]);

  /* Close mobile drawer on route change */
  useEffect(() => { setMobileOpen(false); }, [pathname]);

  const isLoginPage  = pathname === '/login' || !token;
  const isAdminUser  = token && user?.userType === 'admin';
  const nav          = isAdminUser ? ADMIN_NAV : OPERATOR_NAV;

  /* Public / login layout — no sidebar */
  if (isLoginPage) {
    return (
      <div className="min-h-screen bg-[var(--color-bg-secondary)] flex flex-col">
        {/* Minimal top bar for login */}
        <header className="h-16 flex items-center justify-center border-b border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)]">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-brand-600)]">
              <span className="text-white font-bold text-xs">FF</span>
            </div>
            <span className="text-sm font-semibold text-[var(--color-fg-primary)]">FitFlex Af</span>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg-secondary)]">

      {/* ── Desktop sidebar ── */}
      <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:shrink-0 bg-[var(--color-sidebar-bg)]">
        <SidebarContent nav={nav} />
      </aside>

      {/* ── Mobile sidebar overlay ── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setMobileOpen(false)}>
          <div className="absolute inset-0 bg-black/60" />
        </div>
      )}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-50 w-72 bg-[var(--color-sidebar-bg)] transition-transform duration-200 lg:hidden',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      )}>
        <SidebarContent nav={nav} onLinkClick={() => setMobileOpen(false)} />
      </aside>

      {/* ── Main area ── */}
      <div className="flex flex-1 flex-col overflow-hidden">

        {/* Mobile top bar */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border-secondary)] bg-[var(--color-bg-primary)] px-4 lg:hidden">
          <button
            onClick={() => setMobileOpen(v => !v)}
            className="text-[var(--color-fg-tertiary)] hover:text-[var(--color-fg-primary)] transition-colors"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-brand-600)]">
              <span className="text-white font-bold text-xs">FF</span>
            </div>
            <span className="text-sm font-semibold text-[var(--color-fg-primary)]">FitFlex Af</span>
          </div>
          <Badge tone="brand">{user?.userType}</Badge>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>

      </div>
    </div>
  );
}
