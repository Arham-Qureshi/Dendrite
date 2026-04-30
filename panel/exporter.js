'use strict';
const DendriteExporter = (() => {

  function pad(n) { return String(n).padStart(2, '0'); }

  function dateStamp() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function timeStamp() {
    const d = new Date();
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function slugify(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
  }

  function buildConversation(state) {
    const questions = state.questions || [];
    const responses = state.responses || [];
    const codeBlocks = state.codeBlocks || [];
    const links = state.links || [];
    const artifacts = state.artifacts || [];

    const turns = [];
    const maxTurns = Math.max(questions.length, responses.length);

    for (let i = 0; i < maxTurns; i++) {
      turns.push({
        question: questions[i] || null,
        response: responses[i] || null,
      });
    }

    // by matching DOM index order
    const codeMap = {};
    questions.forEach(q => { codeMap[q.id] = []; });

    if (questions.length > 0 && codeBlocks.length > 0) {
      const sorted = [...questions].sort((a, b) => a.index - b.index);
      codeBlocks.forEach(cb => {
        let owner = sorted[0];
        for (const q of sorted) {
          if (q.index <= cb.index) owner = q;
          else break;
        }
        if (owner && codeMap[owner.id]) codeMap[owner.id].push(cb);
      });
    }

    return { turns, codeMap, links, artifacts };
  }
  //build follow up tree like in md file
  function buildTocTree(questions) {
    const roots = [];
    const childMap = {};

    questions.forEach(q => {
      if (q.parentId) {
        (childMap[q.parentId] = childMap[q.parentId] || []).push(q);
      } else {
        roots.push(q);
      }
    });

    const ordered = [];
    function walk(node) {
      ordered.push(node);
      const kids = childMap[node.id];
      if (kids) kids.forEach(walk);
    }
    roots.forEach(walk);

    const seen = new Set(ordered.map(n => n.id));
    questions.forEach(q => { if (!seen.has(q.id)) ordered.push(q); });

    return ordered;
  }

  function generateMarkdown(state) {
    const platform = state.platformName || 'Unknown Platform';
    const date = dateStamp();
    const time = timeStamp();
    const questions = state.questions || [];
    const responses = state.responses || [];
    const codeBlocks = state.codeBlocks || [];
    const links = state.links || [];
    const artifacts = state.artifacts || [];

    const { turns, codeMap } = buildConversation(state);
    const tocOrder = buildTocTree(questions);

    const lines = [];

    lines.push('---');
    lines.push(`title: "Dendrite Dev-Doc"`);
    lines.push(`platform: "${platform}"`);
    lines.push(`date: ${date}`);
    lines.push(`time: ${time}`);
    lines.push(`questions: ${questions.length}`);
    lines.push(`responses: ${responses.length}`);
    lines.push(`code_blocks: ${codeBlocks.length}`);
    lines.push(`links: ${links.length}`);
    lines.push(`artifacts: ${artifacts.length}`);
    lines.push('generator: Dendrite');
    lines.push('---');
    lines.push('');

    lines.push(`# Dendrite Dev-Doc`);
    lines.push('');
    lines.push(`> **Platform:** ${platform}  `);
    lines.push(`> **Exported:** ${date} at ${time}  `);
    lines.push(`> **Stats:** ${questions.length} questions · ${responses.length} responses · ${codeBlocks.length} code blocks · ${links.length} links`);
    lines.push('');

    if (tocOrder.length > 0) {
      lines.push('---');
      lines.push('');
      lines.push('## Table of Contents');
      lines.push('');

      tocOrder.forEach(q => {
        const indent = q.depth > 0 ? '  '.repeat(q.depth) : '';
        const prefix = q.depth > 0 ? `↳ F${q.depth}` : `Q${q.index}`;
        const slug = slugify(q.preview);
        lines.push(`${indent}- [${prefix}. ${q.preview}](#${slug})`);
      });

      if (links.length > 0) lines.push(`- [Referenced Links](#referenced-links)`);
      if (artifacts.length > 0) lines.push(`- [Artifacts](#artifacts)`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');

    turns.forEach((turn, i) => {
      const q = turn.question;
      const r = turn.response;

      if (q) {
        const hLevel = Math.min(2 + (q.depth || 0), 4);
        const hPrefix = '#'.repeat(hLevel);
        const badge = q.depth > 0 ? `F${q.depth}` : `Q${q.index}`;

        lines.push(`${hPrefix} [${badge}] ${q.preview}`);
        lines.push('');

        if (q.fullText && q.fullText.length > q.preview.length + 5) {
          lines.push(`> ${q.fullText.replace(/\n/g, '\n> ')}`);
          lines.push('');
        }
      }

      if (r) {
        lines.push(r.fullText);
        lines.push('');
      }

      if (q) {
        const codes = codeMap[q.id] || [];
        if (codes.length > 0) {
          codes.forEach(cb => {
            const lang = cb.language || '';
            const title = cb.preview || 'Code snippet';

            lines.push(`**${title}**`);
            lines.push('');
            lines.push('```' + lang);
            lines.push(cb.fullText);
            lines.push('```');
            lines.push('');
          });
        }
      }

      if (i < turns.length - 1) {
        lines.push('---');
        lines.push('');
      }
    });

    if (links.length > 0) {
      lines.push('');
      lines.push('---');
      lines.push('');
      lines.push('## Referenced Links');
      lines.push('');

      links.forEach((lnk, i) => {
        lines.push(`${i + 1}. [${lnk.preview}](${lnk.href})`);
      });
      lines.push('');
    }

    if (artifacts.length > 0) {
      lines.push('');
      lines.push('---');
      lines.push('');
      lines.push('## Artifacts');
      lines.push('');

      artifacts.forEach((art, i) => {
        const typeTag = (art.artifactType || 'file').toUpperCase();
        if (art.href) {
          lines.push(`${i + 1}. **[${typeTag}]** [${art.preview}](${art.href})`);
        } else {
          lines.push(`${i + 1}. **[${typeTag}]** ${art.preview}`);
        }
      });
      lines.push('');
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push('*Generated by [Dendrite](https://github.com/Arham-Qureshi/Dentrite) — A neural navigator for your LLM conversations.*');

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

    // cleanup
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
  }

  return {
    exportDevDoc(state) {
      const md = generateMarkdown(state);
      const slug = (state.platformName || 'session').toLowerCase().replace(/\s+/g, '-');
      const filename = `dendrite-${slug}-${dateStamp()}.md`;
      triggerDownload(md, filename);
      return true;
    },

  };

})();