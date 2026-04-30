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

  function dedupeStrings(items, max = 12) {
    const out = [];
    const seen = new Set();
    (items || []).forEach((item) => {
      const s = normalizeText(item);
      if (!s || seen.has(s)) return;
      seen.add(s);
      out.push(s);
    });
    return out.slice(0, max);
  }

  function normalizeResponseRecord(rec) {
    if (!rec) {
      return {
        fullText: '',
        images: [],
        responseLinks: [],
        snippets: [],
      };
    }
    return {
      fullText: normalizeText(rec.fullText || ''),
      images: dedupeStrings(rec.images || [], 10),
      responseLinks: dedupeStrings(rec.responseLinks || [], 10),
      snippets: dedupeStrings(rec.snippets || [], 10),
    };
  }

  function mergeResponseBucket(bucket) {
    const fullTextParts = [];
    const images = [];
    const responseLinks = [];
    const snippets = [];
    const seenImages = new Set();
    const seenLinks = new Set();
    const seenSnippets = new Set();

    (bucket || []).forEach((entry) => {
      const r = normalizeResponseRecord(entry);
      if (r.fullText) fullTextParts.push(r.fullText);
      r.images.forEach((u) => {
        if (!seenImages.has(u)) {
          seenImages.add(u);
          images.push(u);
        }
      });
      r.responseLinks.forEach((u) => {
        if (!seenLinks.has(u)) {
          seenLinks.add(u);
          responseLinks.push(u);
        }
      });
      r.snippets.forEach((s) => {
        if (!seenSnippets.has(s)) {
          seenSnippets.add(s);
          snippets.push(s);
        }
      });
    });

    return {
      fullText: normalizeText(fullTextParts.join('\n\n')),
      images,
      responseLinks,
      snippets,
    };
  }

  function extractTextLines(text, maxLines = 4, maxChars = 520) {
    const clean = squeezeForSummary(text);
    if (!clean) return [];

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

  function toKeyAnswerLines(response, maxLines = 6, maxChars = 720) {
    const r = normalizeResponseRecord(response);
    const lines = [];

    const textBudget = (r.images.length || r.responseLinks.length) ? Math.max(2, maxLines - 2) : maxLines;
    const textLines = extractTextLines(r.fullText, textBudget, maxChars);
    lines.push(...textLines);

    if (!lines.length && r.snippets.length) {
      r.snippets.slice(0, 3).forEach((s) => lines.push(s));
    }

    if (r.images.length) {
      r.images.slice(0, 2).forEach((u) => lines.push(`[Image] ${u}`));
    }

    if (r.responseLinks.length) {
      r.responseLinks.slice(0, 2).forEach((u) => lines.push(`[Link] ${u}`));
    }

    if (!lines.length) return ['(No assistant response captured for this turn)'];

    if (lines.length > maxLines) {
      return [...lines.slice(0, maxLines - 1), '[truncated]'];
    }
    return lines;
  }

  function orderOfNode(node, fallback) {
    const n = Number(node && node.domOrder);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function buildQaRows(state) {
    const questions = [...(state.questions || [])].sort((a, b) => a.index - b.index);
    const responses = [...(state.responses || [])];
    const qMap = {};
    questions.forEach(q => { qMap[q.id] = q; });

    // reliable pairing: bucket assistant responses in the DOM window of each question.
    responses.sort((a, b) => {
      const oa = orderOfNode(a, (a.index || 0) * 2 + 1);
      const ob = orderOfNode(b, (b.index || 0) * 2 + 1);
      return oa - ob;
    });

    const responseOrders = responses.map((r) => orderOfNode(r, (r.index || 0) * 2 + 1));
    const used = new Set();

    return questions.map((q, i) => {
      const qOrder = orderOfNode(q, (q.index || 0) * 2);
      const nextQ = questions[i + 1] || null;
      const nextQOrder = nextQ ? orderOfNode(nextQ, (nextQ.index || 0) * 2) : Number.POSITIVE_INFINITY;
      const bucket = [];

      for (let rIdx = 0; rIdx < responses.length; rIdx++) {
        if (used.has(rIdx)) continue;
        const ro = responseOrders[rIdx];
        if (ro > qOrder && ro < nextQOrder) {
          bucket.push(responses[rIdx]);
          used.add(rIdx);
        }
      }

      // fallback for odd layouts/offsets: nearest unused response after this question
      if (!bucket.length) {
        let bestIdx = -1;
        let bestOrder = Number.POSITIVE_INFINITY;
        for (let rIdx = 0; rIdx < responses.length; rIdx++) {
          if (used.has(rIdx)) continue;
          const ro = responseOrders[rIdx];
          if (ro > qOrder && ro < bestOrder) {
            bestOrder = ro;
            bestIdx = rIdx;
          }
        }
        if (bestIdx >= 0) {
          bucket.push(responses[bestIdx]);
          used.add(bestIdx);
        }
      }

      const parent = q.parentId && qMap[q.parentId] ? qMap[q.parentId] : null;
      return {
        q,
        response: mergeResponseBucket(bucket),
        responseEntries: bucket,
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
      const answerLines = toKeyAnswerLines(row.response);

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
