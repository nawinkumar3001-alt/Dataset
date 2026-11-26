/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { RubricQuestion, SanitizedReviewItem } from '../types';

export interface CodeToken {
  type: 'comment' | 'keyword' | 'literal' | 'plain';
  text: string;
}

const VERILOG_KEYWORDS = new Set([
  'module',
  'endmodule',
  'input',
  'output',
  'inout',
  'wire',
  'reg',
  'logic',
  'bit',
  'byte',
  'shortint',
  'int',
  'longint',
  'integer',
  'time',
  'parameter',
  'localparam',
  'assign',
  'always',
  'always_ff',
  'always_comb',
  'always_latch',
  'initial',
  'begin',
  'end',
  'if',
  'else',
  'case',
  'casex',
  'casez',
  'endcase',
  'default',
  'for',
  'while',
  'repeat',
  'forever',
  'posedge',
  'negedge',
  'or',
  'and',
  'not',
  'xor',
  'nand',
  'nor',
  'xnor',
  'function',
  'endfunction',
  'task',
  'endtask',
  'generate',
  'endgenerate',
  'genvar',
  'typedef',
  'enum',
  'struct',
  'union',
  'packed',
  'signed',
  'unsigned',
]);

/**
 * Splits a raw requirement prompt into main requirement text and module ports section.
 */
export function splitRequirementPrompt(rawPrompt: string): { requirement: string; ports: string } {
  if (!rawPrompt) return { requirement: '', ports: '' };

  let prompt = rawPrompt;
  if (prompt.includes('REQUIREMENT')) {
    const parts = prompt.split('REQUIREMENT');
    prompt = parts.slice(1).join('REQUIREMENT').trim();
  }

  if (prompt.includes('MODULE PORTS')) {
    const parts = prompt.split('MODULE PORTS');
    return {
      requirement: parts[0].trim(),
      ports: ('MODULE PORTS' + parts.slice(1).join('MODULE PORTS')).trim(),
    };
  }

  return { requirement: prompt.trim(), ports: '' };
}

/**
 * Sanitizes a raw JSON item from a review set ZIP.
 * Strictly strips formal_outcome, evidence_logs, and model identity watermarks.
 */
