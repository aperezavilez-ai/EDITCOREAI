// Secure Markdown Renderer - renderer-markdown.js
// Este módulo debe cargarse en el contexto del renderer
// Se incluirá en index.html como <script> después de las dependencias

(function() {
  'use strict';

  // Simple markdown parser with STRICT sanitization
  // NO external dependencies needed in renderer context

  const ALLOWED_TAGS = new Set([
    'p', 'br', 'strong', 'em', 'code', 'pre', 'a', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'hr',
    'table', 'thead', 'tbody', 'tr', 'th', 'td'
  ]);

  const ALLOWED_ATTRS = new Map([
    ['a', new Set(['href', 'title'])],
    ['blockquote', new Set(['class'])],
    ['pre', new Set(['class'])],
    ['code', new Set(['class'])],
    ['span', new Set(['class'])],
  ]);

  function escapeHtml(unsafe) {
    return String(unsafe)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function sanitizeUrl(url) {
    const str = String(url || '').trim();
    if (!str) return '#';

    try {
      const parsed = new URL(str, window.location.href);
      if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
        return str;
      }
    } catch (e) {
      // Invalid URL
    }
    return '#';
  }

  function parseTables(html) {
    const lines = html.split('\n');
    let inTable = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line.startsWith('|') && line.endsWith('|')) {
        const cells = line.split('|').slice(1, -1).map(c => c.trim());
        const isSeparator = cells.every(c => /^[:-|-]+$/.test(c) || c === '');
        
        if (isSeparator) {
          lines[i] = '';
          continue;
        }
        
        if (!inTable) {
          inTable = true;
          lines[i] = `<table><thead><tr>${cells.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>`;
        } else {
          lines[i] = `<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`;
        }
      } else {
        if (inTable) {
          inTable = false;
          lines[i] = `</tbody></table>\n${lines[i]}`;
        }
      }
    }
    
    if (inTable) {
      lines.push('</tbody></table>');
    }

    // Conservar las lineas vacias: separan parrafos en el ensamblado de bloques.
    return lines.join('\n');
  }

  // Parser de bloques compacto: listas ajustadas (sin viñetas vacias), parrafos
  // reales en lugar de <br> por cada salto de linea, y codigo protegido de las
  // transformaciones inline. La salida imita la densidad del chat de Claude.
  function applyInline(html) {
    // Bold (**text**) primero para no chocar con la cursiva
    html = html.replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>');
    // Italic: no cruza lineas ni consume marcadores de lista
    html = html.replace(/(^|[^\w*])\*([^\s*][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>');
    html = html.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<em>$2</em>');
    // Links [text](url) - SANITIZADO
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
      const safeUrl = sanitizeUrl(url);
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    });
    return html;
  }

  function parseMarkdown(text) {
    let raw = String(text || '');
    // Auto-fence raw un-fenced JSX/HTML block elements (e.g. <ul className="...">...</ul>)
    if (!raw.includes('```')) {
      raw = raw.replace(/(^|\n)(<(?:ul|ol|div|section|form|table|svg|article|header|footer|nav|button|input|textarea|select|p|h[1-6]|span|li)\b[^>]*[\s\S]*?<\/(?:ul|ol|div|section|form|table|svg|article|header|footer|nav|button|input|textarea|select|p|h[1-6]|span|li)>)(?=\n|$)/gi, (match, p1, codeBlock) => {
        return `${p1}\n\`\`\`jsx\n${codeBlock}\n\`\`\`\n`;
      });
    }

    let html = escapeHtml(raw);

    // 1) Extraer bloques de codigo e inline code ANTES de cualquier transformacion
    const protectedChunks = [];
    const protect = (chunk) => `GAFCHUNK${protectedChunks.push(chunk) - 1}GAFCHUNK`;
    html = html.replace(/```([a-z]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      return protect(`<pre><code class="language-${escapeHtml(lang)}">${code.replace(/\s+$/, '')}</code></pre>`);
    });
    html = html.replace(/`([^`\n]+)`/g, (_, code) => protect(`<code>${code}</code>`));

    // 2) Transformaciones inline (negrita, cursiva, enlaces)
    html = applyInline(html);

    // 3) Tablas (linea a linea)
    html = parseTables(html);

    // 4) Ensamblado de bloques linea a linea
    const lines = html.split('\n');
    const out = [];
    let listType = null; // 'ul' | 'ol'
    let paragraph = [];

    const flushParagraph = () => {
      if (!paragraph.length) return;
      out.push(`<p>${paragraph.join('<br>')}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (!listType) return;
      out.push(listType === 'ul' ? '</ul>' : '</ol>');
      listType = null;
    };
    const openList = (type) => {
      if (listType === type) return;
      closeList();
      out.push(type === 'ul' ? '<ul>' : '<ol>');
      listType = type;
    };

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) { flushParagraph(); closeList(); continue; }

      const header = line.match(/^(#{1,6})\s+(.+)$/);
      if (header) {
        flushParagraph(); closeList();
        const level = Math.min(6, header[1].length);
        out.push(`<h${level}>${header[2]}</h${level}>`);
        continue;
      }
      const alert = line.match(/^&gt;\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.+)$/);
      if (alert) {
        flushParagraph(); closeList();
        out.push(`<blockquote class="markdown-alert markdown-alert-${alert[1]}"><p>${alert[2]}</p></blockquote>`);
        continue;
      }
      const quote = line.match(/^&gt;\s?(.*)$/);
      if (quote) {
        flushParagraph(); closeList();
        out.push(`<blockquote>${quote[1]}</blockquote>`);
        continue;
      }
      if (line === '---' || line === '***') {
        flushParagraph(); closeList();
        out.push('<hr>');
        continue;
      }
      if (/^<(table|thead|tbody|\/?tr|th|td|\/table|\/thead|\/tbody)/.test(line) || /^GAFCHUNK\d+GAFCHUNK$/.test(line)) {
        flushParagraph(); closeList();
        out.push(line);
        continue;
      }
      const bullet = line.match(/^[*-]\s+(.+)$/);
      if (bullet) {
        flushParagraph(); openList('ul');
        out.push(`<li>${bullet[1]}</li>`);
        continue;
      }
      const numbered = line.match(/^\d+[.)]\s+(.+)$/);
      if (numbered) {
        flushParagraph(); openList('ol');
        out.push(`<li>${numbered[1]}</li>`);
        continue;
      }
      // Continuacion de un item de lista (linea indentada bajo el item previo)
      if (listType && /^\s{2,}/.test(rawLine) && out.length && out[out.length - 1].startsWith('<li>')) {
        out[out.length - 1] = `${out[out.length - 1].slice(0, -5)}<br>${line}</li>`;
        continue;
      }
      closeList();
      paragraph.push(line);
    }
    flushParagraph();
    closeList();

    html = out.join('');

    // 5) Restaurar bloques protegidos
    html = html.replace(/GAFCHUNK(\d+)GAFCHUNK/g, (_, index) => protectedChunks[Number(index)] || '');

    return html;
  }

  // Parse HTML string and sanitize tags/attributes
  function sanitizeHtml(htmlString) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlString, 'text/html');

    function sanitizeNode(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        return node.cloneNode();
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const tagName = node.tagName.toLowerCase();

        // Remove disallowed tags
        if (!ALLOWED_TAGS.has(tagName)) {
          const text = document.createTextNode(node.textContent);
          return text;
        }

        // Create sanitized element
        const sanitized = document.createElement(tagName);

        // Copy allowed attributes
        const allowedAttrs = ALLOWED_ATTRS.get(tagName);
        if (allowedAttrs) {
          for (const attr of node.attributes) {
            if (allowedAttrs.has(attr.name)) {
              if (attr.name === 'href') {
                sanitized.setAttribute(attr.name, sanitizeUrl(attr.value));
              } else {
                sanitized.setAttribute(attr.name, attr.value);
              }
            }
          }
        }

        // Recursively sanitize children
        for (const child of node.childNodes) {
          const sanitizedChild = sanitizeNode(child);
          if (sanitizedChild) sanitized.appendChild(sanitizedChild);
        }

        return sanitized;
      }

      return null;
    }

    const sanitized = document.createDocumentFragment();
    for (const child of doc.body.childNodes) {
      const sanitizedChild = sanitizeNode(child);
      if (sanitizedChild) sanitized.appendChild(sanitizedChild);
    }

    const wrapper = document.createElement('div');
    wrapper.appendChild(sanitized);
    return wrapper.innerHTML;
  }

  // Main render function
  function renderMarkdownSecure(text) {
    if (!text || typeof text !== 'string') return '';

    // Step 1: Parse markdown syntax
    const parsed = parseMarkdown(text);

    // Step 2: Sanitize resulting HTML
    const sanitized = sanitizeHtml(parsed);

    return sanitized;
  }

  // Export to global window object
  window.renderMarkdownSecure = renderMarkdownSecure;

})();
