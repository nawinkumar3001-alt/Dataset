/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { RubricQuestion, SanitizedReviewItem } from '../types.ts';
import {
  formatDisplayCodeLines,
  getQuestionStatusForItem,
  isItemFullyAnswered,
  sanitizeBlindedItem,
  tokenizeVerilogLine,
} from './reviewLogic.ts';

export interface ExportDocumentOptions {
  expandModulePorts: boolean;
  includeMiniGrid: boolean;
  includeAnswers: boolean;
  orientation: 'landscape' | 'portrait';
}

export type AnswersRecordMap = Record<
  string,
  { answers: Record<string, string>; notes: string; flagged?: boolean }
>;

function escapeHtml(str: string): string {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Client-side ZIP parser using JSZip so uploaded ZIPs parse immediately in the browser as well.
 */
export async function parseZipInBrowser(file: File): Promise<{
  items: SanitizedReviewItem[];
  warnings: string[];
}> {
  const zip = await JSZip.loadAsync(file);
  const warnings: string[] = [];
  const items: SanitizedReviewItem[] = [];

  const fileNames = Object.keys(zip.files)
    .filter((name) => !zip.files[name].dir && name.toLowerCase().endsWith('.json') && !name.includes('..'))
    .sort((a, b) => {
      const mA = a.match(/R(\d+)\.json$/i);
      const mB = b.match(/R(\d+)\.json$/i);
      if (mA && mB) return parseInt(mA[1], 10) - parseInt(mB[1], 10);
      return a.localeCompare(b);
    });

  for (const name of fileNames) {
    try {
      const rawText = await zip.files[name].async('string');
      const parsed = JSON.parse(rawText);
      // Support either an individual item JSON or an array/bundle JSON
      if (Array.isArray(parsed)) {
        parsed.forEach((entry, idx) => {
          if (entry && typeof entry === 'object') {
            items.push(
              sanitizeBlindedItem(
                entry as Record<string, unknown>,
                `R${String(items.length + idx + 1).padStart(3, '0')}`
              )
            );
          }
        });
      } else if (parsed && typeof parsed === 'object') {
        const fallbackId =
          name.match(/R\d+/i)?.[0]?.toUpperCase() ||
          `R${String(items.length + 1).padStart(3, '0')}`;
        items.push(sanitizeBlindedItem(parsed as Record<string, unknown>, fallbackId));
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Skipped ${name}: ${msg}`);
    }
  }

  return { items, warnings };
}

/**
 * Generates and downloads a real sample .zip archive containing items/R###.json files
 * so the user can test uploading a ZIP or sharing the benchmark archive.
 */
export async function downloadSampleReviewZip(
  items: SanitizedReviewItem[],
  zipFilename = 'T7_BLINDED_REVIEW_SET.zip'
): Promise<void> {
  const zip = new JSZip();
  const folder = zip.folder('items');
  for (const item of items) {
    const rawPayload = {
      review_id: item.id,
      requirement_prompt: item.module_ports
        ? `REQUIREMENT\n${item.requirement_prompt}\n\n${item.module_ports}`
        : `REQUIREMENT\n${item.requirement_prompt}`,
      model_question: item.model_question,
      oracle_answer: item.oracle_answer,
      generated_response: item.generated_response,
    };
    folder?.file(`${item.id}.json`, JSON.stringify(rawPayload, null, 2));
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  triggerBlobDownload(blob, zipFilename);
}

function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/**
 * Renders all questions in a single high-precision vector PDF file matching the screenshot layout.
 * Left column: REQUIREMENT (with Module ports & output rules), MODEL QUESTION & ORACLE ANSWER, GENERATED RESPONSE (line-numbered + Verilog syntax highlighted).
 * Right column: Progress status, mini item grid, Q1–Q6 rubric questions & option pills, Flag for discussion, Notes (optional), Jump to item.
 */
export function exportAllQuestionsToPdf(
  items: SanitizedReviewItem[],
  rubric: RubricQuestion[],
  datasetName: string,
  options: ExportDocumentOptions,
  answersMap: AnswersRecordMap = {}
): string {
  const isLandscape = options.orientation === 'landscape';
  const doc = new jsPDF({
    orientation: isLandscape ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageW = isLandscape ? 297 : 210;
  const pageH = isLandscape ? 210 : 297;
  const margin = 8;

  const totalCompleted = items.filter((it) =>
    isItemFullyAnswered(it, answersMap[it.id]?.answers, rubric)
  ).length;

  items.forEach((item, idx) => {
    if (idx > 0) {
      doc.addPage();
    }

    const saved = options.includeAnswers
      ? answersMap[item.id] || { answers: {}, notes: '', flagged: false }
      : { answers: {}, notes: '', flagged: false };

    // Page background tint (#f8f8f6)
    doc.setFillColor(248, 248, 246);
    doc.rect(0, 0, pageW, pageH, 'F');

    const leftX = margin;
    const leftW = isLandscape ? 168 : pageW - margin * 2;
    const rightX = isLandscape ? leftX + leftW + 5 : margin;
    const rightW = isLandscape ? pageW - rightX - margin : pageW - margin * 2;

    let leftY = margin;

    // -------------------------------------------------------------------------
    // LEFT COLUMN CARD 1: REQUIREMENT
    // -------------------------------------------------------------------------
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const reqLines: string[] = doc.splitTextToSize(
      item.requirement_prompt || '(No requirement specified)',
      leftW - 8
    );

    const portLines: string[] =
      options.expandModulePorts && item.module_ports
        ? doc.splitTextToSize(item.module_ports, leftW - 12)
        : [];

    const reqCardH =
      10 +
      reqLines.length * 3.8 +
      (item.module_ports ? 6 : 0) +
      (portLines.length > 0 ? portLines.length * 3.3 + 4 : 0);

    // Draw Card 1
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(210, 210, 204);
    doc.setLineWidth(0.3);
    doc.roundedRect(leftX, leftY, leftW, reqCardH, 2.5, 2.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(85, 87, 92);
    doc.text('REQUIREMENT', leftX + 4, leftY + 5.5);

    // Item badge on top-right of REQUIREMENT card
    doc.setFont('courier', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);
    doc.text(`${item.id} (${idx + 1} / ${items.length})`, leftX + leftW - 4, leftY + 5.5, {
      align: 'right',
    });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(26, 26, 26);
    doc.text(reqLines, leftX + 4, leftY + 10.5);

    let reqInnerY = leftY + 10.5 + reqLines.length * 3.8;
    if (item.module_ports) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(85, 87, 92);
      const arrowPrefix = options.expandModulePorts ? 'v ' : '> ';
      doc.text(`${arrowPrefix}Module ports & output rules`, leftX + 4, reqInnerY + 2);

      if (portLines.length > 0) {
        doc.setFillColor(246, 246, 243);
        doc.roundedRect(
          leftX + 4,
          reqInnerY + 3.5,
          leftW - 8,
          portLines.length * 3.3 + 3,
          1.5,
          1.5,
          'F'
        );
        doc.setFont('courier', 'normal');
        doc.setFontSize(7.2);
        doc.setTextColor(55, 65, 81);
        doc.text(portLines, leftX + 6, reqInnerY + 6.5);
      }
    }

    leftY += reqCardH + 3.5;

    // -------------------------------------------------------------------------
    // LEFT COLUMN CARD 2: MODEL QUESTION & ORACLE ANSWER
    // -------------------------------------------------------------------------
    const hasQ = item.model_question && item.model_question.length > 0;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);

    const qTextLines: string[] = hasQ
      ? doc.splitTextToSize(item.model_question.join('\n\n'), leftW - 8)
      : ['No model question for this item.'];
    const oracleLines: string[] =
      hasQ && item.oracle_answer
        ? doc.splitTextToSize(`Oracle answer: ${item.oracle_answer}`, leftW - 8)
        : [];

    const mqCardH =
      10 +
      qTextLines.length * 3.8 +
      (oracleLines.length > 0 ? oracleLines.length * 3.8 + 2.5 : 0);

    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(210, 210, 204);
    doc.roundedRect(leftX, leftY, leftW, mqCardH, 2.5, 2.5, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(85, 87, 92);
    doc.text('MODEL QUESTION & ORACLE ANSWER', leftX + 4, leftY + 5.5);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(hasQ ? 26 : 85, hasQ ? 26 : 87, hasQ ? 26 : 92);
    doc.text(qTextLines, leftX + 4, leftY + 10.5);

    if (oracleLines.length > 0) {
      doc.setTextColor(26, 26, 26);
      doc.text(oracleLines, leftX + 4, leftY + 12 + qTextLines.length * 3.8);
    }

    leftY += mqCardH + 3.5;

    // -------------------------------------------------------------------------
    // RIGHT COLUMN: RUBRIC & CONTROLS (drawn on the first page of each item)
    // -------------------------------------------------------------------------
    const drawRightColumn = (startY: number) => {
      const rX = rightX;
      const rW = rightW;
      let curY = startY + 5.5;

      // Measure or draw background card for Right Column
      const cardTopY = startY;
      const maxCardH = pageH - startY - margin;
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(210, 210, 204);
      doc.roundedRect(rX, cardTopY, rW, maxCardH, 2.5, 2.5, 'FD');

      // Completion label
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(55, 65, 81);
      doc.text(`${totalCompleted} of ${items.length} complete`, rX + 4, curY);
      curY += 3;

      // Mini item grid squares (matching screenshot)
      if (options.includeMiniGrid) {
        const maxSquares = Math.min(items.length, 320);
        const cols = 40;
        const sqSize = (rW - 8) / cols;
        const rows = Math.ceil(maxSquares / cols);
        for (let s = 0; s < maxSquares; s++) {
          const r = Math.floor(s / cols);
          const c = s % cols;
          const sx = rX + 4 + c * sqSize;
          const sy = curY + r * (sqSize + 0.4);
          const isCurrent = s === idx;
          const isDone = isItemFullyAnswered(
            items[s],
            answersMap[items[s].id]?.answers,
            rubric
          );
          if (isCurrent) {
            doc.setDrawColor(29, 78, 216);
            doc.setLineWidth(0.45);
          } else {
            doc.setDrawColor(120, 120, 120);
            doc.setLineWidth(0.2);
          }
          if (isDone) {
            doc.setFillColor(20, 115, 63);
            doc.rect(sx, sy, sqSize - 0.5, sqSize - 0.5, 'FD');
          } else {
            doc.setFillColor(255, 255, 255);
            doc.rect(sx, sy, sqSize - 0.5, sqSize - 0.5, 'FD');
          }
        }
        curY += rows * (sqSize + 0.4) + 4;
      } else {
        curY += 2;
      }

      // Q1-Q3 status or pills
      const q1to3 = rubric.filter((q) => q.autoRule === 'na_if_no_question');
      const q4List = rubric.filter((q) => q.autoRule === 'na_if_no_oracle');
      const otherQs = rubric.filter(
        (q) => q.autoRule !== 'na_if_no_question' && q.autoRule !== 'na_if_no_oracle'
      );

      const drawQuestionBlock = (q: RubricQuestion) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(26, 26, 26);
        const titleLines: string[] = doc.splitTextToSize(`${q.code} · ${q.prompt}`, rW - 8);
        doc.text(titleLines, rX + 4, curY);
        curY += titleLines.length * 3.5 + 1;

        // Draw option pills
        let pillX = rX + 4;
        const pillH = 6.2;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.8);

        for (const opt of q.options) {
          const isSelected = saved.answers[q.id] === opt;
          const labelText = isSelected ? `✓ ${opt}` : opt;
          const textW = doc.getTextWidth(labelText);
          const pillW = Math.max(10, textW + 5.5);

          if (pillX + pillW > rX + rW - 4) {
            pillX = rX + 4;
            curY += pillH + 1.5;
          }

          if (isSelected) {
            doc.setFillColor(29, 78, 216);
            doc.setDrawColor(29, 78, 216);
            doc.roundedRect(pillX, curY, pillW, pillH, 1.5, 1.5, 'FD');
            doc.setTextColor(255, 255, 255);
          } else {
            doc.setFillColor(246, 246, 243);
            doc.setDrawColor(207, 207, 201);
            doc.setLineWidth(0.25);
            doc.roundedRect(pillX, curY, pillW, pillH, 1.5, 1.5, 'FD');
            doc.setTextColor(26, 26, 26);
          }

          doc.text(labelText, pillX + pillW / 2, curY + 4.2, { align: 'center' });
          pillX += pillW + 2;
        }
        curY += pillH + 4.2;
      };

      if (!hasQ && q1to3.length > 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(85, 87, 92);
        doc.text('Q1–Q3 are recorded as "na" automatically.', rX + 4, curY);
        curY += 5.5;
      } else {
        q1to3.forEach(drawQuestionBlock);
      }

      const hasOracle = Boolean(item.oracle_answer && item.oracle_answer.trim());
      if (!hasOracle && q4List.length > 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(85, 87, 92);
        doc.text('Q4 is recorded as "na" (no oracle answer).', rX + 4, curY);
        curY += 6;
      } else {
        q4List.forEach(drawQuestionBlock);
      }

      otherQs.forEach(drawQuestionBlock);

      // Flag for discussion checkbox
      doc.setDrawColor(180, 180, 175);
      doc.setFillColor(saved.flagged ? 29 : 255, saved.flagged ? 78 : 255, saved.flagged ? 216 : 255);
      doc.rect(rX + 4, curY - 2.8, 3.2, 3.2, 'FD');
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(26, 26, 26);
      doc.text('Flag for discussion', rX + 9, curY);
      curY += 5.5;

      // Notes (optional)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(26, 26, 26);
      doc.text('Notes (optional)', rX + 4, curY);
      curY += 2;

      const notesBoxH = Math.max(14, Math.min(24, cardTopY + maxCardH - curY - 17));
      doc.setFillColor(246, 246, 243);
      doc.setDrawColor(207, 207, 201);
      doc.roundedRect(rX + 4, curY, rW - 8, notesBoxH, 1.8, 1.8, 'FD');

      if (saved.notes) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(26, 26, 26);
        const noteLines = doc.splitTextToSize(saved.notes, rW - 12);
        doc.text(noteLines.slice(0, 4), rX + 6, curY + 4);
      }
      curY += notesBoxH + 4.5;

      // Jump to item
      if (curY + 10 <= cardTopY + maxCardH) {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(26, 26, 26);
        doc.text('Jump to item', rX + 4, curY);
        curY += 2;

        doc.setFillColor(246, 246, 243);
        doc.setDrawColor(207, 207, 201);
        doc.roundedRect(rX + 4, curY, 28, 7, 1.5, 1.5, 'FD');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.8);
        doc.setTextColor(120, 122, 128);
        doc.text(`Go to ${item.id}`, rX + 7, curY + 4.6);
      }
    };

    if (isLandscape) {
      drawRightColumn(margin);
    }

    // -------------------------------------------------------------------------
    // LEFT COLUMN CARD 3: GENERATED RESPONSE (with line numbers & syntax coloring)
    // -------------------------------------------------------------------------
    const rawCodeLines = formatDisplayCodeLines(item.generated_response, item.code_language);
    const lineH = 3.6;
    const codeMaxChars = isLandscape ? 86 : 95;

    // Expand long lines if needed so nothing clips horizontally
    const numberedLines: { lineNum: number | null; text: string }[] = [];
    rawCodeLines.forEach((lineText, idxLine) => {
      if (lineText.length <= codeMaxChars) {
        numberedLines.push({ lineNum: idxLine + 1, text: lineText });
      } else {
        const chunks: string[] = [];
        for (let i = 0; i < lineText.length; i += codeMaxChars) {
          chunks.push(lineText.slice(i, i + codeMaxChars));
        }
        chunks.forEach((ch, cIdx) => {
          numberedLines.push({ lineNum: cIdx === 0 ? idxLine + 1 : null, text: ch });
        });
      }
    });

    let lineCursor = 0;
    let isFirstCodeCard = true;

    while (lineCursor < numberedLines.length) {
      const availH = pageH - leftY - margin;
      const headerOverhead = isFirstCodeCard ? 19 : 11;
      const maxLinesThisPage = Math.max(5, Math.floor((availH - headerOverhead - 4) / lineH));
      const slice = numberedLines.slice(lineCursor, lineCursor + maxLinesThisPage);
      const codeBoxH = slice.length * lineH + 5;
      const cardH = headerOverhead + codeBoxH + 3;

      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(210, 210, 204);
      doc.setLineWidth(0.3);
      doc.roundedRect(leftX, leftY, leftW, cardH, 2.5, 2.5, 'FD');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(85, 87, 92);
      doc.text(
        isFirstCodeCard ? 'GENERATED RESPONSE' : `GENERATED RESPONSE (${item.id} continued)`,
        leftX + 4,
        leftY + 5.5
      );

      let codeBoxTop = leftY + 8;
      if (isFirstCodeCard) {
        // Draw "Wrap lines" and "Copy code" button pills matching the screenshot
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(207, 207, 201);
        doc.roundedRect(leftX + 4, leftY + 8, 21, 6.2, 1.5, 1.5, 'FD');
        doc.roundedRect(leftX + 27, leftY + 8, 21, 6.2, 1.5, 1.5, 'FD');

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(26, 26, 26);
        doc.text('Wrap lines', leftX + 14.5, leftY + 12.1, { align: 'center' });
        doc.text('Copy code', leftX + 37.5, leftY + 12.1, { align: 'center' });
        codeBoxTop = leftY + 16.5;
      }

      // Inner code box (#f6f6f3)
      doc.setFillColor(246, 246, 243);
      doc.setDrawColor(207, 207, 201);
      doc.roundedRect(leftX + 4, codeBoxTop, leftW - 8, codeBoxH, 1.8, 1.8, 'FD');

      // Render each code line with line number and syntax coloring
      slice.forEach((row, sIdx) => {
        const rowY = codeBoxTop + 4 + sIdx * lineH;
        if (row.lineNum !== null) {
          doc.setFont('courier', 'normal');
          doc.setFontSize(7.3);
          doc.setTextColor(135, 138, 145);
          doc.text(String(row.lineNum).padStart(2, ' '), leftX + 6.5, rowY);
        }

        // Tokenize line for syntax highlighting
        const tokens = tokenizeVerilogLine(row.text);
        let curCodeX = leftX + 13.5;
        tokens.forEach((tk) => {
          if (tk.type === 'keyword') {
            doc.setFont('courier', 'bold');
            doc.setTextColor(17, 24, 39);
          } else if (tk.type === 'literal') {
            doc.setFont('courier', 'normal');
            doc.setTextColor(29, 78, 216);
          } else if (tk.type === 'comment') {
            doc.setFont('courier', 'italic');
            doc.setTextColor(107, 114, 128);
          } else {
            doc.setFont('courier', 'normal');
            doc.setTextColor(26, 26, 26);
          }
          doc.setFontSize(7.3);
          doc.text(tk.text, curCodeX, rowY);
          curCodeX += doc.getTextWidth(tk.text);
        });
      });

      lineCursor += slice.length;
      isFirstCodeCard = false;

      if (lineCursor < numberedLines.length) {
        doc.addPage();
        doc.setFillColor(248, 248, 246);
        doc.rect(0, 0, pageW, pageH, 'F');
        leftY = margin;
      } else {
        leftY += cardH + 4;
      }
    }

    if (!isLandscape) {
      if (leftY + 95 > pageH - margin) {
        doc.addPage();
        doc.setFillColor(248, 248, 246);
        doc.rect(0, 0, pageW, pageH, 'F');
        leftY = margin;
      }
      drawRightColumn(leftY);
    }
  });

  const safeDataset = (datasetName || 'Blinded_Review_Questions')
    .replace(/\s+/g, '_')
    .replace(/[^\w.-]/g, '');
  const filename = `${safeDataset}_All_${items.length}_Questions.pdf`;
  doc.save(filename);
  return filename;
}

/**
 * Generates HTML markup for all questions matching the exact screenshot style.
 * Used for both Standalone HTML export (.html) and Microsoft Word document export (.doc).
 */
export function buildAllQuestionsHtmlMarkup(
  items: SanitizedReviewItem[],
  rubric: RubricQuestion[],
  datasetName: string,
  options: ExportDocumentOptions,
  answersMap: AnswersRecordMap = {},
  forWordDoc = false
): string {
  const totalCompleted = items.filter((it) =>
    isItemFullyAnswered(it, answersMap[it.id]?.answers, rubric)
  ).length;

  const renderSyntaxHighlightedLine = (line: string) => {
    const tokens = tokenizeVerilogLine(line);
    return tokens
      .map((t) => {
        const escaped = escapeHtml(t.text);
        if (t.type === 'keyword') return `<strong style="color:#111827;font-weight:700;">${escaped}</strong>`;
        if (t.type === 'literal') return `<span style="color:#1d4ed8;">${escaped}</span>`;
        if (t.type === 'comment') return `<em style="color:#6b7280;font-style:italic;">${escaped}</em>`;
        return escaped;
      })
      .join('');
  };

  const itemSections = items
    .map((item, idx) => {
      const saved = options.includeAnswers
        ? answersMap[item.id] || { answers: {}, notes: '', flagged: false }
        : { answers: {}, notes: '', flagged: false };

      const hasQ = item.model_question && item.model_question.length > 0;
      const hasOracle = Boolean(item.oracle_answer && item.oracle_answer.trim());
      const codeLines = formatDisplayCodeLines(item.generated_response, item.code_language);

      const codeRowsHtml = codeLines
        .map(
          (ln, lIdx) =>
            `<tr>
              <td style="user-select:none;color:#888a90;text-align:right;padding-right:12px;vertical-align:top;width:28px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;">${
                lIdx + 1
              }</td>
              <td style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;color:#1a1a1a;">${renderSyntaxHighlightedLine(
                ln
              )}</td>
            </tr>`
        )
        .join('');

      const q1to3 = rubric.filter((q) => q.autoRule === 'na_if_no_question');
      const q4List = rubric.filter((q) => q.autoRule === 'na_if_no_oracle');
      const otherQs = rubric.filter(
        (q) => q.autoRule !== 'na_if_no_question' && q.autoRule !== 'na_if_no_oracle'
      );

      const renderRubricQuestionHtml = (q: RubricQuestion) => {
        const pills = q.options
          .map((opt) => {
            const isChecked = saved.answers[q.id] === opt;
            return `<span style="display:inline-block;padding:6px 13px;margin:0 6px 6px 0;border:1px solid ${
              isChecked ? '#1d4ed8' : '#cfcfc9'
            };border-radius:9px;background:${isChecked ? '#1d4ed8' : '#f6f6f3'};color:${
              isChecked ? '#ffffff' : '#1a1a1a'
            };font-size:13px;font-weight:${isChecked ? '600' : '400'};">${
              isChecked ? '✓ ' : ''
            }${escapeHtml(opt)}</span>`;
          })
          .join('');

        return `<div style="margin-bottom:14px;">
          <div style="font-weight:700;font-size:13.5px;color:#1a1a1a;margin-bottom:6px;">${escapeHtml(
            q.code
          )} · ${escapeHtml(q.prompt)}</div>
          <div>${pills}</div>
        </div>`;
      };

      const miniGridHtml = options.includeMiniGrid
        ? `<div style="display:flex;flex-wrap:wrap;gap:2px;margin:8px 0 14px 0;">
            ${items
              .slice(0, 320)
              .map((it, sIdx) => {
                const isCur = sIdx === idx;
                return `<span style="display:inline-block;width:7px;height:7px;border:${
                  isCur ? '2px solid #1d4ed8' : '1px solid #6b7280'
                };border-radius:1px;background:#ffffff;"></span>`;
              })
              .join('')}
          </div>`
        : '';

      return `
        <section class="question-page" style="page-break-after:always;break-after:page;margin-bottom:28px;">
          <table style="width:100%;border-collapse:separate;border-spacing:14px 0;vertical-align:top;">
            <tr>
              <td style="width:60%;vertical-align:top;">
                <!-- Card 1: REQUIREMENT -->
                <div style="background:#ffffff;border:1px solid #cfcfc9;border-radius:12px;padding:16px;margin-bottom:14px;">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#55575c;">REQUIREMENT</span>
                    <span style="font-size:12px;font-family:monospace;font-weight:600;color:#55575c;">${escapeHtml(
                      item.id
                    )} (${idx + 1} / ${items.length})</span>
                  </div>
                  <p style="margin:0 0 10px 0;font-size:14px;line-height:1.55;color:#1a1a1a;white-space:pre-wrap;">${escapeHtml(
                    item.requirement_prompt
                  )}</p>
                  ${
                    item.module_ports
                      ? options.expandModulePorts
                        ? `<div style="margin-top:8px;">
                             <div style="font-size:13px;color:#55575c;margin-bottom:6px;">▾ Module ports &amp; output rules</div>
                             <pre style="margin:0;padding:10px;background:#f6f6f3;border:1px solid #cfcfc9;border-radius:8px;font-size:12px;white-space:pre-wrap;color:#374151;">${escapeHtml(
                               item.module_ports
                             )}</pre>
                           </div>`
                        : `<div style="font-size:13px;color:#55575c;margin-top:6px;">▸ Module ports &amp; output rules</div>`
                      : ''
                  }
                </div>

                <!-- Card 2: MODEL QUESTION & ORACLE ANSWER -->
                <div style="background:#ffffff;border:1px solid #cfcfc9;border-radius:12px;padding:16px;margin-bottom:14px;">
                  <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#55575c;margin-bottom:8px;">MODEL QUESTION &amp; ORACLE ANSWER</div>
                  ${
                    hasQ
                      ? `<p style="margin:0 0 8px 0;font-size:14px;color:#1a1a1a;white-space:pre-wrap;">${escapeHtml(
                          item.model_question.join('\n\n')
                        )}</p>
                         <div style="font-size:12.5px;color:#55575c;margin-top:6px;">Oracle answer</div>
                         <p style="margin:2px 0 0 0;font-size:14px;color:#1a1a1a;white-space:pre-wrap;">${escapeHtml(
                           item.oracle_answer || '(none)'
                         )}</p>`
                      : `<p style="margin:0;font-size:14px;color:#55575c;">No model question for this item.</p>`
                  }
                </div>

                <!-- Card 3: GENERATED RESPONSE -->
                <div style="background:#ffffff;border:1px solid #cfcfc9;border-radius:12px;padding:16px;">
                  <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#55575c;margin-bottom:10px;">GENERATED RESPONSE</div>
                  <div style="margin-bottom:10px;">
                    <span style="display:inline-block;padding:6px 12px;border:1px solid #cfcfc9;border-radius:9px;background:#ffffff;font-size:13px;margin-right:6px;">Wrap lines</span>
                    <span style="display:inline-block;padding:6px 12px;border:1px solid #cfcfc9;border-radius:9px;background:#ffffff;font-size:13px;">Copy code</span>
                  </div>
                  <div style="background:#f6f6f3;border:1px solid #cfcfc9;border-radius:8px;padding:10px;">
                    <table style="width:100%;border-collapse:collapse;">
                      ${codeRowsHtml}
                    </table>
                  </div>
                </div>
              </td>

              <td style="width:40%;vertical-align:top;">
                <div style="background:#ffffff;border:1px solid #cfcfc9;border-radius:12px;padding:16px;">
                  <div style="font-size:13.5px;color:#55575c;margin-bottom:6px;">${totalCompleted} of ${
        items.length
      } complete</div>
                  ${miniGridHtml}
                  ${
                    !hasQ && q1to3.length > 0
                      ? `<p style="margin:0 0 12px 0;font-size:13.5px;color:#55575c;">Q1–Q3 are recorded as “na” automatically.</p>`
                      : q1to3.map(renderRubricQuestionHtml).join('')
                  }
                  ${
                    !hasOracle && q4List.length > 0
                      ? `<p style="margin:0 0 14px 0;font-size:13.5px;color:#55575c;">Q4 is recorded as “na” (no oracle answer).</p>`
                      : q4List.map(renderRubricQuestionHtml).join('')
                  }
                  ${otherQs.map(renderRubricQuestionHtml).join('')}

                  <div style="margin:10px 0 14px 0;font-size:13.5px;color:#1a1a1a;">
                    <span style="display:inline-block;width:13px;height:13px;border:1px solid #9ca3af;border-radius:3px;margin-right:6px;vertical-align:middle;text-align:center;line-height:12px;font-size:10px;">${
                      saved.flagged ? '✓' : ''
                    }</span>
                    Flag for discussion
                  </div>

                  <div style="font-weight:700;font-size:13.5px;color:#1a1a1a;margin-bottom:6px;">Notes (optional)</div>
                  <div style="min-height:64px;border:1px solid #cfcfc9;border-radius:9px;background:#f6f6f3;padding:8px;font-size:13px;color:#1a1a1a;margin-bottom:14px;white-space:pre-wrap;">${escapeHtml(
                    saved.notes || ''
                  )}</div>

                  <div style="font-weight:700;font-size:13.5px;color:#1a1a1a;margin-bottom:6px;">Jump to item</div>
                  <div style="display:inline-block;padding:8px 14px;border:1px solid #cfcfc9;border-radius:9px;background:#f6f6f3;color:#71717a;font-size:13.5px;">Go to ${escapeHtml(
                    item.id
                  )}</div>
                </div>
              </td>
            </tr>
          </table>
        </section>
      `;
    })
    .join('\n');

  const toolbarHtml = forWordDoc
    ? ''
    : `<div class="no-print" style="position:sticky;top:0;z-index:20;background:#18181b;color:#ffffff;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;font-family:system-ui,sans-serif;">
        <div>
          <strong>${escapeHtml(datasetName)}</strong> · All ${items.length} Questions Document
        </div>
        <button onclick="window.print()" style="background:#2563eb;color:#ffffff;border:0;padding:8px 16px;border-radius:8px;font-weight:600;cursor:pointer;">
          Print / Save as PDF
        </button>
      </div>`;

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(datasetName)} - All ${items.length} Questions</title>
  <style>
    @page { size: landscape; margin: 10mm; }
    body {
      margin: 0;
      padding: 0;
      background: #f6f6f3;
      color: #1a1a1a;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .container {
      max-width: 1280px;
      margin: 0 auto;
      padding: 20px;
    }
    @media print {
      .no-print { display: none !important; }
      body { background: #ffffff; }
      .container { max-width: 100%; padding: 0; }
      .question-page { page-break-after: always; break-after: page; }
    }
  </style>
</head>
<body>
  ${toolbarHtml}
  <div class="container">
    ${itemSections}
  </div>
</body>
</html>`;
}

