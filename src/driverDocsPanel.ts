import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

interface DocPage {
  id: string;
  title: string;
  file: string;
  html: string;
  headings: Array<{ id: string; title: string; level: number }>;
}

export class DriverDocsPanel {
  private static currentPanel: DriverDocsPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private docsRoot: string;
  private disposables: vscode.Disposable[] = [];

  static async show(extensionUri: vscode.Uri, docsRoot: string): Promise<void> {
    const column = vscode.window.activeTextEditor?.viewColumn || vscode.ViewColumn.One;

    if (DriverDocsPanel.currentPanel) {
      DriverDocsPanel.currentPanel.panel.reveal(column);
      DriverDocsPanel.currentPanel.docsRoot = docsRoot;
      DriverDocsPanel.currentPanel.render();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'zebraDriverDocs',
      'Zebra Driver Docs',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    );

    DriverDocsPanel.currentPanel = new DriverDocsPanel(panel, docsRoot);
    DriverDocsPanel.currentPanel.render();
  }

  private constructor(panel: vscode.WebviewPanel, docsRoot: string) {
    this.panel = panel;
    this.docsRoot = docsRoot;
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  private render(): void {
    const pages = loadPages(this.docsRoot);
    this.panel.webview.html = getHtml(this.panel.webview.cspSource, pages, this.docsRoot);
  }

  private dispose(): void {
    DriverDocsPanel.currentPanel = undefined;
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) disposable.dispose();
    }
  }
}

function loadPages(docsRoot: string): DocPage[] {
  const files = fs.existsSync(docsRoot)
    ? fs.readdirSync(docsRoot)
      .filter(file => file.toLowerCase().endsWith('.md'))
      .sort((a, b) => titleRank(a) - titleRank(b) || a.localeCompare(b))
    : [];

  return files.map(file => {
    const markdown = fs.readFileSync(path.join(docsRoot, file), 'utf8');
    return markdownToPage(file, markdown);
  });
}

function titleRank(file: string): number {
  const lower = file.toLowerCase();
  if (lower === 'student-api.md') return 0;
  if (lower === 'sensors.md') return 1;
  return 10;
}

