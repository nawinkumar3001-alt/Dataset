/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Moon, Sun, ArrowLeft, RefreshCw, CheckCircle2 } from 'lucide-react';

export type PortalMainView = 'exporter' | 'reviewer' | 'admin' | 'welcome';

interface NavbarProps {
  currentView: PortalMainView;
  onSwitchView: (view: 'exporter' | 'reviewer' | 'admin') => void;
  reviewerName?: string;
  reviewerEmail?: string;
  itemProgressText?: string;
  saveStatus?: string;
  isSaving?: boolean;
  onExitReview?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentView,
  onSwitchView,
  reviewerName,
  itemProgressText,
  saveStatus,
  isSaving,
  onExitReview,
}) => {
  const [isDark, setIsDark] = React.useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return document.documentElement.classList.contains('dark');
    }
    return false;
  });

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    if (next) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  return (
    <header className="no-print sticky top-0 z-40 w-full border-b border-[#cfcfc9] bg-white/95 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/95 transition-colors">
      <div className="mx-auto flex h-14 max-w-[1280px] items-center justify-between gap-8 px-4">
        {/* Zone 1: Single text element wordmark */}
        <button
          type="button"
          onClick={() => onSwitchView('exporter')}
          className="text-base sm:text-[17px] font-bold tracking-tight text-[#1a1a1a] dark:text-white whitespace-nowrap shrink-0 cursor-pointer text-left"
        >
          Dataset Review
        </button>

        {/* Zone 2: Navigation Links */}
        <nav className="flex items-center gap-5 text-xs sm:text-sm font-medium text-[#55575c] dark:text-neutral-400">
          <button
            type="button"
            onClick={() => onSwitchView('exporter')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              currentView === 'exporter'
                ? 'border-[#1d4ed8] text-[#1a1a1a] font-semibold dark:text-white dark:border-sky-400'
                : 'border-transparent hover:text-[#1a1a1a] dark:hover:text-white'
            }`}
          >
            ZIP to PDF &amp; Doc
          </button>

          <button
            type="button"
            onClick={() => onSwitchView('reviewer')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              currentView === 'reviewer' || currentView === 'welcome'
                ? 'border-[#1d4ed8] text-[#1a1a1a] font-semibold dark:text-white dark:border-sky-400'
                : 'border-transparent hover:text-[#1a1a1a] dark:hover:text-white'
            }`}
          >
            Review Workspace
          </button>

          <button
            type="button"
            onClick={() => onSwitchView('admin')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 cursor-pointer border-b-2 ${
              currentView === 'admin'
                ? 'border-[#1d4ed8] text-[#1a1a1a] font-semibold dark:text-white dark:border-sky-400'
                : 'border-transparent hover:text-[#1a1a1a] dark:hover:text-white'
            }`}
          >
            Admin &amp; Links
          </button>
        </nav>

        {/* Zone 3: Context Status & Theme Toggle */}
        <div className="flex items-center gap-3 shrink-0">
          {currentView === 'reviewer' && (
            <div
              className="hidden md:flex items-center gap-2 text-xs text-[#55575c] dark:text-neutral-400"
              role="status"
              aria-live="polite"
            >
              {reviewerName && (
                <span className="font-medium text-[#1a1a1a] dark:text-white">{reviewerName}</span>
              )}
              {itemProgressText && (
                <span className="tabular-nums text-[#55575c] dark:text-neutral-400">
                  · {itemProgressText}
                </span>
              )}
              {isSaving ? (
                <span className="inline-flex items-center gap-1">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Saving…
                </span>
              ) : saveStatus ? (
                <span className="inline-flex items-center gap-1 text-[#14733f] dark:text-emerald-400">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {saveStatus}
                </span>
              ) : null}
            </div>
          )}

          {currentView === 'reviewer' && onExitReview && (
            <button
              type="button"
              onClick={onExitReview}
              className="hidden lg:flex items-center gap-1 rounded-lg border border-[#cfcfc9] px-2.5 py-1 text-xs font-medium text-[#1a1a1a] hover:bg-[#f6f6f3] dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <ArrowLeft className="h-3 w-3" />
              <span>Reviewer Info</span>
            </button>
          )}

          <button
            type="button"
            onClick={toggleTheme}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#cfcfc9] text-[#55575c] hover:bg-[#f6f6f3] dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800 transition-colors cursor-pointer shrink-0"
            aria-label="Toggle color theme"
          >
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </header>
  );
};
