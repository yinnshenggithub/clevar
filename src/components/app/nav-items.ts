import { LayoutDashboard, Users, Building2, CircleDollarSign, MessageSquare, Bot, Workflow, Boxes, Settings, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/app", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/app/contacts", label: "Contacts", icon: Users },
  { href: "/app/companies", label: "Companies", icon: Building2 },
  { href: "/app/deals", label: "Deals", icon: CircleDollarSign },
  { href: "/app/inbox", label: "Inbox", icon: MessageSquare },
  { href: "/app/agents", label: "AI Agents", icon: Bot },
  { href: "/app/workflows", label: "Workflows", icon: Workflow },
  { href: "/app/objects", label: "Custom objects", icon: Boxes },
  { href: "/app/settings", label: "Settings", icon: Settings },
];
