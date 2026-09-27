"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { cn } from "@/lib/utils";
import {
  Bell,
  Bot,
  CalendarCheck,
  Car,
  Compass,
  Crown,
  GitBranch,
  LayoutDashboard,
  ListChecks,
  LogOut,
  MessageSquare,
  Package,
  Radio,
  Route,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  Wallet,
  Workflow,
  Zap,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";
import { t } from "@/lib/i18n/pt-br";
import { getBrand } from "@/lib/brand";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModeToggle } from "@/components/layout/mode-toggle";
import { ChevronDown } from "lucide-react";

// White-label (env, per deploy). Module-scope: brand doesn't change at runtime.
const brand = getBrand();

// Per-role chip metadata, shown inside the account dropdown (moved from the
// old sidebar's always-visible footer strip — the header band has less
// vertical room, so this detail now lives one click away instead of always
// on screen).
const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; label: string; className: string }
> = {
  owner: {
    icon: Crown,
    label: t.roles.owner,
    className: "border-amber-500/40 bg-amber-500/10 text-amber-600",
  },
  admin: {
    icon: Shield,
    label: t.roles.admin,
    className: "border-primary/40 bg-primary/10 text-primary",
  },
  agent: {
    icon: UserCog,
    label: t.roles.agent,
    className: "border-border bg-muted text-foreground",
  },
  viewer: {
    icon: User,
    label: t.roles.viewer,
    className: "border-border bg-card text-muted-foreground",
  },
};

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Small "Beta" chip after the label. Informational only. */
  beta?: boolean;
  /** Plumbing routes (settings-class) — hidden from agent/viewer. Nav hiding
   *  is UX only; the real gates are RLS + route requireRole. */
  adminOnly?: boolean;
}

// Day-to-day items render directly in the tab row. Everything else
// (logistics back-office, CRM/automation plumbing) collapses into one
// dropdown per group — 15 flat tabs overflowed into a horizontal
// scrollbar, which read as broken, not "dense." This mirrors the market
// pattern directly (Toursys' own top nav is "Módulos ▾ / Integrações ▾"
// dropdowns, not a flat 15-item row) — grouping is the market-aligned
// choice here, not a step back toward the old sidebar.
const primaryNavItems: NavItem[] = [
  { href: "/dashboard", label: t.nav.dashboard, icon: LayoutDashboard, adminOnly: true },
  { href: "/inbox", label: t.nav.inbox, icon: MessageSquare },
  { href: "/notifications", label: t.nav.notifications, icon: Bell },
  { href: "/reservas", label: t.nav.reservas, icon: CalendarCheck },
  { href: "/pacotes", label: t.nav.pacotes, icon: Package },
  { href: "/contacts", label: t.nav.contacts, icon: Users },
  { href: "/financeiro", label: t.nav.financeiro, icon: Wallet, adminOnly: true },
];

interface NavGroup {
  label: string;
  icon: typeof LayoutDashboard;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: "Logística",
    icon: Route,
    items: [
      { href: "/agenda-operacional", label: t.nav.agendaOperacional, icon: Route },
      { href: "/motoristas", label: t.nav.motoristas, icon: UserCog },
      { href: "/guias", label: t.nav.guias, icon: Compass },
      { href: "/veiculos", label: t.nav.veiculos, icon: Car },
    ],
  },
  {
    label: "CRM & Automação",
    icon: GitBranch,
    items: [
      { href: "/tarefas", label: t.nav.tarefas, icon: ListChecks },
      { href: "/pipelines", label: t.nav.pipelines, icon: GitBranch },
      { href: "/broadcasts", label: t.nav.broadcasts, icon: Radio, adminOnly: true },
      { href: "/automations", label: t.nav.automations, icon: Zap, adminOnly: true },
      { href: "/flows", label: t.nav.flows, icon: Workflow, beta: true, adminOnly: true },
      { href: "/agents", label: t.nav.aiAgents, icon: Bot, adminOnly: true },
    ],
  },
];

const settingsItem: NavItem = {
  href: "/settings",
  label: t.nav.settings,
  icon: Settings,
  adminOnly: true,
};

/**
 * AppHeader — replaces the old left `Sidebar` + top `Header` pair with one
 * colored header band (2026-09 market-aligned redesign, see DESIGN.md §5
 * "Navigation"). Brand + account on one row, a horizontal scrollable tab
 * row underneath carrying every nav item the old sidebar had (same RBAC
 * filtering, same unread/notification badges — only the chrome changed).
 */