/**
 * Exports all questions into a single Microsoft Word (.doc) document file.
 */
export function exportAllQuestionsToWordDoc(
  items: SanitizedReviewItem[],
  rubric: RubricQuestion[],
  datasetName: string,
  options: ExportDocumentOptions,
  answersMap: AnswersRecordMap = {}
): string {
  const htmlContent = buildAllQuestionsHtmlMarkup(
    items,
    rubric,
    datasetName,
    options,
    answersMap,
    true
  );
  const blob = new Blob(['\ufeff', htmlContent], {
    type: 'application/msword;charset=utf-8',
  });
  const safeDataset = (datasetName || 'Blinded_Review_Questions')
    .replace(/\s+/g, '_')
    .replace(/[^\w.-]/g, '');
  const filename = `${safeDataset}_All_${items.length}_Questions.doc`;
  triggerBlobDownload(blob, filename);
  return filename;
}

/**
 * Exports all questions into a single standalone printable HTML document (.html).
 */
export function exportAllQuestionsToHtmlDocument(
  items: SanitizedReviewItem[],
  rubric: RubricQuestion[],
  datasetName: string,
  options: ExportDocumentOptions,
  answersMap: AnswersRecordMap = {}
): string {
  const htmlContent = buildAllQuestionsHtmlMarkup(
    items,
    rubric,
    datasetName,
    options,
    answersMap,
    false
  );
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const safeDataset = (datasetName || 'Blinded_Review_Questions')
    .replace(/\s+/g, '_')
    .replace(/[^\w.-]/g, '');
  const filename = `${safeDataset}_All_${items.length}_Questions.html`;
  triggerBlobDownload(blob, filename);
  return filename;
}
