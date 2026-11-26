/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar.tsx';
import { ZipDocumentExporterView } from './components/ZipDocumentExporterView.tsx';
import { AdminDashboard } from './components/admin/AdminDashboard.tsx';
import { ReviewerWelcome } from './components/reviewer/ReviewerWelcome.tsx';
import { ReviewWorkspace } from './components/reviewer/ReviewWorkspace.tsx';
import { ReviewCompleted } from './components/reviewer/ReviewCompleted.tsx';
import {
  fetchReviewSession,
  registerReviewer,
  fetchReviewItemsList,
  fetchTokens,
  generateTokens,
} from './services/api.ts';
import { ItemHeader, ReviewerProgress, ReviewerToken, RubricQuestion, DatasetSummary } from './types.ts';
import { ShieldAlert } from 'lucide-react';

export default function App() {
  const [currentView, setCurrentView] = useState<'exporter' | 'admin' | 'reviewer' | 'welcome' | 'completed'>('exporter');
  const [activeToken, setActiveToken] = useState<string | null>(null);

  // Reviewer session state
  const [reviewer, setReviewer] = useState<ReviewerToken | null>(null);
  const [dataset, setDataset] = useState<DatasetSummary | null>(null);
  const [rubric, setRubric] = useState<RubricQuestion[]>([]);
  const [progress, setProgress] = useState<ReviewerProgress>({ completed: 0, total: 0, percentage: 0 });
  const [itemsList, setItemsList] = useState<ItemHeader[]>([]);

  // UI status
  const [isLoadingSession, setIsLoadingSession] = useState<boolean>(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  const loadReviewerSession = useCallback(async (token: string) => {
    setIsLoadingSession(true);
    setSessionError(null);

    try {
      const sessionData = await fetchReviewSession(token);
      setReviewer(sessionData.reviewer);
      setDataset(sessionData.dataset);
      setRubric(sessionData.rubric);
      setProgress(sessionData.progress);

      if (sessionData.reviewer.status === 'submitted') {
        setCurrentView('completed');
      } else if (!sessionData.reviewer.name || !sessionData.reviewer.email) {
        setCurrentView('welcome');
      } else {
        const itemsRes = await fetchReviewItemsList(token);
        setItemsList(itemsRes.items);
        setCurrentView('reviewer');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSessionError(msg);
      setCurrentView('welcome');
    } finally {
      setIsLoadingSession(false);
    }
  }, []);

  // Parse token from query string or path on initial mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get('token');
    const viewParam = params.get('view');

    const pathMatch = window.location.pathname.match(/\/review\/([a-zA-Z0-9_-]+)/);
    const pathToken = pathMatch ? pathMatch[1] : null;

    const detectedToken = tokenParam || pathToken;

    if (detectedToken) {
      setActiveToken(detectedToken);
      loadReviewerSession(detectedToken);
    } else if (viewParam === 'admin' || window.location.pathname === '/admin') {
      setCurrentView('admin');
    } else {
      setCurrentView('exporter');
    }
  }, [loadReviewerSession]);

  // Handler when reviewer submits details on Welcome screen
  const handleStartReview = async (name: string, email: string, affiliation?: string) => {
    if (!activeToken) return;
    setIsLoadingSession(true);
    try {
      const updatedReviewer = await registerReviewer(activeToken, name, email, affiliation);
      setReviewer(updatedReviewer);

      const itemsRes = await fetchReviewItemsList(activeToken);
      setItemsList(itemsRes.items);
      setProgress(itemsRes.progress);
      setCurrentView('reviewer');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSessionError(msg);
    } finally {
      setIsLoadingSession(false);
    }
  };

  // Switch between views
  const handleSwitchView = async (targetView: 'exporter' | 'admin' | 'reviewer') => {
    setSessionError(null);
    if (targetView === 'exporter') {
      setCurrentView('exporter');
      return;
    }
    if (targetView === 'admin') {
      setCurrentView('admin');
      return;
    }

    // Switching to Reviewer Workspace
    if (activeToken) {
      loadReviewerSession(activeToken);
      return;
    }

    try {
      setIsLoadingSession(true);
      const tokens = await fetchTokens();
      let tokenToUse = tokens[0]?.token;

      if (!tokenToUse) {
        const generated = await generateTokens(1, ['Lead Reviewer'], ['reviewer@study.org']);
        tokenToUse = generated[0].token;
      }

      setActiveToken(tokenToUse);
      loadReviewerSession(tokenToUse);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setSessionError(msg);
    } finally {
      setIsLoadingSession(false);
    }
  };

  const handleOpenReviewerFromAdmin = (token: string) => {
    setActiveToken(token);
    loadReviewerSession(token);
  };

  return (
    <div className="min-h-screen bg-[#f6f6f3] dark:bg-neutral-950 text-[#1a1a1a] dark:text-neutral-100 flex flex-col font-sans transition-colors">
      <Navbar
        currentView={currentView === 'completed' ? 'reviewer' : currentView}
        onSwitchView={handleSwitchView}
        reviewerName={reviewer?.name}
        reviewerEmail={reviewer?.email}
        itemProgressText={
          currentView === 'reviewer' && progress.total > 0
            ? `${progress.completed}/${progress.total} complete`
            : undefined
        }
        saveStatus={saveStatus}
        isSaving={isSaving}
        onExitReview={() => setCurrentView('welcome')}
      />

      <main className="flex-1">
        {isLoadingSession ? (
          <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center p-6">
            <div className="text-center space-y-3">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-3 border-neutral-900 border-t-transparent dark:border-white"></div>
              <p className="text-sm font-medium text-neutral-600 dark:text-neutral-400">
                Loading review session…
              </p>
            </div>
          </div>
        ) : sessionError ? (
          <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center p-6">
            <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center border border-red-200 dark:bg-neutral-900 dark:border-red-900/50 shadow-sm">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-100 text-red-600 dark:bg-red-950 dark:text-red-400 mb-4">
                <ShieldAlert className="h-6 w-6" />
              </div>
              <h2 className="text-lg font-bold text-neutral-900 dark:text-white">
                Unable to Open Review Session
              </h2>
              <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">
                {sessionError}
              </p>
              <div className="mt-6 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setSessionError(null);
                    setCurrentView('exporter');
                  }}
                  className="rounded-xl bg-[#1d4ed8] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1e40af] cursor-pointer"
                >
                  Open ZIP to PDF Exporter
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSessionError(null);
                    setCurrentView('admin');
                  }}
                  className="rounded-xl border border-neutral-300 px-4 py-2 text-xs font-semibold text-neutral-800 dark:border-neutral-700 dark:text-neutral-200 cursor-pointer"
                >
                  Admin Hub
                </button>
              </div>
            </div>
          </div>
        ) : currentView === 'exporter' ? (
          <ZipDocumentExporterView />
        ) : currentView === 'admin' ? (
          <AdminDashboard onOpenReviewerWorkspace={handleOpenReviewerFromAdmin} />
        ) : currentView === 'welcome' && reviewer && dataset ? (
          <ReviewerWelcome
            reviewer={reviewer}
            dataset={dataset}
            progress={progress}
            onStartReview={handleStartReview}
            isLoading={isLoadingSession}
            errorMessage={sessionError || undefined}
          />
        ) : currentView === 'completed' && reviewer ? (
          <ReviewCompleted
            reviewer={reviewer}
            progress={progress}
            token={activeToken!}
            onBackToAnswers={async () => {
              if (activeToken) {
                const itemsRes = await fetchReviewItemsList(activeToken);
                setItemsList(itemsRes.items);
                setCurrentView('reviewer');
              }
            }}
          />
        ) : currentView === 'reviewer' && reviewer && activeToken ? (
          <ReviewWorkspace
            token={activeToken}
            reviewer={reviewer}
            rubric={rubric}
            initialItems={itemsList}
            initialProgress={progress}
            onSubmitted={() => setCurrentView('completed')}
            onProgressUpdated={(newProg) => setProgress(newProg)}
            onSaveStateChange={(st, saving) => {
              setSaveStatus(st);
              setIsSaving(saving);
            }}
          />
        ) : null}
      </main>
    </div>
  );
}
