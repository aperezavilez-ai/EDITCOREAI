const test = require("node:test");
const assert = require("node:assert");
const { renderMarkdownSecure, parseMarkdown } = require("../renderer-markdown");

test("MarkdownRenderer: renderiza párrafos separados con etiquetas p", () => {
  const input = "Primer párrafo de explicación.\n\nSegundo párrafo con detalles adicionales.";
  const html = parseMarkdown(input);

  assert.ok(html.includes("<p>Primer párrafo de explicación.</p>"));
  assert.ok(html.includes("<p>Segundo párrafo con detalles adicionales.</p>"));
});

test("MarkdownRenderer: renderiza listas con viñetas y numeradas", () => {
  const input = `
- Elemento uno
- Elemento dos
- Elemento tres

1. Paso primero
2. Paso segundo
`;
  const html = parseMarkdown(input);

  assert.ok(html.includes("<ul>"));
  assert.ok(html.includes("<li>Elemento uno</li>"));
  assert.ok(html.includes("<li>Elemento dos</li>"));
  assert.ok(html.includes("</ul>"));

  assert.ok(html.includes("<ol>"));
  assert.ok(html.includes("<li>Paso primero</li>"));
  assert.ok(html.includes("<li>Paso segundo</li>"));
  assert.ok(html.includes("</ol>"));
});

test("MarkdownRenderer: preserva bloques de código con lenguaje y saltos de línea", () => {
  const input = "```javascript\nfunction hello() {\n  return 'world';\n}\n```";
  const html = parseMarkdown(input);

  assert.ok(html.includes("<pre><code class=\"language-javascript\">"));
  assert.ok(html.includes("function hello() {"));
  assert.ok(html.includes("return &#039;world&#039;;"));
  assert.ok(html.includes("</code></pre>"));
});

test("MarkdownRenderer: renderiza negrita, cursiva y código en línea", () => {
  const input = "Texto con **negrita**, *cursiva* y `variableLocal` en línea.";
  const html = parseMarkdown(input);

  assert.ok(html.includes("<strong>negrita</strong>"));
  assert.ok(html.includes("<em>cursiva</em>"));
  assert.ok(html.includes("<code>variableLocal</code>"));
});

test("MarkdownRenderer: renderiza encabezados h1, h2, h3", () => {
  const input = "# Título 1\n## Subtítulo 2\n### Sección 3";
  const html = parseMarkdown(input);

  assert.ok(html.includes("<h1>Título 1</h1>"));
  assert.ok(html.includes("<h2>Subtítulo 2</h2>"));
  assert.ok(html.includes("<h3>Sección 3</h3>"));
});
