// ==UserScript==
// @name         RARGB 批量云下载到 PikPak
// @namespace    rargb-pikpak
// @version      3.1.0
// @description  将 RARGB 当前列表逐页转存到 PikPak，也可搜索并选择单独条目。
// @match        https://rargb.to/*
// @match        https://www.rargb.to/*
// @match        https://mypikpak.com/drive/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// ==/UserScript==

(async () => {
  'use strict';

  const current = new URL(location.href);
  const drive = 'https://mypikpak.com/drive/all';
  const queueParam = 'rargb_queue';
  const batchSize = 10;
  const reviewTimeout = 15 * 60 * 1000;
  const siteSearch = /^\/(?:search(?:\/|$)|torrents\.php$)/i;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  async function waitFor(check, timeout, signal) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const value = check();
      if (value) return value;
      await sleep(250);
    }
    return null;
  }

  const queueKeys = id => [`rargb-pikpak-queue-${id}`, `rargb-pikpak-receipt-${id}`];

  async function withQueue(signal, enqueue) {
    const id = crypto.randomUUID();
    const [jobKey, receiptKey] = queueKeys(id);
    const target = new URL(drive);
    target.searchParams.set(queueParam, id);
    let sequence = 0;
    const expires = () => Date.now() + reviewTimeout + 90000;
    GM_setValue(jobKey, { sequence, expires: expires() });
    try {
      const tab = GM_openInTab(target.href, { active: true });
      const getReceipt = () => {
        if (tab?.closed) throw new Error('PikPak 标签页已关闭。');
        return GM_getValue(receiptKey);
      };
      if (!await waitFor(getReceipt, 55000, signal)) {
        throw new Error('PikPak 未就绪。请确认已登录，且 Tampermonkey 能在 mypikpak.com 运行脚本。');
      }
      await enqueue(async (batch, review = null) => {
        signal.throwIfAborted();
        sequence++;
        GM_setValue(jobKey, { sequence, links: batch.join('\n'), review, expires: expires() });
        const receipt = await waitFor(() => {
          const value = getReceipt();
          return value?.sequence === sequence ? value : null;
        }, review ? reviewTimeout + 65000 : 65000, signal);
        if (!receipt) throw new Error('未收到 PikPak 批次回执，请先检查云下载任务。');
        if (receipt.error) throw new Error(receipt.error);
      });
    } finally {
      GM_deleteValue(jobKey);
      GM_deleteValue(receiptKey);
    }
  }

  if (current.origin === new URL(drive).origin) {
    const findLinkInput = () => [...document.querySelectorAll('textarea[placeholder]')]
      .find(input => input.getClientRects().length && /\bmagnet\b/i.test(input.placeholder));
    const openDialog = () => [...document.querySelectorAll('button')].find(button =>
      button.getClientRects().length && /^(?:云下载|雲端下載|cloud download)$/i.test(button.textContent.trim()));
    function fillLinks(input, links) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, links);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const queueId = current.searchParams.get(queueParam);
    if (queueId && /^[\da-f-]{36}$/i.test(queueId)) {
      const [jobKey, receiptKey] = queueKeys(queueId);
      const ack = (sequence, error) => {
        if (GM_getValue(jobKey)) GM_setValue(receiptKey, { sequence, error });
      };
      if (!GM_getValue(jobKey) || !await waitFor(() => openDialog(), 45000)) return;
      let received = GM_getValue(receiptKey)?.sequence || 0;
      ack(received);
      for (;;) {
        const job = GM_getValue(jobKey);
        if (!job || job.expires < Date.now()) return;
        if (!job.links || job.sequence <= received) {
          await sleep(500);
          continue;
        }
        received = job.sequence;
        try {
          if (findLinkInput()) throw new Error('PikPak 已打开其他云下载窗口，请关闭后再试。');
          const button = openDialog();
          if (!button) throw new Error('PikPak 的云下载入口不可用。');
          button.click();
          const input = await waitFor(findLinkInput, 12000);
          if (!input || input.value.trim()) throw new Error('PikPak 的云下载输入框不可用。');
          if (!GM_getValue(jobKey)) return;
          const dialog = input.closest('[role="dialog"], dialog') || document;
          const isSubmit = control => control?.getClientRects().length && !control.disabled
            && control.getAttribute('aria-disabled') !== 'true'
            && /^(?:立即创建|立即建立|create now)$/i.test(control.textContent.trim());
          const alerts = () => [...document.querySelectorAll('[role="alert"], [data-sonner-toast], .el-message')]
            .filter(element => element.getClientRects().length)
            .map(element => element.textContent.trim());
          const earlierAlerts = new Set(alerts());
          fillLinks(input, job.links);
          await sleep(0);
          if (input.value.length !== job.links.length) throw new Error('PikPak 输入框未完整接收本批链接。');
          if (job.review) {
            GM_setClipboard(job.links, 'text');
            const feedback = document.createElement('p');
            feedback.setAttribute('role', 'status');
            feedback.textContent = `RARGB 第 ${received} / ${job.review.total} 批。核对保存位置后点击「立即创建」。`;
            input.before(feedback);
            let decision;
            const onClick = event => {
              const control = event.target.closest?.('button');
              if (!control || !dialog.contains(control)) return;
              if (isSubmit(control)) decision = 'submit';
              else if (/^(?:取消|关闭此对话框|cancel|close this dialog)$/i.test(control.getAttribute('aria-label') || control.textContent.trim())) {
                decision = 'cancel';
              }
            };
            dialog.addEventListener('click', onClick, true);
            try {
              const action = await waitFor(() => decision || (!GM_getValue(jobKey) && 'stop')
                || (!input.isConnected && 'cancel'), reviewTimeout);
              if (action === 'stop') return;
              if (action !== 'submit') throw new Error(action === 'cancel' ? 'PikPak 批次已取消。' : '等待确认本批次超时。');
            } finally {
              dialog.removeEventListener('click', onClick, true);
              feedback.remove();
            }
          } else {
            const submit = await waitFor(() => [...dialog.querySelectorAll('button')].find(isSubmit), 10000);
            if (!submit) throw new Error('PikPak 未启用「立即创建」，请查看当前批次。');
            if (!GM_getValue(jobKey)) return;
            submit.click();
          }
          const settled = await waitFor(() => {
            const failure = alerts().find(message => !earlierAlerts.has(message)
              && /失败|额度|超出|上限|無效|無法建立|failed|limit exceeded|quota/i.test(message));
            return failure ? { failure } : findLinkInput() !== input && { closed: true };
          }, 30000);
          if (!settled) {
            throw new Error('PikPak 未确认本批次，请检查任务状态。');
          }
          if (settled.failure) throw new Error(settled.failure);
          ack(received);
        } catch (error) {
          ack(received, error.message);
          return;
        }
      }
    }

    return;
  }

  function siteUrl(href, base) {
    try {
      const url = new URL(href, base);
      if (url.origin !== current.origin || url.username || url.password) return null;
      url.hash = '';
      return url;
    } catch {
      return null;
    }
  }

  function findMagnet(root) {
    return root.querySelector('a[href^="magnet:?"]')?.getAttribute('href')?.trim();
  }

  function readResults(page, base) {
    const matches = [];
    for (const row of page.querySelectorAll('tr.lista2, table.lista2t tr, table.lista2 tr')) {
      for (const link of row.querySelectorAll('a[href^="/torrent/"]')) {
        const url = siteUrl(link.getAttribute('href'), base);
        const title = link.textContent.trim() || link.title.trim();
        if (!url || !/^\/torrent\/(?!download\/)[^/]+\/?$/i.test(url.pathname) || !title) continue;
        const id = url.pathname.match(/-(\d+)\.html$/i)?.[1] || url.pathname;
        matches.push({ id, url, title, magnet: findMagnet(row) });
        break;
      }
    }
    return matches;
  }

  function nextPage(page, currentPage) {
    const pageNumber = url => Number(url.searchParams.get('page') || url.searchParams.get('p')
      || url.pathname.match(/\/(\d+)\/?$/)?.[1] || 1);
    const pagePath = url => url.pathname.replace(/\/\d+\/?$/, '/').replace(/\/$/, '');
    const filters = [...currentPage.searchParams].filter(([key]) => !['page', 'p'].includes(key));
    const links = page.querySelectorAll('#pager_links a[href], a[rel~="next"][href], link[rel~="next"][href]');
    const candidates = [];
    for (const link of links.length ? links : page.querySelectorAll('a[href]')) {
      const url = siteUrl(link.getAttribute('href'), currentPage);
      if (!url || pagePath(url) !== pagePath(currentPage) || pageNumber(url) !== pageNumber(currentPage) + 1) continue;
      if (filters.some(([key, value]) => !url.searchParams.getAll(key).includes(value))) continue;
      const label = link.textContent.trim();
      if (link.relList?.contains('next') || /^next page$/i.test(link.title) || /^(?:>{1,2}|›|»|next)$/i.test(label)) return url;
      if (/^\d+$/.test(label)) candidates.push(url);
    }
    return candidates[0];
  }

  async function readPage(url, signal) {
    const response = await fetch(url, {
      mode: 'same-origin', credentials: 'same-origin', cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]),
    });
    if (response.headers.get('cf-mitigated') === 'challenge' || response.status === 429) {
      const error = new Error('站点要求验证或限制了请求频率，请处理后再试。');
      error.stopBatch = true;
      throw error;
    }
    if (!response.ok) throw new Error(`站点返回 HTTP ${response.status}。`);
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }

  async function magnetFor(item, signal) {
    signal.throwIfAborted();
    item.magnet ||= findMagnet(await readPage(item.url, signal));
    if (!item.magnet) throw new Error('未找到磁力链接。');
    return item.magnet;
  }

  const firstRows = readResults(document, current);
  if (current.pathname !== '/' && !siteSearch.test(current.pathname) && !firstRows.length) return;
  if (document.getElementById('rargb-pikpak-panel')) return;

  const host = document.createElement('div');
  host.id = 'rargb-pikpak-panel';
  const ui = host.attachShadow({ mode: 'open' });
  ui.innerHTML = `
    <style>
      :host { all: initial; font: 14px/1.5 system-ui, sans-serif; color: #1e293b; }
      #open, #all, #send { color: white; background: #155b75; border-color: #155b75; }
      :host([data-layout="floating"]) #open { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; padding: 10px 16px; }
      :host([data-layout="inline"]) { display: inline-block; vertical-align: middle; margin: 6px 10px; }
      dialog { width: min(580px, calc(100vw - 44px)); max-height: 85vh; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 14px; padding: 18px; color: inherit; }
      dialog::backdrop { background: #0f172a66; }
      h2 { margin: 0 0 12px; font-size: 18px; }
      button { font: inherit; border: 1px solid #cbd5e1; background: #fff; color: inherit; border-radius: 7px; padding: 5px 10px; cursor: pointer; }
      button:disabled { opacity: .55; cursor: default; }
      form, .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
      input { font: inherit; }
      input[type=number] { width: 4em; }
      #status { min-height: 1.5em; margin: 10px 0; }
      #list { margin: 10px 0; max-height: min(42vh, 310px); overflow: auto; }
      #list label { display: grid; grid-template-columns: auto 1fr; align-items: start; gap: 8px; padding: 6px 0; border-bottom: 1px solid #e2e8f0; overflow-wrap: anywhere; }
      #list small { display: block; color: #475569; }
    </style>
    <button id="open" type="button">批量云下载到 PikPak</button>
    <dialog>
      <h2>批量云下载到 PikPak</h2>
      <form>
        <label>关键词 <input id="keyword" type="search" required></label>
        <label>扫描页数 <input id="pages" type="number" min="1" step="1" value="2" required></label>
        <button id="scan" type="submit">搜索</button>
      </form>
      <div id="status" role="status" aria-live="polite"></div>
      <div id="list"></div>
      <div class="actions">
        <button id="all" type="button">从当前页转存到最后一页</button>
        <button id="send" type="button" disabled>打开 PikPak 云下载</button>
        <button id="select" type="button" disabled>全选</button>
        <button id="clear" type="button" disabled>取消全选</button>
        <button id="stop" type="button" disabled>停止</button>
        <button id="close" type="button">关闭</button>
      </div>
    </dialog>`;
  const pager = document.querySelector('#pager_links');
  host.dataset.layout = pager ? 'inline' : 'floating';
  if (pager) pager.after(host);
  else document.body.append(host);

  const get = id => ui.getElementById(id);
  const dialog = ui.querySelector('dialog');
  const currentKeyword = current.searchParams.get('search')?.trim();
  get('keyword').value = currentKeyword || '';
  const entries = [];
  let active;
  const report = message => { get('status').textContent = message; };

  function updateControls() {
    const busy = Boolean(active);
    for (const id of ['keyword', 'pages', 'scan', 'close']) get(id).disabled = busy;
    get('all').disabled = busy || !firstRows.length;
    for (const id of ['select', 'clear']) get(id).disabled = busy || !entries.length;
    get('send').disabled = busy || !entries.some(entry => entry.checkbox.checked);
    get('stop').disabled = !busy;
    for (const { checkbox } of entries) checkbox.disabled = busy;
  }

  function addEntry(item) {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.addEventListener('change', updateControls);
    const title = document.createElement('span');
    title.textContent = item.title;
    const note = document.createElement('small');
    title.append(note);
    const label = document.createElement('label');
    label.append(checkbox, title);
    get('list').append(label);
    entries.push({ item, checkbox, note });
  }

  async function run(task) {
    if (active) return;
    active = new AbortController();
    updateControls();
    try {
      await task(active.signal);
    } catch (error) {
      report(active.signal.aborted ? '操作已停止。' : error.message);
    } finally {
      active = undefined;
      updateControls();
    }
  }

  get('open').onclick = () => { if (!dialog.open) dialog.showModal(); };
  GM_registerMenuCommand('批量云下载到 PikPak', () => get('open').click());
  updateControls();
  get('close').onclick = () => dialog.close();
  get('stop').onclick = () => active?.abort();
  dialog.addEventListener('cancel', event => { if (active) event.preventDefault(); });
  for (const [id, checked] of [['select', true], ['clear', false]]) {
    get(id).onclick = () => {
      for (const { checkbox } of entries) checkbox.checked = checked;
      updateControls();
    };
  }

  ui.querySelector('form').onsubmit = event => {
    event.preventDefault();
    return run(async signal => {
      const keyword = get('keyword').value.trim();
      if (!keyword) throw new Error('请输入关键词。');
      const limit = get('pages').valueAsNumber;
      if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('扫描页数须为正整数。');
      entries.length = 0;
      get('list').replaceChildren();
      const found = new Set();
      const visited = new Set();
      const onSearch = siteSearch.test(current.pathname) && currentKeyword === keyword;
      let url = onSearch ? current : new URL('/search/', current);
      if (!onSearch) url.searchParams.set('search', keyword);
      let page = onSearch ? document : await readPage(url, signal);
      for (let number = 1; number <= limit && url && !visited.has(url.href); number++) {
        signal.throwIfAborted();
        visited.add(url.href);
        report(`正在扫描第 ${number} 页。`);
        for (const item of readResults(page, url)) {
          if (found.has(item.id)) continue;
          found.add(item.id);
          addEntry(item);
        }
        if (number === limit) break;
        url = nextPage(page, url);
        if (url) page = await readPage(url, signal);
      }
      report(`扫描 ${visited.size} 页，找到 ${entries.length} 条结果。`);
    });
  };

  get('all').onclick = () => run(async signal => {
    let pages = 0;
    let submitted = 0;
    let skipped = 0;
    try {
      report('正在连接 PikPak。请保持两个标签页打开。');
      await withQueue(signal, async submit => {
        const seen = new Set();
        const visited = new Set();
        let url = current;
        let page = document;
        while (url && !visited.has(url.href)) {
          signal.throwIfAborted();
          visited.add(url.href);
          pages++;
          const rows = readResults(page, url);
          if (!rows.length) throw new Error(`第 ${pages} 个扫描页面没有可读取的列表。`);
          const links = [];
          for (const item of rows) {
            if (seen.has(item.id)) continue;
            seen.add(item.id);
            report(`正在读取第 ${pages} 个页面，已提交 ${submitted} 条。`);
            try {
              links.push(await magnetFor(item, signal));
            } catch (error) {
              if (signal.aborted || error.stopBatch) throw error;
              skipped++;
            }
          }
          for (let offset = 0; offset < links.length; offset += batchSize) {
            const batch = links.slice(offset, offset + batchSize);
            report(`正在提交第 ${pages} 个页面的磁力链接，已提交 ${submitted} 条。`);
            await submit(batch);
            submitted += batch.length;
          }
          url = nextPage(page, url);
          if (url && !visited.has(url.href)) page = await readPage(url, signal);
        }
      });
      report(`已处理到最后一页。扫描 ${pages} 页，提交 ${submitted} 条，${skipped} 条未取得磁力链接。`);
    } catch (error) {
      const progress = `已扫描 ${pages} 页，已确认提交 ${submitted} 条，${skipped} 条未取得磁力链接。`;
      report(signal.aborted ? `操作已停止。${progress}` : `${error.message} ${progress}`);
    }
  });

  get('send').onclick = () => run(async signal => {
    const selected = entries.filter(entry => entry.checkbox.checked);
    const links = [];
    for (const [index, { item, note }] of selected.entries()) {
      report(`正在读取第 ${index + 1} / ${selected.length} 条磁力链接。`);
      try {
        links.push(await magnetFor(item, signal));
        note.textContent = '已取得磁力链接。';
      } catch (error) {
        if (signal.aborted || error.stopBatch) throw error;
        note.textContent = error.message;
      }
    }
    if (!links.length) throw new Error('所选结果中未取得磁力链接。');
    const total = Math.ceil(links.length / batchSize);
    const skipped = selected.length - links.length;
    let submitted = 0;
    try {
      report('正在连接 PikPak。请保持两个标签页打开。');
      await withQueue(signal, async submit => {
        for (let offset = 0; offset < links.length; offset += batchSize) {
          const batch = links.slice(offset, offset + batchSize);
          report(`请在 PikPak 确认第 ${1 + offset / batchSize} / ${total} 批，已提交 ${submitted} 条。`);
          await submit(batch, { total });
          submitted += batch.length;
        }
      });
      report(`已提交 ${submitted} 条，共 ${total} 批。${skipped} 条未取得磁力链接。`);
    } catch (error) {
      const progress = `已确认提交 ${submitted} 条，${skipped} 条未取得磁力链接。`;
      report(signal.aborted ? `操作已停止。${progress}` : `${error.message} ${progress}`);
    }
  });
})();
