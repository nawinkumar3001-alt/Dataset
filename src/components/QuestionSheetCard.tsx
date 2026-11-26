/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { RubricQuestion, SanitizedReviewItem } from '../types.ts';
import { formatDisplayCodeLines, tokenizeVerilogLine } from '../utils/reviewLogic.ts';

interface QuestionSheetCardProps {
  item: SanitizedReviewItem;
  itemIndex: number;
  totalItems: number;
  completedCount: number;
  allItems?: SanitizedReviewItem[];
  completedMap?: Record<string, boolean>;
  rubric: RubricQuestion[];
  answers: Record<string, string>;
  notes: string;
  flagged: boolean;
  forceExpandPorts?: boolean;
  showBenchmark320Grid?: boolean;
  onSelectAnswer?: (questionId: string, value: string) => void;
  onNotesChange?: (notes: string) => void;
  onToggleFlag?: (flagged: boolean) => void;
  onJumpToItemIndex?: (index: number) => void;
  onJumpToItemId?: (itemId: string) => void;
}

export const QuestionSheetCard: React.FC<QuestionSheetCardProps> = ({
  item,
  itemIndex,
  totalItems,
  completedCount,
  allItems = [],
  completedMap = {},
  rubric,
  answers,
  notes,
  flagged,
  forceExpandPorts = false,
  showBenchmark320Grid = true,
  onSelectAnswer,
  onNotesChange,
  onToggleFlag,
  onJumpToItemIndex,
  onJumpToItemId,
}) => {
  const [wrapLines, setWrapLines] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [jumpInput, setJumpInput] = useState<string>('');
  const [portsOpen, setPortsOpen] = useState<boolean>(forceExpandPorts);

  const isPortsExpanded = forceExpandPorts || portsOpen;

  const hasModelQuestion = item.model_question && item.model_question.length > 0;
  const hasOracle = Boolean(item.oracle_answer && item.oracle_answer.trim());

  const codeLines = formatDisplayCodeLines(item.generated_response, item.code_language);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(item.generated_response || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = jumpInput.trim();
    if (!trimmed) return;
    if (onJumpToItemId) {
      onJumpToItemId(trimmed);
      setJumpInput('');
    }
  };

  const q1to3 = rubric.filter((q) => q.autoRule === 'na_if_no_question');
  const q4List = rubric.filter((q) => q.autoRule === 'na_if_no_oracle');
  const activeQuestions = rubric.filter(
    (q) => q.autoRule !== 'na_if_no_question' && q.autoRule !== 'na_if_no_oracle'
  );

  // Build grid slots: if dataset has < 320 items and showBenchmark320Grid is true, show 320 slots like the reference screenshot
  const displayTotalSlots = showBenchmark320Grid ? Math.max(totalItems, 320) : totalItems;
  const gridSlots = Array.from({ length: displayTotalSlots }, (_, idx) => {
    const linkedItem = allItems[idx];
    const isCurrent = idx === itemIndex;
    const isDone = linkedItem ? Boolean(completedMap[linkedItem.id]) : false;
    return { idx, linkedItem, isCurrent, isDone };
  });

  const renderQuestionGroup = (q: RubricQuestion) => {
    const selectedVal = answers[q.id] || '';
    return (
      <fieldset key={q.id} className="border-0 m-0 p-0 mb-4">
        <legend className="text-[14px] font-bold text-[#1a1a1a] dark:text-neutral-100 mb-2 leading-snug">
          {q.code} · {q.prompt}
        </legend>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={q.prompt}>
          {q.options.map((opt) => {
            const isSelected = selectedVal === opt;
            return (
              <button
                key={opt}
                type="button"
                role="radio"
                aria-checked={isSelected}
                onClick={() => onSelectAnswer && onSelectAnswer(q.id, opt)}
                className={`min-h-[42px] px-3.5 py-1.5 rounded-[10px] border text-[14px] transition-colors cursor-pointer select-none ${
                  isSelected
                    ? 'bg-[#1d4ed8] text-white border-[#1d4ed8] font-semibold'
                    : 'bg-[#f6f6f3] hover:bg-[#ecece7] text-[#1a1a1a] border-[#cfcfc9] dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-700'
                }`}
              >
                {isSelected ? `✓ ${opt}` : opt}
              </button>
            );
          })}
        </div>
      </fieldset>
    );
  };

  return (
    <article
      className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start print:block"
      data-testid={`question-sheet-${item.id}`}
    >
      {/* Left Column (7 of 12 cols): REQUIREMENT, MODEL QUESTION & ORACLE ANSWER, GENERATED RESPONSE */}
      <div className="lg:col-span-7 space-y-3.5">
        {/* Card 1: REQUIREMENT */}
        <div className="rounded-[12px] bg-white dark:bg-neutral-900 border border-[#cfcfc9] dark:border-neutral-800 p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-[12.5px] font-bold tracking-[0.06em] uppercase text-[#55575c] dark:text-neutral-400 m-0">
              REQUIREMENT
            </h2>
            <span className="font-mono text-xs font-semibold text-[#55575c] dark:text-neutral-400">
              {item.id} · {itemIndex + 1} / {totalItems}
            </span>
          </div>

          <p className="text-[14.5px] leading-[1.55] text-[#1a1a1a] dark:text-neutral-100 whitespace-pre-wrap m-0">
            {item.requirement_prompt}
          </p>

          {item.module_ports && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setPortsOpen(!isPortsExpanded)}
                aria-expanded={isPortsExpanded}
                className="flex items-center gap-1.5 text-[14px] text-[#55575c] hover:text-[#1a1a1a] dark:text-neutral-400 dark:hover:text-white cursor-pointer py-0.5"
              >
                <span className="text-xs">{isPortsExpanded ? '▾' : '▸'}</span>
                <span>Module ports &amp; output rules</span>
              </button>

              {isPortsExpanded && (
                <pre className="mt-2 p-3 rounded-[8px] bg-[#f6f6f3] dark:bg-neutral-950 border border-[#cfcfc9] dark:border-neutral-800 text-[12.5px] font-mono text-[#374151] dark:text-neutral-300 whitespace-pre-wrap overflow-x-auto">
                  {item.module_ports}
                </pre>
              )}
            </div>
          )}
        </div>

        {/* Card 2: MODEL QUESTION & ORACLE ANSWER */}
        <div className="rounded-[12px] bg-white dark:bg-neutral-900 border border-[#cfcfc9] dark:border-neutral-800 p-4">
          <h2 className="text-[12.5px] font-bold tracking-[0.06em] uppercase text-[#55575c] dark:text-neutral-400 mb-2">
            MODEL QUESTION &amp; ORACLE ANSWER
          </h2>

          {hasModelQuestion ? (
            <div className="space-y-2.5">
              <p className="text-[14.5px] leading-[1.55] text-[#1a1a1a] dark:text-neutral-100 whitespace-pre-wrap m-0">
                {item.model_question.join('\n\n')}
              </p>
              <div>
                <div className="text-[13px] font-medium text-[#55575c] dark:text-neutral-400">
                  Oracle answer
                </div>
                <p className="text-[14.5px] leading-[1.55] text-[#1a1a1a] dark:text-neutral-100 whitespace-pre-wrap mt-0.5 m-0">
                  {item.oracle_answer || '(none)'}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-[14.5px] text-[#55575c] dark:text-neutral-400 m-0">
              No model question for this item.
            </p>
          )}
        </div>

        {/* Card 3: GENERATED RESPONSE */}
        <div className="rounded-[12px] bg-white dark:bg-neutral-900 border border-[#cfcfc9] dark:border-neutral-800 p-4">
          <h2 className="text-[12.5px] font-bold tracking-[0.06em] uppercase text-[#55575c] dark:text-neutral-400 mb-2.5">
            GENERATED RESPONSE
          </h2>

          <div className="flex items-center gap-2 mb-3 no-print">
            <button
              type="button"
              onClick={() => setWrapLines(!wrapLines)}
              className={`min-h-[40px] px-3.5 py-1.5 rounded-[10px] border text-[14px] transition-colors cursor-pointer ${
                wrapLines
                  ? 'bg-[#1a1a1a] text-white border-[#1a1a1a] dark:bg-white dark:text-neutral-900'
                  : 'bg-white hover:bg-[#f6f6f3] text-[#1a1a1a] border-[#cfcfc9] dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-200'
              }`}
            >
              Wrap lines
            </button>
            <button
              type="button"
              onClick={handleCopyCode}
              className="min-h-[40px] px-3.5 py-1.5 rounded-[10px] border border-[#cfcfc9] bg-white hover:bg-[#f6f6f3] text-[#1a1a1a] dark:bg-neutral-800 dark:border-neutral-700 dark:text-neutral-200 text-[14px] transition-colors cursor-pointer"
            >
              {copied ? 'Copied ✓' : 'Copy code'}
            </button>
          </div>

          <div
            className="rounded-[8px] bg-[#f6f6f3] dark:bg-neutral-950 border border-[#cfcfc9] dark:border-neutral-800 p-3 overflow-x-auto"
            role="region"
            aria-label={`Generated response code for ${item.id}`}
          >
            <table className="w-full border-collapse font-mono text-[13px] leading-[1.5]">
              <tbody>
                {codeLines.map((lineText, idx) => {
                  const tokens = tokenizeVerilogLine(lineText);
                  return (
                    <tr key={idx}>
                      <td className="select-none pr-3 text-right text-[#76787e] dark:text-neutral-500 align-top w-7">
                        {idx + 1}
                      </td>
                      <td
                        className={`${
                          wrapLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'
                        } text-[#1a1a1a] dark:text-neutral-200`}
                      >
                        {tokens.map((tk, tIdx) => {
                          if (tk.type === 'keyword') {
                            return (
                              <strong
                                key={tIdx}
                                className="font-bold text-[#111827] dark:text-white"
                              >
                                {tk.text}
                              </strong>
                            );
                          }
                          if (tk.type === 'literal') {
                            return (
                              <span
                                key={tIdx}
                                className="text-[#1d4ed8] dark:text-sky-400"
                              >
                                {tk.text}
                              </span>
                            );
                          }
                          if (tk.type === 'comment') {
                            return (
                              <em
                                key={tIdx}
                                className="italic text-[#55575c] dark:text-neutral-400"
                              >
                                {tk.text}
                              </em>
                            );
                          }
                          return <span key={tIdx}>{tk.text}</span>;
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Right Column (5 of 12 cols): Progress + Mini Grid + Q1-Q6 + Flag + Notes + Jump */}
      <div className="lg:col-span-5">
        <div className="rounded-[12px] bg-white dark:bg-neutral-900 border border-[#cfcfc9] dark:border-neutral-800 p-4">
          {/* Progress Counter */}
          <div className="text-[14px] text-[#55575c] dark:text-neutral-400 mb-2">
            {completedCount} of {showBenchmark320Grid ? Math.max(totalItems, 320) : totalItems} complete
          </div>

          {/* Mini Square Matrix matching the screenshot */}
          <div
            className="grid gap-[2px] mb-3.5"
            style={{ gridTemplateColumns: 'repeat(40, minmax(0, 1fr))' }}
            role="group"
            aria-label="Review items progress grid"
          >
            {gridSlots.map((slot) => {
              const clickable = Boolean(slot.linkedItem && onJumpToItemIndex);
              if (!clickable) {
                return (
                  <span
                    key={slot.idx}
                    aria-hidden="true"
                    className={`block h-[10px] w-full rounded-[1.5px] ${
                      slot.isCurrent
                        ? 'ring-2 ring-[#1d4ed8] border border-[#1d4ed8] bg-white dark:bg-neutral-800 z-10'
                        : slot.isDone
                        ? 'bg-[#14733f] border border-[#14733f]'
                        : 'bg-white dark:bg-neutral-900 border border-[#76787e]/70 opacity-80'
                    }`}
                  />
                );
              }
              return (
                <button
                  key={slot.idx}
                  type="button"
                  onClick={() => onJumpToItemIndex && onJumpToItemIndex(slot.idx)}
                  title={`Jump to ${slot.linkedItem!.id} (Item ${slot.idx + 1})`}
                  aria-label={`Jump to ${slot.linkedItem!.id}`}
                  className={`h-[10px] w-full rounded-[1.5px] transition-all p-0 cursor-pointer ${
                    slot.isCurrent
                      ? 'ring-2 ring-[#1d4ed8] border border-[#1d4ed8] bg-white dark:bg-neutral-800 z-10'
                      : slot.isDone
                      ? 'bg-[#14733f] border border-[#14733f]'
                      : 'bg-white dark:bg-neutral-800 border border-[#55575c] hover:border-[#1d4ed8]'
                  }`}
                />
              );
            })}
          </div>

          {/* Q1-Q3 */}
          {!hasModelQuestion && q1to3.length > 0 ? (
            <p className="text-[14px] text-[#55575c] dark:text-neutral-400 mb-3">
              Q1–Q3 are recorded as “na” automatically.
            </p>
          ) : (
            q1to3.map(renderQuestionGroup)
          )}

          {/* Q4 */}
          {!hasOracle && q4List.length > 0 ? (
            <p className="text-[14px] text-[#55575c] dark:text-neutral-400 mb-4">
              Q4 is recorded as “na” (no oracle answer).
            </p>
          ) : (
            q4List.map(renderQuestionGroup)
          )}

          {/* Q5 & Q6 */}
          {activeQuestions.map(renderQuestionGroup)}

          {/* Flag for discussion */}
          <div className="mb-3.5">
            <label className="inline-flex items-center gap-2 text-[14px] text-[#1a1a1a] dark:text-neutral-200 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={flagged}
                onChange={(e) => onToggleFlag && onToggleFlag(e.target.checked)}
                className="h-4 w-4 rounded border-[#cfcfc9] text-[#1d4ed8] focus:ring-[#1d4ed8]"
              />
              <span>Flag for discussion</span>
            </label>
          </div>

          {/* Notes (optional) */}
          <div className="mb-4">
            <label
              htmlFor={`notes-${item.id}`}
              className="block text-[14px] font-bold text-[#1a1a1a] dark:text-neutral-100 mb-1.5"
            >
              Notes (optional)
            </label>
            <textarea
              id={`notes-${item.id}`}
              rows={3}
              value={notes}
              onChange={(e) => onNotesChange && onNotesChange(e.target.value)}
              className="w-full rounded-[10px] border border-[#cfcfc9] dark:border-neutral-700 bg-[#f6f6f3] dark:bg-neutral-800 p-2.5 text-[14px] text-[#1a1a1a] dark:text-neutral-100 focus:outline-2 focus:outline-[#1d4ed8]"
            />
          </div>

          {/* Jump to item */}
          <div>
            <label
              htmlFor={`jump-${item.id}`}
              className="block text-[14px] font-bold text-[#1a1a1a] dark:text-neutral-100 mb-1.5"
            >
              Jump to item
            </label>
            <form onSubmit={handleJumpSubmit} className="flex items-center gap-2">
              <input
                id={`jump-${item.id}`}
                type="text"
                value={jumpInput}
                onChange={(e) => setJumpInput(e.target.value)}
                placeholder={`Go to ${item.id}`}
                className="w-36 min-h-[42px] rounded-[10px] border border-[#cfcfc9] dark:border-neutral-700 bg-[#f6f6f3] dark:bg-neutral-800 px-3 py-1.5 text-[14px] text-[#1a1a1a] dark:text-neutral-100 placeholder:text-[#55575c] dark:placeholder:text-neutral-400 focus:outline-2 focus:outline-[#1d4ed8]"
              />
              {jumpInput.trim() && (
                <button
                  type="submit"
                  className="min-h-[42px] px-3 rounded-[10px] bg-[#1d4ed8] text-white text-xs font-semibold cursor-pointer"
                >
                  Go
                </button>
              )}
            </form>
          </div>
        </div>
      </div>
    </article>
  );
};