function markdownToPage(file: string, markdown: string): DocPage {
  const pageId = slug(file.replace(/\.md$/i, ''));
  const headings: DocPage['headings'] = [];
  const html: string[] = [];
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: string[] = [];
  let inFence = false;
  let fenceLang = '';
  let fenceLines: string[] = [];

  const flushParagraph = (): void => {
    if (!paragraph.length) return;
    html.push(`<p>${inlineMarkdown(paragraph.join(' '), pageId)}</p>`);
    paragraph = [];
  };

  const flushList = (): void => {
    if (!list.length) return;
    html.push(`<ul>${list.map(item => `<li>${inlineMarkdown(item, pageId)}</li>`).join('')}</ul>`);
    list = [];
  };

  for (const line of lines) {
    const fence = line.match(/^```(\w+)?\s*$/);
    if (fence && !inFence) {
      flushParagraph();
      flushList();
      inFence = true;
      fenceLang = fence[1] || '';
      fenceLines = [];
      continue;
    }

    if (fence && inFence) {
      html.push(`<pre><code class="language-${escapeAttr(fenceLang)}">${escapeHtml(fenceLines.join('\n'))}</code></pre>`);
      inFence = false;
      fenceLang = '';
      fenceLines = [];
      continue;
    }

    if (inFence) {
      fenceLines.push(line);
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      const title = heading[2].trim();
      const id = `${pageId}-${slug(title)}`;
      if (level <= 2) headings.push({ id, title, level });
      html.push(`<h${level} id="${id}">${inlineMarkdown(title, pageId)}</h${level}>`);
      continue;
    }

    const listItem = line.match(/^\s*-\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      list.push(listItem[1]);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();

  const title = headings[0]?.title || file.replace(/\.md$/i, '').replace(/[-_]/g, ' ');
  return { id: pageId, title, file, html: html.join('\n'), headings };
}

function getHtml(cspSource: string, pages: DocPage[], docsRoot: string): string {
  const nonce = getNonce();
  const pageButtons = pages.map((page, index) => `
    <button class="page-link${index === 0 ? ' active' : ''}" data-page="${escapeAttr(page.id)}">
      <span>${escapeHtml(page.title)}</span>
      <small>${escapeHtml(page.file)}</small>
    </button>`).join('');
  const headingLinks = pages.map((page, index) => `
    <div class="toc-page${index === 0 ? ' active' : ''}" data-toc="${escapeAttr(page.id)}">
      ${page.headings.filter(h => h.level === 2).map(h => `<a href="#${escapeAttr(h.id)}">${escapeHtml(h.title)}</a>`).join('')}
    </div>`).join('');
  const docs = pages.map((page, index) => `
    <article id="doc-${escapeAttr(page.id)}" class="doc-page${index === 0 ? ' active' : ''}" data-page="${escapeAttr(page.id)}">
      ${page.html}
    </article>`).join('');

  const empty = pages.length ? '' : `
    <article class="doc-page active">
      <h1>Driver Docs Not Found</h1>
      <p>No Markdown docs were found at <code>${escapeHtml(docsRoot)}</code>. Run <code>Zebra: Refresh Robot Driver Cache</code> and open this tab again.</p>
    </article>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Zebra Driver Docs</title>
  <style>
    :root {
      --bg: var(--vscode-editor-background);
      --fg: var(--vscode-editor-foreground);
      --muted: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border);
      --side: var(--vscode-sideBar-background);
      --button: var(--vscode-button-background);
      --button-fg: var(--vscode-button-foreground);
      --link: var(--vscode-textLink-foreground);
      --code: var(--vscode-textPreformat-background);
    }
    * { box-sizing: border-box; }
    body { margin: 0; color: var(--fg); background: var(--bg); font-family: var(--vscode-font-family); line-height: 1.55; }
    .shell { min-height: 100vh; display: grid; grid-template-columns: 280px minmax(0, 1fr) 230px; }
    nav, aside { background: var(--side); border-right: 1px solid var(--border); padding: 16px 12px; position: sticky; top: 0; height: 100vh; overflow: auto; }
    aside { border-right: 0; border-left: 1px solid var(--border); }
    .brand { font-size: 13px; color: var(--muted); margin: 0 0 10px; text-transform: uppercase; letter-spacing: 0; }
    .title { font-size: 20px; margin: 0 0 16px; }
    .page-link { width: 100%; display: grid; gap: 3px; text-align: left; padding: 9px 10px; margin-bottom: 6px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--fg); cursor: pointer; font: inherit; }
    .page-link:hover, .page-link.active { border-color: var(--button); background: color-mix(in srgb, var(--button), transparent 84%); }
    .page-link small { color: var(--muted); overflow-wrap: anywhere; }
    main { min-width: 0; padding: 24px min(5vw, 56px) 64px; }
    .doc-page { display: none; max-width: 880px; }
    .doc-page.active { display: block; }
    h1 { margin: 0 0 14px; font-size: 32px; line-height: 1.2; border-bottom: 1px solid var(--border); padding-bottom: 12px; }
    h2 { margin: 34px 0 10px; font-size: 22px; line-height: 1.25; }
    h3 { margin: 24px 0 8px; font-size: 17px; }
    p { margin: 0 0 14px; }
    ul { margin: 0 0 18px; padding-left: 22px; }
    li { margin: 4px 0; }
    a { color: var(--link); text-decoration: none; }
    a:hover { text-decoration: underline; }
    code { font-family: var(--vscode-editor-font-family); background: var(--code); padding: 1px 4px; border-radius: 4px; }
    pre { margin: 14px 0 20px; padding: 14px; overflow: auto; border: 1px solid var(--border); border-radius: 6px; background: var(--code); }
    pre code { padding: 0; background: transparent; border-radius: 0; }
    .toc-page { display: none; }
    .toc-page.active { display: grid; gap: 7px; }
    .toc-page a { color: var(--muted); font-size: 13px; }
    @media (max-width: 980px) {
      .shell { grid-template-columns: 220px minmax(0, 1fr); }
      aside { display: none; }
    }
    @media (max-width: 720px) {
      .shell { display: block; }
      nav { position: static; height: auto; border-right: 0; border-bottom: 1px solid var(--border); }
      main { padding: 20px; }
      h1 { font-size: 26px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <nav>
      <p class="brand">ZebraBot</p>
      <h1 class="title">Driver Docs</h1>
      ${pageButtons}
    </nav>
    <main>${docs}${empty}</main>
    <aside>
      <p class="brand">On This Page</p>
      ${headingLinks}
    </aside>
  </div>
  <script nonce="${nonce}">
    const buttons = [...document.querySelectorAll('.page-link')];
    const pages = [...document.querySelectorAll('.doc-page')];
    const tocPages = [...document.querySelectorAll('.toc-page')];
    buttons.forEach(button => {
      button.addEventListener('click', () => {
        setPage(button.dataset.page);
        location.hash = '';
        document.documentElement.scrollTop = 0;
      });
    });
    document.addEventListener('click', event => {
      const link = event.target.closest('a[href^="#doc-"]');
      if (!link) return;
      const page = link.getAttribute('href').slice(5);
      if (!pages.some(p => p.dataset.page === page)) return;
      event.preventDefault();
      setPage(page);
      document.documentElement.scrollTop = 0;
    });
    function setPage(page) {
      buttons.forEach(b => b.classList.toggle('active', b.dataset.page === page));
      pages.forEach(p => p.classList.toggle('active', p.dataset.page === page));
      tocPages.forEach(t => t.classList.toggle('active', t.dataset.toc === page));
    }
  </script>
</body>
</html>`;
}

function inlineMarkdown(value: string, pageId: string): string {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text: string, href: string) => {
      const target = href.endsWith('.md') ? `#doc-${pageIdFromHref(href)}` : href;
      return `<a href="${escapeAttr(target)}">${text}</a>`;
    });
}

function pageIdFromHref(href: string): string {
  return slug(path.basename(href).replace(/\.md$/i, ''));
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