export function AppHeader() {
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();

  // Managed-SaaS role gate: the client logs in as agent/viewer and only
  // sees the customer-facing sections. Owner/admin (the operator) see the
  // plumbing. This hides nav; RLS + route requireRole enforce it for real.
  const canSeePlumbing = accountRole === "owner" || accountRole === "admin";
  const visiblePrimaryNavItems = primaryNavItems.filter((i) => !i.adminOnly || canSeePlumbing);
  const visibleNavGroups = navGroups
    .map((g) => ({ ...g, items: g.items.filter((i) => !i.adminOnly || canSeePlumbing) }))
    .filter((g) => g.items.length > 0);
  const visibleSettingsItem = !settingsItem.adminOnly || canSeePlumbing ? settingsItem : null;

  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();

  // Only surface the account-name row when it actually carries information
  // (see the sidebar's original comment — a solo account is named after the
  // user, so showing it would just duplicate the name right below it).
  const showAccountStrip =
    !profileLoading && !!account?.name && account.name !== profile?.full_name;

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-gradient-to-r from-primary to-primary-hover text-primary-foreground">
      <div className="flex h-14 shrink-0 items-center justify-between gap-3 px-4 lg:px-6">
        <Link href="/dashboard" className="flex min-w-0 items-center gap-2">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logoUrl}
              alt={brand.name}
              className="h-8 w-8 shrink-0 rounded-md object-contain"
            />
          ) : (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-foreground/15 text-primary-foreground">
              <MessageSquare className="h-4 w-4" />
            </div>
          )}
          <span className="truncate text-sm font-semibold text-primary-foreground">
            {brand.name}
          </span>
        </Link>

        <div className="flex items-center gap-1">
          <ModeToggle className="text-primary-foreground/80 hover:bg-primary-foreground/10 hover:text-primary-foreground" />

          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex items-center gap-2 rounded-md px-1 py-1 text-primary-foreground transition-colors hover:bg-primary-foreground/10 focus:bg-primary-foreground/10 focus:outline-none data-popup-open:bg-primary-foreground/10 sm:gap-3 sm:pl-1 sm:pr-3"
              aria-label="Abrir menu da conta"
            >
              <Avatar className="size-8">
                {profile?.avatar_url ? (
                  <AvatarImage
                    src={profile.avatar_url}
                    alt={profile.full_name ?? "Avatar"}
                  />
                ) : null}
                <AvatarFallback className="bg-primary-foreground/15 text-sm font-medium text-primary-foreground">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium sm:inline">
                {profile?.full_name ?? "Usuário"}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={6}
              className="min-w-56 bg-popover text-popover-foreground ring-border"
            >
              <div className="px-2 py-1.5">
                <p className="truncate text-sm font-medium text-foreground">
                  {profile?.full_name ?? "Usuário"}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {profile?.email ?? ""}
                </p>
                {showAccountStrip && account?.name ? (
                  <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <UsersRound className="size-3.5 shrink-0" />
                    <span className="truncate" title={account.name}>
                      {account.name}
                    </span>
                    {accountRole
                      ? (() => {
                          const meta = ROLE_CHIP[accountRole];
                          const Icon = meta.icon;
                          return (
                            <span
                              className={`ml-auto inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${meta.className}`}
                            >
                              <Icon className="size-3" />
                              {meta.label}
                            </span>
                          );
                        })()
                      : null}
                  </div>
                ) : null}
              </div>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <User className="size-4" />
                Perfil
              </DropdownMenuItem>
              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=whatsapp"
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
                  />
                }
              >
                <Settings className="size-4" />
                Configurações
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-popover-foreground focus:bg-accent focus:text-accent-foreground"
              >
                <LogOut className="size-4" />
                {t.common.signOut}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <nav
        className="flex items-center gap-1 overflow-x-auto px-3 pb-0 lg:px-5"
        aria-label="Primary"
      >
        {visiblePrimaryNavItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" && pathname.startsWith(item.href));
          const showUnreadDot =
            item.href === "/inbox" && totalUnread > 0 && !isActive;
          const showNotificationBadge =
            item.href === "/notifications" && unreadNotifications > 0;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "border-primary-foreground text-primary-foreground"
                  : "border-transparent text-primary-foreground/70 hover:text-primary-foreground",
              )}
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
              {item.beta && (
                <span
                  aria-label="Beta feature"
                  className="rounded-full border border-primary-foreground/30 bg-primary-foreground/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
                >
                  Beta
                </span>
              )}
              {showUnreadDot && (
                <span
                  aria-label={`${totalUnread} unread conversation${totalUnread === 1 ? "" : "s"}`}
                  className="relative flex h-2 w-2 shrink-0"
                >
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-foreground opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-foreground" />
                </span>
              )}
              {showNotificationBadge && (
                <span
                  aria-label={`${unreadNotifications} unread notification${unreadNotifications === 1 ? "" : "s"}`}
                  className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary-foreground px-1 text-[10px] font-semibold text-primary"
                >
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </span>
              )}
            </Link>
          );
        })}

        {visibleNavGroups.map((group) => {
          const isGroupActive = group.items.some((item) => pathname.startsWith(item.href));
          return (
            <DropdownMenu key={group.label}>
              <DropdownMenuTrigger
                className={cn(
                  "flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors data-popup-open:text-primary-foreground",
                  isGroupActive
                    ? "border-primary-foreground text-primary-foreground"
                    : "border-transparent text-primary-foreground/70 hover:text-primary-foreground",
                )}
              >
                <group.icon className="h-4 w-4 shrink-0" />
                {group.label}
                <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                sideOffset={2}
                className="min-w-48 bg-popover text-popover-foreground ring-border"
              >
                {group.items.map((item) => {
                  const isActive = pathname.startsWith(item.href);
                  return (
                    <DropdownMenuItem
                      key={item.href}
                      render={
                        <Link
                          href={item.href}
                          className={cn(
                            "text-popover-foreground focus:bg-accent focus:text-accent-foreground",
                            isActive && "bg-accent/60 font-medium",
                          )}
                        />
                      }
                    >
                      <item.icon className="size-4" />
                      {item.label}
                      {item.beta && (
                        <span
                          aria-label="Beta feature"
                          className="ml-auto rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-600"
                        >
                          Beta
                        </span>
                      )}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}

        {visibleSettingsItem ? (
          <Link
            href={visibleSettingsItem.href}
            className={cn(
              "ml-auto flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
              pathname.startsWith(visibleSettingsItem.href)
                ? "border-primary-foreground text-primary-foreground"
                : "border-transparent text-primary-foreground/70 hover:text-primary-foreground",
            )}
          >
            <visibleSettingsItem.icon className="h-4 w-4 shrink-0" />
            {visibleSettingsItem.label}
          </Link>
        ) : null}
      </nav>
    </header>
  );
}
