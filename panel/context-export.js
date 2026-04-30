'use strict';
const DendriteContextReadmeExporter = (() => {

  // hardcoded migration prompt for handoff to another llm
  const HARD_PROMPT = [
    'You are taking over an ongoing project conversation from another LLM.',
    'Use the MIGRATION CONTEXT as authoritative history.',
    '',
    'Rules:',
    '1. Process all Q/A entries in order.',
    '2. Respect follow-up parent links (Parent: Qx) to preserve reasoning path.',
    '3. Keep existing technical constraints, file paths, and decisions consistent.',
    '4. If any answer is too short for a risky change, ask for clarification first.',
    '5. Start your first reply with: "Migration context loaded."',
  ].join('\n');

  function pad(n) {
    return String(n).padStart(2, '0');
  }

  function dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function timeStamp() {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function slugify(text) {
    return (text || 'session')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'session';
  }

  function normalizeText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function oneLine(text, maxLen) {
    const clean = normalizeText(text).replace(/\s+/g, ' ');
    if (!clean) return '';
    return clean.length <= maxLen ? clean : clean.slice(0, maxLen) + '…';
  }

  function squeezeForSummary(text) {
    // keep answers concise; code blocks overwhelm migration context
    return normalizeText(text).replace(/```[\s\S]*?```/g, '[code omitted]');
  }

  function toKeyAnswerLines(text, maxLines = 4, maxChars = 520) {
    const clean = squeezeForSummary(text);
    if (!clean) return ['(No assistant response captured for this turn)'];

    const directLines = clean
      .split('\n')
      .map(l => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    let candidates = directLines;
    if (candidates.length <= 1) {
      candidates = clean
        .replace(/\n/g, ' ')
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(Boolean);
    }

    const picked = [];
    let usedChars = 0;
    for (const line of candidates) {
      const short = line.length > 180 ? line.slice(0, 180) + '…' : line;
      if (!short) continue;
      if (picked.length >= maxLines) break;
      if (usedChars + short.length > maxChars) break;
      picked.push(short);
      usedChars += short.length;
    }

    if (!picked.length) {
      return [oneLine(clean, 220)];
    }
    if (candidates.length > picked.length) {
      picked.push('[truncated]');
    }
    return picked;
  }

  function buildQaRows(state) {
    const questions = [...(state.questions || [])].sort((a, b) => a.index - b.index);
    const responses = state.responses || [];
    const qMap = {};
    questions.forEach(q => { qMap[q.id] = q; });

    return questions.map((q, i) => {
      const response = responses[q.index - 1] || responses[i] || null;
      const parent = q.parentId && qMap[q.parentId] ? qMap[q.parentId] : null;
      return {
        q,
        response,
        label: `Q${q.index}`,
        parentLabel: parent ? `Q${parent.index}` : 'ROOT',
        depthLabel: q.depth > 0 ? `F${q.depth}` : 'ROOT',
      };
    });
  }

  function generateReadme(state) {
    const platform = state.platformName || 'Unknown Platform';
    const date = dateStamp();
    const time = timeStamp();
    const rows = buildQaRows(state);

    const lines = [];
    lines.push('# Dendrite Migration README');
    lines.push('');
    lines.push('Compact handoff context for continuing this chat in another LLM.');
    lines.push('');
    lines.push('## Paste This Prompt Into Target LLM');
    lines.push('');
    lines.push('```text');
    lines.push(HARD_PROMPT);
    lines.push('```');
    lines.push('');
    lines.push('## Migration Context (Question -> Short Answer)');
    lines.push('');
    lines.push(`- Platform: ${platform}`);
    lines.push(`- Exported: ${date} ${time}`);
    lines.push(`- Total Questions: ${rows.length}`);
    lines.push('');

    if (!rows.length) {
      lines.push('No conversation found.');
      lines.push('');
      return lines.join('\n');
    }

    rows.forEach((row) => {
      const qText = oneLine(row.q.fullText || row.q.preview, 400) || '(empty question)';
      const answerLines = toKeyAnswerLines(row.response ? row.response.fullText : '');

      lines.push(`### ${row.label} (${row.depthLabel})  Parent: ${row.parentLabel}`);
      lines.push('');
      lines.push(`Question: ${qText}`);
      lines.push('');
      lines.push('Answer (key lines):');
      answerLines.forEach(a => lines.push(`- ${a}`));
      lines.push('');
    });

    const latest = rows[rows.length - 1];
    lines.push('## Latest User Intent');
    lines.push('');
    lines.push(oneLine(latest.q.fullText || latest.q.preview, 500) || '(not found)');
    lines.push('');

    return lines.join('\n');
  }

  function triggerDownload(content, filename) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }

  return {
    exportContextReadme(state) {
      const content = generateReadme(state);
      const slug = slugify(state.platformName || 'session');
      const filename = `README-context-${slug}-${dateStamp()}.md`;
      triggerDownload(content, filename);
      return true;
    },
  };

})();
