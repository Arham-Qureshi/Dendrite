'use strict';
const DendriteContextReadmeExporter = (() => {

  //hardcoded context, so we can handoff chats to other llm
  const HARD_PROMPT = [
    'You are taking over this project from another LLM session.',
    'Treat the provided CONTEXT FILE as the source of truth.',
    '',
    'Instructions:',
    '1. Read the entire context file (metadata, graph snapshot, full conversation, code, links, artifacts).',
    '2. Preserve all technical decisions, constraints, naming, and file paths.',
    '3. Continue from the latest unresolved user intent with concrete next steps.',
    '4. If anything is ambiguous, ask focused clarifying questions before changing direction.',
    '5. Start your first reply with: "Migration context loaded."',
    '',
    'Do not discard important technical details from the conversation context.',
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

  function buildConversation(state) {
    const questions = state.questions || [];
    const responses = state.responses || [];
    const codeBlocks = state.codeBlocks || [];
    const turns = [];
    const maxTurns = Math.max(questions.length, responses.length);

    for (let i = 0; i < maxTurns; i++) {
      turns.push({
        question: questions[i] || null,
        response: responses[i] || null,
      });
    }

    const codeMap = {};
    questions.forEach(q => { codeMap[q.id] = []; });

    if (questions.length > 0 && codeBlocks.length > 0) {
      const sortedQuestions = [...questions].sort((a, b) => a.index - b.index);
      codeBlocks.forEach(cb => {
        let owner = sortedQuestions[0];
        for (const q of sortedQuestions) {
          if (q.index <= cb.index) owner = q;
          else break;
        }
        if (owner && codeMap[owner.id]) codeMap[owner.id].push(cb);
      });
    }

    return { turns, codeMap };
  }

  function buildGraphSnapshot(state) {
    const questions = state.questions || [];
    const responses = state.responses || [];
    const codeBlocks = state.codeBlocks || [];
    const links = state.links || [];
    const artifacts = state.artifacts || [];

    const followUpEdges = questions.filter(q => q.parentId).length;
    const turnEdges = Math.min(questions.length, responses.length);
    const nodeCount = questions.length + responses.length + codeBlocks.length + links.length + artifacts.length;
    const edgeCount = followUpEdges + turnEdges;

    return {
      nodeCount,
      edgeCount,
      followUpEdges,
      turnEdges,
    };
  }

  function generateReadme(state) {
    const platform = state.platformName || 'Unknown Platform';
    const date = dateStamp();
    const time = timeStamp();
    const questions = state.questions || [];
    const responses = state.responses || [];
    const codeBlocks = state.codeBlocks || [];
    const links = state.links || [];
    const artifacts = state.artifacts || [];
    const { turns, codeMap } = buildConversation(state);
    const graph = buildGraphSnapshot(state);

    const lines = [];

    //we add the usefull info to user can relate when they migrated.
    lines.push('# Dendrite Migration README');
    lines.push('');
    lines.push('This file is a portable context package for continuing this session in another LLM chat.');
    lines.push('');
    lines.push('## Paste This Prompt Into The Target LLM');
    lines.push('');
    lines.push('```text');
    lines.push(HARD_PROMPT);
    lines.push('```');
    lines.push('');
    lines.push('## Context File');
    lines.push('');
    lines.push('### Session Metadata');
    lines.push(`- Platform: ${platform}`);
    lines.push(`- Exported: ${date} ${time}`);
    lines.push(`- Questions: ${questions.length}`);
    lines.push(`- Responses: ${responses.length}`);
    lines.push(`- Code Blocks: ${codeBlocks.length}`);
    lines.push(`- Links: ${links.length}`);
    lines.push(`- Artifacts: ${artifacts.length}`);
    lines.push('');
    lines.push('### Graph Context Snapshot');
    lines.push(`- Nodes: ${graph.nodeCount}`);
    lines.push(`- Edges: ${graph.edgeCount}`);
    lines.push(`- Follow-up Links: ${graph.followUpEdges}`);
    lines.push(`- Turn Pair Links: ${graph.turnEdges}`);
    lines.push('');
    lines.push('### Optimized Full Conversation Context');
    lines.push('');

    turns.forEach((turn, idx) => {
      lines.push(`#### Turn ${idx + 1}`);
      lines.push('');
      if (turn.question) {
        lines.push('**User**');
        lines.push('');
        lines.push(normalizeText(turn.question.fullText || turn.question.preview));
        lines.push('');
      }

      if (turn.response) {
        lines.push('**Assistant**');
        lines.push('');
        lines.push(normalizeText(turn.response.fullText || turn.response.preview));
        lines.push('');
      }

      if (turn.question) {
        const codes = codeMap[turn.question.id] || [];
        if (codes.length) {
          lines.push('**Code From This Turn**');
          lines.push('');
          codes.forEach((cb, codeIdx) => {
            const lang = cb.language || 'text';
            lines.push(`Code ${codeIdx + 1}: ${cb.preview || 'Snippet'}`);
            lines.push('');
            lines.push('```' + lang);
            lines.push(normalizeText(cb.fullText));
            lines.push('```');
            lines.push('');
          });
        }
      }
    });

    if (links.length) {
      lines.push('### Referenced Links');
      lines.push('');
      links.forEach((lnk, i) => {
        const label = normalizeText(lnk.preview || lnk.href || `Link ${i + 1}`);
        lines.push(`${i + 1}. ${label}`);
        if (lnk.href) lines.push(`   ${lnk.href}`);
      });
      lines.push('');
    }

    if (artifacts.length) {
      lines.push('### Artifacts');
      lines.push('');
      artifacts.forEach((art, i) => {
        const type = (art.artifactType || 'file').toUpperCase();
        const label = normalizeText(art.preview || `Artifact ${i + 1}`);
        lines.push(`${i + 1}. [${type}] ${label}`);
        if (art.href) lines.push(`   ${art.href}`);
      });
      lines.push('');
    }

    lines.push('### Handoff Note');
    lines.push('');
    lines.push('Use this entire file as migration context. Continue from the latest user goal before creating new assumptions.');
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