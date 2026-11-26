/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Upload,
  FileDown,
  FileText,
  FileCode2,
  Printer,
  ChevronLeft,
  ChevronRight,
  Layers,
  CheckCircle2,
  Search,
  FolderArchive,
  RotateCcw,
  Eye,
  BookOpen,
} from 'lucide-react';
import { DatasetSummary, RubricQuestion, SanitizedReviewItem } from '../types.ts';
import {
  fetchDatasetWithItems,
  uploadDatasetZip,
  resetSampleDataset,
} from '../services/api.ts';
import {
  AnswersRecordMap,
  ExportDocumentOptions,
  downloadSampleReviewZip,
  exportAllQuestionsToHtmlDocument,
  exportAllQuestionsToPdf,
  exportAllQuestionsToWordDoc,
  parseZipInBrowser,
} from '../utils/documentExporter.ts';
import { isItemFullyAnswered } from '../utils/reviewLogic.ts';
import { QuestionSheetCard } from './QuestionSheetCard.tsx';

export const ZipDocumentExporterView: React.FC = () => {
  const [dataset, setDataset] = useState<DatasetSummary | null>(null);
  const [items, setItems] = useState<SanitizedReviewItem[]>([]);
  const [rubric, setRubric] = useState<RubricQuestion[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // View mode: 'single' (interactive single question like the screenshot) or 'all' (full document sheet of all questions)
  const [viewMode, setViewMode] = useState<'single' | 'all'>('single');
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Export configuration
  const [expandModulePorts, setExpandModulePorts] = useState<boolean>(false);
  const [show320Grid, setShow320Grid] = useState<boolean>(true);
  const [pdfOrientation, setPdfOrientation] = useState<'landscape' | 'portrait'>('landscape');

  // Local interactive answers map so reviewer/user can click answers & include them in PDF/Doc
  const [answersMap, setAnswersMap] = useState<AnswersRecordMap>(() => {
    try {
      const saved = localStorage.getItem('brp_studio_answers');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [statusBanner, setStatusBanner] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const loadInitialDataset = async () => {
    setIsLoading(true);
    try {
      const data = await fetchDatasetWithItems();
      setDataset(data.dataset);
      setItems(data.items);
      setRubric(data.rubric);
      setCurrentIndex(0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusBanner({ type: 'err', text: `Failed to load review items: ${msg}` });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInitialDataset();
  }, []);

  const persistAnswersMap = (next: AnswersRecordMap) => {
    setAnswersMap(next);
    try {
      localStorage.setItem('brp_studio_answers', JSON.stringify(next));
    } catch {
      // ignore storage quota errors
    }
  };

  // Filtered items when searching in 'all' view or jumping
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.trim().toLowerCase();
    return items.filter(
      (it) =>
        it.id.toLowerCase().includes(q) ||
        it.requirement_prompt.toLowerCase().includes(q) ||
        it.generated_response.toLowerCase().includes(q)
    );
  }, [items, searchQuery]);

  // Completion map
  const completedMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const it of items) {
      map[it.id] = isItemFullyAnswered(it, answersMap[it.id]?.answers, rubric);
    }
    return map;
  }, [items, answersMap, rubric]);

  const completedCount = useMemo(
    () => Object.values(completedMap).filter(Boolean).length,
    [completedMap]
  );

  // Handle ZIP upload (parses in browser AND syncs to server)
  const handleZipUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setStatusBanner({ type: 'err', text: 'Please select a valid .zip archive containing review items.' });
      return;
    }

    setIsUploading(true);
    setStatusBanner(null);

    try {
      // Parse immediately in browser for zero-latency preview
      const browserParsed = await parseZipInBrowser(file);

      // Also upload to backend so Reviewer links & Admin Hub stay synced
      try {
        const serverRes = await uploadDatasetZip(file);
        setDataset(serverRes.dataset);
        setItems(serverRes.items.length > 0 ? serverRes.items : browserParsed.items);
      } catch {
        // Fallback to browser-parsed items if server upload fails on very large archives
        if (browserParsed.items.length === 0) {
          throw new Error('No valid R###.json items found in the uploaded ZIP file.');
        }
        setDataset({
          id: `local_${Date.now()}`,
          name: file.name.replace(/\.zip$/i, ''),
          rawFilename: file.name,
          itemCount: browserParsed.items.length,
          createdAt: Date.now(),
        });
        setItems(browserParsed.items);
      }

      setCurrentIndex(0);
      const count = browserParsed.items.length;
      setStatusBanner({
        type: 'ok',
        text: `Loaded ${count} questions from ${file.name}. Ready to download as a single PDF or Document.`,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusBanner({ type: 'err', text: `Failed to parse ZIP: ${msg}` });
    } finally {
      setIsUploading(false);
    }
  };

  const handleResetDemo = async () => {
    setIsLoading(true);
    try {
      await resetSampleDataset();
      await loadInitialDataset();
      setStatusBanner({
        type: 'ok',
        text: 'Restored default T7 Blinded Hardware Benchmark dataset (including R047).',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusBanner({ type: 'err', text: msg });
    } finally {
      setIsLoading(false);
    }
  };

  const exportOptions: ExportDocumentOptions = {
    expandModulePorts,
    includeMiniGrid: show320Grid,
    includeAnswers: true,
    orientation: pdfOrientation,
  };

  const handleDownloadPdf = () => {
    if (filteredItems.length === 0) return;
    setIsExporting(true);
    setTimeout(() => {
      try {
        const filename = exportAllQuestionsToPdf(
          filteredItems,
          rubric,
          dataset?.name || 'Blinded_Review_Set',
          exportOptions,
          answersMap
        );
        setStatusBanner({
          type: 'ok',
          text: `Generated and downloaded single PDF (${filename}) containing all ${filteredItems.length} questions.`,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatusBanner({ type: 'err', text: `PDF generation error: ${msg}` });
      } finally {
        setIsExporting(false);
      }
    }, 50);
  };

  const handleDownloadWord = () => {
    if (filteredItems.length === 0) return;
    const filename = exportAllQuestionsToWordDoc(
      filteredItems,
      rubric,
      dataset?.name || 'Blinded_Review_Set',
      exportOptions,
      answersMap
    );
    setStatusBanner({
      type: 'ok',
      text: `Downloaded single Word document (${filename}) containing all ${filteredItems.length} questions.`,
    });
  };

  const handleDownloadHtml = () => {
    if (filteredItems.length === 0) return;
    const filename = exportAllQuestionsToHtmlDocument(
      filteredItems,
      rubric,
      dataset?.name || 'Blinded_Review_Set',
      exportOptions,
      answersMap
    );
    setStatusBanner({
      type: 'ok',
      text: `Downloaded standalone HTML document (${filename}) with all ${filteredItems.length} questions.`,
    });
  };

  const handleSelectAnswer = (itemId: string, qId: string, val: string) => {
    const existing = answersMap[itemId] || { answers: {}, notes: '', flagged: false };
    const nextItem = {
      ...existing,
      answers: { ...existing.answers, [qId]: val },
    };
    persistAnswersMap({ ...answersMap, [itemId]: nextItem });
  };

  const handleNotesChange = (itemId: string, notesVal: string) => {
    const existing = answersMap[itemId] || { answers: {}, notes: '', flagged: false };
    persistAnswersMap({
      ...answersMap,
      [itemId]: { ...existing, notes: notesVal },
    });
  };

  const handleToggleFlag = (itemId: string, isFlagged: boolean) => {
    const existing = answersMap[itemId] || { answers: {}, notes: '', flagged: false };
    persistAnswersMap({
      ...answersMap,
      [itemId]: { ...existing, flagged: isFlagged },
    });
  };

  const handleJumpById = (rawId: string) => {
    const normalized = rawId.trim().toUpperCase();
    const foundIdx = items.findIndex(
      (it) =>
        it.id.toUpperCase() === normalized ||
        it.id.toUpperCase() === `R${normalized.padStart(3, '0')}`
    );
    if (foundIdx >= 0) {
      setCurrentIndex(foundIdx);
      setViewMode('single');
    } else {
      const numeric = parseInt(rawId.trim(), 10);
      if (!isNaN(numeric) && numeric >= 1 && numeric <= items.length) {
        setCurrentIndex(numeric - 1);
        setViewMode('single');
      } else {
        setStatusBanner({ type: 'err', text: `Item "${rawId}" not found in the current review set.` });
      }
    }
  };

  const activeItem = items[currentIndex] || items[0];

  return (
    <div className="min-h-[calc(100vh-3.5rem)] bg-[#f6f6f3] dark:bg-neutral-950 pb-16">
      <div className="mx-auto max-w-[1280px] px-4 py-5 space-y-4">
        {/* Top Action Bar: ZIP Upload + Single PDF / Document Export Controls */}
        <section
          aria-label="Upload ZIP and Export All Questions"
          className="no-print rounded-[12px] bg-white dark:bg-neutral-900 border border-[#cfcfc9] dark:border-neutral-800 p-4 sm:p-5 space-y-4"
        >
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-[#e5e5e0] dark:border-neutral-800 pb-4">
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold tracking-tight text-[#1a1a1a] dark:text-white text-balance">
                ZIP Question Set Uploader &amp; Single-Document Exporter
              </h1>
              <p className="text-xs text-[#55575c] dark:text-neutral-400 mt-0.5">
                Upload your review set <code className="font-mono">.zip</code> file (containing{' '}
                <code className="font-mono">items/R###.json</code>) and download all questions in a single PDF or document formatted like the reference sheet below.
              </p>
            </div>

            {/* Primary Export Buttons */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={isExporting || filteredItems.length === 0}
                className="flex items-center gap-2 min-h-[42px] px-4 py-2 rounded-[10px] bg-[#1d4ed8] hover:bg-[#1e40af] text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <FileDown className="h-4 w-4" />
                <span>
                  {isExporting
                    ? 'Generating PDF…'
                    : `Download All ${filteredItems.length} Questions (PDF)`}
                </span>
              </button>

              <button
                type="button"
                onClick={handleDownloadWord}
                disabled={filteredItems.length === 0}
                className="flex items-center gap-1.5 min-h-[42px] px-3.5 py-2 rounded-[10px] border border-[#cfcfc9] dark:border-neutral-700 bg-white hover:bg-[#f6f6f3] dark:bg-neutral-800 dark:hover:bg-neutral-700 text-[#1a1a1a] dark:text-neutral-100 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <FileText className="h-4 w-4 text-[#1d4ed8] dark:text-sky-400" />
                <span>Download Word (.doc)</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadHtml}
                disabled={filteredItems.length === 0}
                className="flex items-center gap-1.5 min-h-[42px] px-3.5 py-2 rounded-[10px] border border-[#cfcfc9] dark:border-neutral-700 bg-white hover:bg-[#f6f6f3] dark:bg-neutral-800 dark:hover:bg-neutral-700 text-[#1a1a1a] dark:text-neutral-100 text-xs sm:text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <FileCode2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                <span>Download HTML Doc</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setViewMode('all');
                  setTimeout(() => window.print(), 150);
                }}
                className="flex items-center gap-1.5 min-h-[42px] px-3 py-2 rounded-[10px] border border-[#cfcfc9] dark:border-neutral-700 bg-[#f6f6f3] hover:bg-[#eaeae4] dark:bg-neutral-800 text-[#1a1a1a] dark:text-neutral-200 text-xs sm:text-sm font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
                title="Print all questions using browser print-to-PDF"
              >
                <Printer className="h-4 w-4" />
                <span className="hidden sm:inline">Print All</span>
              </button>
            </div>
          </div>

          {/* Second Row: Upload ZIP Dropzone + Document Formatting Options */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
            {/* ZIP Upload Box */}
            <div className="lg:col-span-6">
              <input
                id="zip-file-upload-input"
                ref={fileInputRef}
                type="file"
                accept=".zip"
                aria-label="Upload review set ZIP file"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && handleZipUpload(e.target.files[0])}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (e.dataTransfer.files?.[0]) handleZipUpload(e.dataTransfer.files[0]);
                }}
                className="w-full text-left flex items-center justify-between gap-3 rounded-[10px] border-2 border-dashed border-[#cfcfc9] hover:border-[#1d4ed8] dark:border-neutral-700 dark:hover:border-sky-400 bg-[#f6f6f3]/70 dark:bg-neutral-800/40 px-4 py-3 cursor-pointer transition-colors"
              >
                <span className="flex items-center gap-3 min-w-0">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white dark:bg-neutral-800 border border-[#cfcfc9] dark:border-neutral-700 text-[#1d4ed8] dark:text-sky-400">
                    <Upload className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 block">
                    <span className="block text-xs sm:text-sm font-semibold text-[#1a1a1a] dark:text-white truncate">
                      {isUploading
                        ? 'Extracting questions from ZIP…'
                        : 'Upload Review Set ZIP File (or drop .zip here)'}
                    </span>
                    <span className="block text-[11px] text-[#55575c] dark:text-neutral-400 truncate">
                      Active: {dataset?.rawFilename || 'T7_BLINDED_REVIEW_SET.zip'} ·{' '}
                      {items.length} questions loaded · Blinding active
                    </span>
                  </span>
                </span>

                <span className="shrink-0 rounded-lg bg-white dark:bg-neutral-800 border border-[#cfcfc9] dark:border-neutral-700 px-2.5 py-1 text-xs font-semibold text-[#1a1a1a] dark:text-neutral-200">
                  Browse ZIP
                </span>
              </button>
            </div>

            {/* Export Options & Quick Actions */}
            <div className="lg:col-span-6 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex flex-wrap items-center gap-4">
                <label className="inline-flex items-center gap-1.5 text-[#1a1a1a] dark:text-neutral-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={expandModulePorts}
                    onChange={(e) => setExpandModulePorts(e.target.checked)}
                    className="h-4 w-4 rounded border-[#cfcfc9] text-[#1d4ed8]"
                  />
                  <span>Expand module ports in PDF/Doc</span>
                </label>

                <label className="inline-flex items-center gap-1.5 text-[#1a1a1a] dark:text-neutral-200 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={show320Grid}
                    onChange={(e) => setShow320Grid(e.target.checked)}
                    className="h-4 w-4 rounded border-[#cfcfc9] text-[#1d4ed8]"
                  />
                  <span>320-slot progress grid</span>
                </label>

                <div className="flex items-center gap-1 bg-[#f6f6f3] dark:bg-neutral-800 p-0.5 rounded-lg border border-[#cfcfc9] dark:border-neutral-700">
                  <button
                    type="button"
                    onClick={() => setPdfOrientation('landscape')}
                    className={`px-2 py-1 rounded text-[11px] font-medium cursor-pointer ${
                      pdfOrientation === 'landscape'
                        ? 'bg-white dark:bg-neutral-700 text-[#1a1a1a] dark:text-white shadow-2xs'
                        : 'text-[#55575c] dark:text-neutral-400'
                    }`}
                  >
                    2-Col Landscape
                  </button>
                  <button
                    type="button"
                    onClick={() => setPdfOrientation('portrait')}
                    className={`px-2 py-1 rounded text-[11px] font-medium cursor-pointer ${
                      pdfOrientation === 'portrait'
                        ? 'bg-white dark:bg-neutral-700 text-[#1a1a1a] dark:text-white shadow-2xs'
                        : 'text-[#55575c] dark:text-neutral-400'
                    }`}
                  >
                    Portrait
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadSampleReviewZip(items)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-[#1d4ed8] dark:text-sky-400 hover:underline cursor-pointer"
                  title="Download current items as a .zip file to test uploading"
                >
                  <FolderArchive className="h-3.5 w-3.5" />
                  <span>Download Sample .ZIP</span>
                </button>
                <span className="text-neutral-300 dark:text-neutral-700">·</span>
                <button
                  type="button"
                  onClick={handleResetDemo}
                  className="inline-flex items-center gap-1 text-xs text-[#55575c] dark:text-neutral-400 hover:text-[#1a1a1a] dark:hover:text-white cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Reset</span>
                </button>
              </div>
            </div>
          </div>

          {/* Status Message Banner */}
          {statusBanner && (
            <div
              role="status"
              className={`rounded-[10px] border px-3.5 py-2.5 text-xs flex items-center justify-between ${
                statusBanner.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-200'
                  : 'bg-red-50 border-red-200 text-red-900 dark:bg-red-950/40 dark:border-red-800 dark:text-red-200'
              }`}
            >
              <span className="flex items-center gap-2 font-medium">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {statusBanner.text}
              </span>
              <button
                type="button"
                onClick={() => setStatusBanner(null)}
                className="ml-3 font-bold text-sm opacity-70 hover:opacity-100 cursor-pointer"
                aria-label="Dismiss notification"
              >
                ×
              </button>
            </div>
          )}
        </section>

        {/* Preview Toolbar: Toggle Single Question vs All Questions Document Sheet + Item Navigation */}
        <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Mode Switcher */}
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-[10px] bg-white dark:bg-neutral-900 border border-[#cfcfc9] dark:border-neutral-800 p-1">
              <button
                type="button"
                onClick={() => setViewMode('single')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  viewMode === 'single'
                    ? 'bg-[#1a1a1a] text-white dark:bg-white dark:text-neutral-900'
                    : 'text-[#55575c] hover:text-[#1a1a1a] dark:text-neutral-400 dark:hover:text-white'
                }`}
              >
                <Eye className="h-3.5 w-3.5" />
                <span>Single Question View</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('all')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                  viewMode === 'all'
                    ? 'bg-[#1a1a1a] text-white dark:bg-white dark:text-neutral-900'
                    : 'text-[#55575c] hover:text-[#1a1a1a] dark:text-neutral-400 dark:hover:text-white'
                }`}
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span>All {items.length} Questions Document View</span>
              </button>
            </div>

            {viewMode === 'single' && items.length > 1 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                  disabled={currentIndex === 0}
                  className="min-h-[36px] px-2.5 rounded-[8px] border border-[#cfcfc9] dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs font-semibold text-[#1a1a1a] dark:text-neutral-200 disabled:opacity-40 cursor-pointer flex items-center gap-1"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                  <span>Prev</span>
                </button>

                <select
                  aria-label="Select question item"
                  value={currentIndex}
                  onChange={(e) => setCurrentIndex(Number(e.target.value))}
                  className="min-h-[36px] rounded-[8px] border border-[#cfcfc9] dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2.5 text-xs font-semibold text-[#1a1a1a] dark:text-neutral-100"
                >
                  {items.map((it, idx) => (
                    <option key={it.id} value={idx}>
                      {it.id} ({idx + 1} of {items.length})
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => setCurrentIndex(Math.min(items.length - 1, currentIndex + 1))}
                  disabled={currentIndex === items.length - 1}
                  className="min-h-[36px] px-2.5 rounded-[8px] border border-[#cfcfc9] dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs font-semibold text-[#1a1a1a] dark:text-neutral-200 disabled:opacity-40 cursor-pointer flex items-center gap-1"
                >
                  <span>Next</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          {/* Search / Filter input */}
          <div className="relative w-full sm:w-64">
            <Search className="h-3.5 w-3.5 text-[#55575c] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                if (e.target.value.trim() && viewMode === 'single') {
                  setViewMode('all');
                }
              }}
              placeholder="Filter questions (e.g. R047, FIFO)…"
              aria-label="Filter questions"
              className="w-full min-h-[36px] rounded-[8px] border border-[#cfcfc9] dark:border-neutral-800 bg-white dark:bg-neutral-900 pl-8 pr-3 text-xs text-[#1a1a1a] dark:text-neutral-100 placeholder:text-[#55575c]"
            />
          </div>
        </div>

        {/* Main Content Area: Single Question Sheet OR All Questions Compiled Document */}
        {isLoading ? (
          <div className="rounded-[12px] bg-white dark:bg-neutral-900 border border-[#cfcfc9] dark:border-neutral-800 p-12 text-center">
            <p className="text-sm text-[#55575c] dark:text-neutral-400">Loading review set questions…</p>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-[12px] bg-white dark:bg-neutral-900 border border-[#cfcfc9] dark:border-neutral-800 p-12 text-center">
            <p className="text-sm text-[#55575c] dark:text-neutral-400">
              No questions loaded. Upload a review set .zip archive above.
            </p>
          </div>
        ) : viewMode === 'single' && activeItem ? (
          <QuestionSheetCard
            item={activeItem}
            itemIndex={currentIndex}
            totalItems={items.length}
            completedCount={completedCount}
            allItems={items}
            completedMap={completedMap}
            rubric={rubric}
            answers={answersMap[activeItem.id]?.answers || {}}
            notes={answersMap[activeItem.id]?.notes || ''}
            flagged={Boolean(answersMap[activeItem.id]?.flagged)}
            forceExpandPorts={expandModulePorts}
            showBenchmark320Grid={show320Grid}
            onSelectAnswer={(qId, val) => handleSelectAnswer(activeItem.id, qId, val)}
            onNotesChange={(val) => handleNotesChange(activeItem.id, val)}
            onToggleFlag={(fl) => handleToggleFlag(activeItem.id, fl)}
            onJumpToItemIndex={(idx) => setCurrentIndex(idx)}
            onJumpToItemId={handleJumpById}
          />
        ) : (
          <div className="space-y-8">
            <div className="no-print flex items-center justify-between rounded-[10px] bg-white dark:bg-neutral-900 border border-[#cfcfc9] dark:border-neutral-800 px-4 py-2.5 text-xs text-[#55575c] dark:text-neutral-400">
              <span>
                Showing <strong className="text-[#1a1a1a] dark:text-white">{filteredItems.length}</strong> of{' '}
                {items.length} questions in continuous document layout
              </span>
              <button
                type="button"
                onClick={handleDownloadPdf}
                className="font-semibold text-[#1d4ed8] dark:text-sky-400 hover:underline cursor-pointer"
              >
                Download All {filteredItems.length} Questions as Single PDF →
              </button>
            </div>

            {filteredItems.map((it, idx) => (
              <div
                key={it.id}
                className="pb-6 border-b border-dashed border-[#cfcfc9] dark:border-neutral-800 last:border-b-0 print:break-after-page"
              >
                <QuestionSheetCard
                  item={it}
                  itemIndex={idx}
                  totalItems={filteredItems.length}
                  completedCount={completedCount}
                  allItems={filteredItems}
                  completedMap={completedMap}
                  rubric={rubric}
                  answers={answersMap[it.id]?.answers || {}}
                  notes={answersMap[it.id]?.notes || ''}
                  flagged={Boolean(answersMap[it.id]?.flagged)}
                  forceExpandPorts={expandModulePorts}
                  showBenchmark320Grid={show320Grid}
                  onSelectAnswer={(qId, val) => handleSelectAnswer(it.id, qId, val)}
                  onNotesChange={(val) => handleNotesChange(it.id, val)}
                  onToggleFlag={(fl) => handleToggleFlag(it.id, fl)}
                  onJumpToItemIndex={(targetIdx) => {
                    setCurrentIndex(targetIdx);
                    setViewMode('single');
                  }}
                  onJumpToItemId={handleJumpById}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
