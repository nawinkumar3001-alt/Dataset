/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Grid,
  Send,
  FileDown,
} from 'lucide-react';
import {
  ItemHeader,
  ReviewerProgress,
  ReviewerToken,
  RubricQuestion,
  SanitizedReviewItem,
} from '../../types.ts';
import {
  fetchDatasetWithItems,
  fetchItemDetails,
  saveReviewAnswers,
  submitFinalReview,
  saveLocalBackup,
} from '../../services/api.ts';
import { ItemPaletteModal } from '../ItemPaletteModal.tsx';
import { QuestionSheetCard } from '../QuestionSheetCard.tsx';
import { exportAllQuestionsToPdf } from '../../utils/documentExporter.ts';
import { isItemFullyAnswered } from '../../utils/reviewLogic.ts';

interface ReviewWorkspaceProps {
  token: string;
  reviewer: ReviewerToken;
  rubric: RubricQuestion[];
  initialItems: ItemHeader[];
  initialProgress: ReviewerProgress;
  onSubmitted: () => void;
  onProgressUpdated: (progress: ReviewerProgress) => void;
  onSaveStateChange: (status: string, isSaving: boolean) => void;
}

export const ReviewWorkspace: React.FC<ReviewWorkspaceProps> = ({
  token,
  rubric,
  initialItems,
  onSubmitted,
  onProgressUpdated,
  onSaveStateChange,
}) => {
  const [itemsList, setItemsList] = useState<ItemHeader[]>(initialItems);
  const [allSanitizedItems, setAllSanitizedItems] = useState<SanitizedReviewItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [currentItem, setCurrentItem] = useState<SanitizedReviewItem | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<string>('');
  const [flagged, setFlagged] = useState<boolean>(false);
  const [isLoadingItem, setIsLoadingItem] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isPaletteOpen, setIsPaletteOpen] = useState<boolean>(false);

  const answerCache = useRef<
    Record<string, { answers: Record<string, string>; notes: string; flagged?: boolean }>
  >({});
  const saveTimeout = useRef<NodeJS.Timeout | null>(null);

  const activeHeader = itemsList[currentIndex];
  const activeItemId = activeHeader?.id;

  const allCompleted = useMemo(() => {
    return itemsList.length > 0 && itemsList.every((it) => it.isComplete);
  }, [itemsList]);

  const completedMap = useMemo(() => {
    const map: Record<string, boolean> = {};
    itemsList.forEach((it) => {
      map[it.id] = it.isComplete;
    });
    return map;
  }, [itemsList]);

  const nextUnansweredIndex = useMemo(() => {
    for (let i = currentIndex + 1; i < itemsList.length; i++) {
      if (!itemsList[i].isComplete) return i;
    }
    for (let i = 0; i < currentIndex; i++) {
      if (!itemsList[i].isComplete) return i;
    }
    return -1;
  }, [itemsList, currentIndex]);

  useEffect(() => {
    fetchDatasetWithItems()
      .then((res) => setAllSanitizedItems(res.items))
      .catch(() => {});
  }, []);

  const loadItem = useCallback(
    async (idx: number) => {
      const targetHeader = itemsList[idx];
      if (!targetHeader) return;

      setIsLoadingItem(true);
      setErrorMessage('');

      try {
        const { item, savedAnswer } = await fetchItemDetails(token, targetHeader.id);
        setCurrentItem(item);

        const cached = answerCache.current[item.id] || savedAnswer;
        const currentAnswers = { ...cached.answers };

        const hasQuestions = item.model_question.length > 0;
        const hasOracle = Boolean(item.oracle_answer);

        if (!hasQuestions) {
          currentAnswers.q1 = 'na';
          currentAnswers.q2 = 'na';
          currentAnswers.q3 = 'na';
        }
        if (!hasOracle) {
          currentAnswers.q4 = 'na';
        }

        setAnswers(currentAnswers);
        setNotes(cached.notes || '');
        setFlagged(Boolean(cached.flagged));
        answerCache.current[item.id] = {
          answers: currentAnswers,
          notes: cached.notes || '',
          flagged: Boolean(cached.flagged),
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMessage(msg);
      } finally {
        setIsLoadingItem(false);
      }
    },
    [itemsList, token]
  );

  useEffect(() => {
    const firstUnanswered = itemsList.findIndex((it) => !it.isComplete);
    const startIdx = firstUnanswered >= 0 ? firstUnanswered : 0;
    setCurrentIndex(startIdx);
    loadItem(startIdx);
  }, [loadItem]); // eslint-disable-line react-hooks/exhaustive-deps

  const triggerAutosave = useCallback(
    (newAnswers: Record<string, string>, newNotes: string, newFlagged: boolean) => {
      if (!activeItemId || !currentItem) return;

      answerCache.current[activeItemId] = {
        answers: newAnswers,
        notes: newNotes,
        flagged: newFlagged,
      };
      saveLocalBackup(token, answerCache.current);

      const nowComplete = isItemFullyAnswered(currentItem, newAnswers, rubric);
      setItemsList((prev) =>
        prev.map((it) =>
          it.id === activeItemId
            ? { ...it, isComplete: nowComplete, hasNotes: Boolean(newNotes), flagged: newFlagged }
            : it
        )
      );

      onSaveStateChange('Saving…', true);

      if (saveTimeout.current) clearTimeout(saveTimeout.current);

      saveTimeout.current = setTimeout(async () => {
        try {
          const res = await saveReviewAnswers(token, {
            [activeItemId]: { answers: newAnswers, notes: newNotes, flagged: newFlagged },
          });

          onProgressUpdated(res.progress);
          const timeStr = new Date().toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          });
          onSaveStateChange(`Saved ✓ ${timeStr}`, false);
        } catch {
          onSaveStateChange('Saved locally', false);
        }
      }, 400);
    },
    [activeItemId, currentItem, rubric, token, onProgressUpdated, onSaveStateChange]
  );

  const handleSelectAnswer = (qId: string, val: string) => {
    const updated = { ...answers, [qId]: val };
    setAnswers(updated);
    triggerAutosave(updated, notes, flagged);
  };

  const handleNotesChange = (val: string) => {
    setNotes(val);
    triggerAutosave(answers, val, flagged);
  };

  const handleToggleFlag = (val: boolean) => {
    setFlagged(val);
    triggerAutosave(answers, notes, val);
  };

  const goToIndex = (newIdx: number) => {
    if (newIdx < 0 || newIdx >= itemsList.length) return;
    setCurrentIndex(newIdx);
    loadItem(newIdx);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleJumpById = (rawId: string) => {
    const norm = rawId.trim().toUpperCase();
    const idx = itemsList.findIndex(
      (it) => it.id.toUpperCase() === norm || it.id.toUpperCase() === `R${norm.padStart(3, '0')}`
    );
    if (idx >= 0) {
      goToIndex(idx);
    }
  };

  const handleSubmit = async () => {
    if (!allCompleted) {
      setErrorMessage('Please answer all required questions before final submission.');
      return;
    }

    setIsSubmitting(true);
    try {
      await submitFinalReview(token);
      onSubmitted();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Submission failed: ${msg}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDownloadAllPdf = () => {
    if (allSanitizedItems.length === 0) return;
    exportAllQuestionsToPdf(
      allSanitizedItems,
      rubric,
      'Blinded_Review_Questions',
      {
        expandModulePorts: false,
        includeMiniGrid: true,
        includeAnswers: true,
        orientation: 'landscape',
      },
      answerCache.current
    );
  };

  return (
    <div className="min-h-[calc(100vh-3.5rem)] pb-24 bg-[#f6f6f3] dark:bg-neutral-950">
      <div className="mx-auto max-w-[1280px] px-4 py-5 space-y-4">
        {/* Top Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-white dark:bg-neutral-900 border border-[#cfcfc9] dark:border-neutral-800 p-3.5">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsPaletteOpen(true)}
              className="flex items-center gap-2 rounded-[10px] border border-[#cfcfc9] dark:border-neutral-700 bg-[#f6f6f3] hover:bg-[#eaeae4] dark:bg-neutral-800 px-3 py-1.5 text-xs font-semibold text-[#1a1a1a] dark:text-neutral-200 cursor-pointer"
            >
              <Grid className="h-4 w-4" />
              <span>Item Palette</span>
            </button>

            <span className="font-mono text-sm font-bold text-[#1a1a1a] dark:text-white">
              {activeItemId} · {currentIndex + 1} / {itemsList.length}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {allSanitizedItems.length > 0 && (
              <button
                type="button"
                onClick={handleDownloadAllPdf}
                className="flex items-center gap-1.5 rounded-[10px] bg-[#1d4ed8] hover:bg-[#1e40af] text-white px-3 py-1.5 text-xs font-semibold cursor-pointer"
              >
                <FileDown className="h-3.5 w-3.5" />
                <span>Download All Questions (PDF)</span>
              </button>
            )}

            <a
              href={`/api/review/${token}/export-csv`}
              download
              className="flex items-center gap-1.5 rounded-[10px] border border-[#cfcfc9] dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-1.5 text-xs font-medium text-[#1a1a1a] dark:text-neutral-200 hover:bg-[#f6f6f3]"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download my CSV</span>
            </a>
          </div>
        </div>

        {errorMessage && (
          <div className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-2.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {errorMessage}
          </div>
        )}

        {/* Question Sheet Card */}
        {isLoadingItem ? (
          <div className="p-12 text-center rounded-[12px] bg-white border border-[#cfcfc9] dark:bg-neutral-900 dark:border-neutral-800">
            <p className="text-xs text-[#55575c]">Loading {activeItemId}…</p>
          </div>
        ) : currentItem ? (
          <QuestionSheetCard
            item={currentItem}
            itemIndex={currentIndex}
            totalItems={itemsList.length}
            completedCount={itemsList.filter((i) => i.isComplete).length}
            allItems={
              allSanitizedItems.length === itemsList.length
                ? itemsList.map(
                    (h) =>
                      allSanitizedItems.find((s) => s.id === h.id) || {
                        id: h.id,
                        requirement_prompt: '',
                        module_ports: '',
                        model_question: [],
                        oracle_answer: '',
                        generated_response: '',
                        code_language: 'verilog',
                      }
                  )
                : allSanitizedItems
            }
            completedMap={completedMap}
            rubric={rubric}
            answers={answers}
            notes={notes}
            flagged={flagged}
            showBenchmark320Grid={true}
            onSelectAnswer={handleSelectAnswer}
            onNotesChange={handleNotesChange}
            onToggleFlag={handleToggleFlag}
            onJumpToItemIndex={goToIndex}
            onJumpToItemId={handleJumpById}
          />
        ) : null}
      </div>

      {/* Bottom Sticky Navigation Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-[#cfcfc9] bg-white/95 backdrop-blur-md dark:border-neutral-800 dark:bg-neutral-900/95 py-2.5 px-4">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => goToIndex(currentIndex - 1)}
            disabled={currentIndex === 0}
            className="flex items-center gap-1 rounded-[10px] border border-[#cfcfc9] px-3.5 py-2 text-xs sm:text-sm font-semibold text-[#1a1a1a] hover:bg-[#f6f6f3] disabled:opacity-40 dark:border-neutral-700 dark:text-neutral-200 min-h-[42px] cursor-pointer"
          >
            <ChevronLeft className="h-4 w-4" />
            <span>Previous</span>
          </button>

          <button
            type="button"
            onClick={() => setIsPaletteOpen(true)}
            className="px-3 py-1.5 rounded-lg hover:bg-[#f6f6f3] dark:hover:bg-neutral-800 text-xs sm:text-sm font-bold text-[#1a1a1a] dark:text-white cursor-pointer"
          >
            {activeItemId} · {currentIndex + 1} / {itemsList.length}
          </button>

          <div className="flex items-center gap-2">
            {nextUnansweredIndex >= 0 && (
              <button
                type="button"
                onClick={() => goToIndex(nextUnansweredIndex)}
                className="hidden sm:flex items-center gap-1 rounded-[10px] border border-[#cfcfc9] px-3 py-2 text-xs font-semibold text-[#1a1a1a] hover:bg-[#f6f6f3] dark:border-neutral-700 dark:text-neutral-200 min-h-[42px] cursor-pointer"
              >
                <span>Next unanswered</span>
              </button>
            )}

            {allCompleted ? (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex items-center gap-1.5 rounded-[10px] bg-[#14733f] hover:bg-emerald-800 text-white px-4 py-2 text-xs sm:text-sm font-semibold min-h-[42px] cursor-pointer"
              >
                <Send className="h-4 w-4" />
                <span>Submit final answers</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => goToIndex(currentIndex + 1)}
                disabled={currentIndex === itemsList.length - 1}
                className="flex items-center gap-1 rounded-[10px] bg-[#1d4ed8] px-4 py-2 text-xs sm:text-sm font-semibold text-white hover:bg-[#1e40af] disabled:opacity-40 min-h-[42px] cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <ItemPaletteModal
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
        items={itemsList}
        currentIndex={currentIndex}
        onSelectItem={(idx) => goToIndex(idx)}
      />
    </div>
  );
};