export function sanitizeBlindedItem(
  rawJson: Record<string, unknown>,
  fallbackId: string
): SanitizedReviewItem {
  const reviewId =
    (typeof rawJson.review_id === 'string' && rawJson.review_id.trim()) ||
    (typeof rawJson.id === 'string' && rawJson.id.trim()) ||
    fallbackId;

  const rawPrompt = typeof rawJson.requirement_prompt === 'string' ? rawJson.requirement_prompt : '';
  const { requirement, ports } = splitRequirementPrompt(rawPrompt);
  const explicitPorts =
    typeof rawJson.module_ports === 'string' && rawJson.module_ports.trim()
      ? rawJson.module_ports.trim()
      : ports;

  let modelQuestion: string[] = [];
  if (Array.isArray(rawJson.model_question)) {
    modelQuestion = rawJson.model_question.map((q) => String(q).trim()).filter(Boolean);
  } else if (typeof rawJson.model_question === 'string' && rawJson.model_question.trim()) {
    modelQuestion = [rawJson.model_question.trim()];
  }

  const oracleAnswer = typeof rawJson.oracle_answer === 'string' ? rawJson.oracle_answer.trim() : '';

  let rawCode = typeof rawJson.generated_response === 'string' ? rawJson.generated_response : '';
  rawCode = rawCode
    .replace(/\/\/\s*Author:\s*generated\s*by\s*(ChatGPT|OpenAI|Claude|Anthropic|Gemini)[^\n]*/gi, '// Author: [Blinded]')
    .replace(/\/\*[\s\S]*?(ChatGPT|OpenAI|Claude|Anthropic|Gemini)[\s\S]*?\*\//gi, '/* [Blinded Model Comment] */')
    .replace(/(generated\s*by\s*(ChatGPT|GPT-4|Claude|Gemini))/gi, '[Blinded]');

  const isSystemVerilog =
    /systemverilog/i.test(rawCode) || /logic\s+\[|always_comb|always_ff/i.test(rawCode);

  return {
    id: reviewId,
    requirement_prompt: requirement,
    module_ports: explicitPorts,
    model_question: modelQuestion,
    oracle_answer: oracleAnswer,
    generated_response: rawCode,
    code_language: isSystemVerilog ? 'systemverilog' : 'verilog',
  };
}

/**
 * Determines which rubric questions are automatically 'na' vs active for a given item.
 */
export function getQuestionStatusForItem(
  item: SanitizedReviewItem,
  question: RubricQuestion
): { isAutoNa: boolean; reason: string } {
  const hasQuestion = item.model_question && item.model_question.length > 0;
  const hasOracle = Boolean(item.oracle_answer && item.oracle_answer.trim());

  if (question.autoRule === 'na_if_no_question' && !hasQuestion) {
    return { isAutoNa: true, reason: 'no model question' };
  }
  if (question.autoRule === 'na_if_no_oracle' && !hasOracle) {
    return { isAutoNa: true, reason: 'no oracle answer' };
  }
  return { isAutoNa: false, reason: '' };
}

/**
 * Checks whether an item has all required rubric questions answered.
 */
export function isItemFullyAnswered(
  item: SanitizedReviewItem,
  answers: Record<string, string> | undefined,
  rubric: RubricQuestion[]
): boolean {
  if (!answers) return false;
  for (const q of rubric) {
    const { isAutoNa } = getQuestionStatusForItem(item, q);
    if (isAutoNa) continue;
    if (!answers[q.id] || !answers[q.id].trim()) {
      return false;
    }
  }
  return true;
}

/**
 * Ensures the generated code starts with a markdown fence line like ```verilog if not already present,
 * matching the reference screenshot display where line 1 is ```verilog.
 */
export function formatDisplayCodeLines(code: string, language: 'verilog' | 'systemverilog' = 'verilog'): string[] {
  const trimmed = (code || '').trim();
  if (!trimmed) return ['// (No generated response)'];
  const lines = trimmed.split(/\r?\n/);
  if (lines[0].trim().startsWith('```')) {
    return lines;
  }
  return [`\`\`\`${language}`, ...lines];
}

/**
 * Tokenizes a single line of Verilog/SystemVerilog code for syntax highlighting.
 */
export function tokenizeVerilogLine(line: string): CodeToken[] {
  if (!line) return [{ type: 'plain', text: '' }];

  // Fence line like ```verilog
  if (line.trim().startsWith('```')) {
    return [{ type: 'plain', text: line }];
  }

  // Split off single-line comment //
  const commentIdx = line.indexOf('//');
  const codePart = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
  const commentPart = commentIdx >= 0 ? line.slice(commentIdx) : '';

  const tokens: CodeToken[] = [];
  // Match Verilog literals (e.g. 1'b0, 4'hF, 8'd255), identifiers, or other characters
  const regex = /(\d+'[bBhHdDoO][0-9a-fA-FxXzZ_?]+|\b[a-zA-Z_][a-zA-Z0-9_$]*\b|\b\d+\b|[^a-zA-Z0-9_]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(codePart)) !== null) {
    const word = match[0];
    if (/^\d+'[bBhHdDoO]/.test(word) || /^\d+$/.test(word)) {
      tokens.push({ type: 'literal', text: word });
    } else if (VERILOG_KEYWORDS.has(word)) {
      tokens.push({ type: 'keyword', text: word });
    } else {
      tokens.push({ type: 'plain', text: word });
    }
  }

  if (commentPart) {
    tokens.push({ type: 'comment', text: commentPart });
  }

  return tokens.length > 0 ? tokens : [{ type: 'plain', text: line }];
}
