/** Types for the framework-free `siteNav.mjs` single nav source (tsc reads this; runtime uses the .mjs). */

export interface NavItem {
  key: string;
  label: string;
  href: string;
  external?: boolean;
}

export interface Crumb {
  label: string;
  href?: string;
}

export const NAV: NavItem[];
export const FLAME: string;
export const NAV_DEFS: string;
export const navCss: string;

export function esc(s: string): string;
export function brandNavHtml(active?: string): string;
export function appbarHtml(opts?: { active?: string; actions?: 'app' | 'play' | 'none' }): string;
export function tabbarHtml(active?: string): string;
export function footerBrandHtml(): string;
export function footerNavHtml(): string;
export function breadcrumbHtml(trail: Crumb[]): string;
export function injectNavStyles(): void;
