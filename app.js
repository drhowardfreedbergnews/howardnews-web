const $ = (id) => document.getElementById(id);
const defaults = {
  title: 'Howard’s Reading List', groups: ['Friends', 'Family', 'Colleagues'],
  contacts: [
    { name: 'Alex (sample)', email: 'alex@example.test', groups: ['Friends', 'Family'] },
    { name: 'Jordan (sample)', email: 'jordan@example.test', groups: ['Colleagues'] },
  ],
  audience: [], saved: [], picks: [], removedPicks: [], ratings: [], dismissed: [], publishers: [], similarOnly: true,
};
const samples = [
  { title: 'Sample article — explore the Washington Free Beacon', url: 'https://freebeacon.com/', source: 'Sample' },
  { title: 'Sample article — browse the Library of Congress', url: 'https://www.loc.gov/', source: 'Sample' },
];
const key = 'howard-news-desk-v1';
let state = structuredClone(defaults);
try { state = { ...state, ...JSON.parse(localStorage.getItem(key)) }; } catch {}
for (const pick of state.picks) pick.queued ??= true;
let incoming = [];
let builtInSources = [];
const customResults = new Map();
let chosenEmail = '';
const store = () => localStorage.setItem(key, JSON.stringify(state));
const commit = () => { store(); render(); };

function el(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}
function button(label, click, className = 'secondary') {
  const node = el('button', label, className);
  node.type = 'button';
  node.onclick = click;
  return node;
}
function checks(parent, values, selected, handle) {
  parent.replaceChildren(...values.map((name) => {
    const label = el('label', undefined, 'check');
    const input = el('input');
    input.type = 'checkbox';
    input.value = name;
    input.checked = selected.includes(name);
    if (handle) input.onchange = () => handle(name, input.checked);
    label.append(input, name);
    return label;
  }));
}
const toggle = (values, name, checked) => checked ? [...values, name] : values.filter((item) => item !== name);

function articleLink(article, external = false) {
  const link = el('a', article.title);
  link.href = article.url;
  if (external) {
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }
  link.onclick = (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const url = new URL(article.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin === location.origin) return;
    $('reader-title').textContent = article.title;
    $('reader-source').textContent = article.source ?? '';
    $('reader-summary').textContent = article.summary || 'This publisher did not include an excerpt.';
    $('reader-external').href = url.href;
    $('reader-page').src = url.href;
    $('reader').showModal();
  };
  return link;
}

const stopWords = new Set('about after also amid and are before can could does for from had has have her his how into its just more new now off one our out over says she than that the their them then there these they this those through too under was were what when where which who why will with would you your'.split(' '));
function articleTerms({ title, topics = [] }) {
  const terms = (title + ' ' + topics.join(' ')).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  return new Set(terms.filter((term) => !stopWords.has(term)));
}

const reactions = [
  [2, '👍👍', 'Love it'], [1, '👍', 'Like'], [-1, '👎', 'Dislike'], [-2, '👎👎', 'Strongly dislike'],
];
function ratingControls(article, rating) {
  const controls = el('div', undefined, 'reactions');
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Rate article');
  for (const [value, symbol, label] of reactions) {
    const control = button(symbol, () => {
      state.ratings = state.ratings.filter((entry) => entry.url !== article.url);
      if (rating !== value) state.ratings.push({ url: article.url, value, terms: [...articleTerms(article)] });
      store();
      renderArticles();
      const replacement = [...$('articles').querySelectorAll('.article')].find((row) => row.dataset.url === article.url);
      (replacement?.querySelector('[data-rating="' + value + '"]') ?? $('similar-only')).focus();
    }, 'reaction');
    control.title = label;
    control.dataset.rating = value;
    control.setAttribute('aria-label', label);
    control.setAttribute('aria-pressed', String(rating === value));
    controls.append(control);
  }
  return controls;
}

function renderArticles() {
  const entries = new Map();
  const customArticles = [...customResults.values()].flatMap(({ articles }) => articles);
  for (const article of [...state.saved, ...incoming, ...customArticles]) if (!entries.has(article.url)) entries.set(article.url, article);
  const ratings = new Map(state.ratings.map((entry) => [entry.url, entry.value]));
  const saved = new Set(state.saved.map((article) => article.url));
  const weights = new Map();
  for (const { value, terms } of state.ratings) {
    for (const term of terms) weights.set(term, (weights.get(term) ?? 0) + value);
  }
  const trained = state.ratings.some(({ value }) => value > 0);
  const publisher = $('source-filter').value;
  const search = $('article-search').value.trim().toLowerCase();
  $('similar-only').checked = state.similarOnly;
  $('match-status').textContent = !state.similarOnly ? 'Showing all articles' :
    trained ? 'Filtered by your ratings' : 'Like an article to start filtering';
  const dismissed = new Set(state.dismissed);
  const showDismissed = $('show-dismissed').checked;
  const visible = [...entries.values()].map((article) => ({
    article,
    score: [...articleTerms(article)].reduce((sum, term) => sum + (weights.get(term) ?? 0), 0),
  })).filter(({ article, score }) => (!publisher || publisher === article.source) &&
    (!search || article.title.toLowerCase().includes(search)) &&
    (showDismissed ? dismissed.has(article.url) :
      (!dismissed.has(article.url) && (!state.similarOnly || saved.has(article.url) ||
      ((ratings.get(article.url) ?? 0) >= 0 && (!trained || score > 0 || (ratings.get(article.url) ?? 0) > 0))))));
  if (state.similarOnly && trained) visible.sort((left, right) => Number(saved.has(right.article.url)) -
    Number(saved.has(left.article.url)) || right.score - left.score);
  if (!visible.length && entries.size) {
    const empty = showDismissed ? 'No dismissed stories from this selection.' :
      'No matching stories. Try another publisher or turn off Similar articles only.';
    $('articles').replaceChildren(el('p', empty, 'empty'));
    return;
  }
  $('articles').replaceChildren(...visible.map(({ article }) => {
    const row = el('article', undefined, 'article');
    row.dataset.url = article.url;
    const details = el('div');
    const title = el('h3');
    title.append(articleLink(article));
    const date = new Date(article.date);
    const metadata = Number.isNaN(date.getTime()) ? article.source : article.source + ' · ' +
      new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
    details.append(el('p', metadata, 'source'), title);
    if (article.summary && article.summary !== article.title) details.append(el('p', article.summary, 'article-summary'));
    const picked = state.picks.some((pick) => pick.url === article.url);
    const add = button(picked ? '✓' : '+', () => {
      if (picked) {
        const pick = state.picks.find((item) => item.url === article.url);
        state.picks = state.picks.filter((item) => item.url !== article.url);
        state.removedPicks.push(pick);
      } else {
        const previous = state.removedPicks.find((item) => item.url === article.url);
        state.removedPicks = state.removedPicks.filter((item) => item.url !== article.url);
        state.picks.push({ ...article, notes: previous?.notes ?? '', groups: previous?.groups ?? [], queued: false });
      }
      commit();
      [...$('articles').querySelectorAll('.article')].find((item) => item.dataset.url === article.url)
        ?.querySelector('.draft-toggle')?.focus({ preventScroll: true });
    }, 'article-icon draft-toggle');
    add.title = picked ? 'Remove from draft' : 'Add to draft';
    add.setAttribute('aria-label', 'In draft');
    add.setAttribute('aria-pressed', String(picked));
    const actions = el('div', undefined, 'article-actions');
    const dismiss = button(showDismissed ? '↶' : '×', () => {
      state.dismissed = toggle(state.dismissed, article.url, !showDismissed);
      store();
      renderArticles();
      const notice = $('inbox-notice');
      const undo = button('Undo', () => {
        state.dismissed = toggle(state.dismissed, article.url, showDismissed);
        store();
        renderArticles();
        notice.replaceChildren();
        $('show-dismissed').focus();
      }, 'quiet');
      notice.replaceChildren(showDismissed ? 'Story restored.' : 'Story dismissed.', undo);
      undo.focus();
    }, 'quiet article-icon');
    dismiss.title = showDismissed ? 'Restore' : 'Dismiss';
    dismiss.setAttribute('aria-label', dismiss.title);
    actions.append(ratingControls(article, ratings.get(article.url)), add, dismiss);
    row.append(details, actions);
    return row;
  }));
}

let speech;
function dictation(notes, status) {
  const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  const icon = el('span', '🎙', 'mic-icon');
  icon.setAttribute('aria-hidden', 'true');
  const caption = el('span', 'Dictate');
  const control = button('', () => {
    if (!Recognition) {
      status.textContent = 'Use Windows voice typing with Win + H while focused in the commentary field.';
      notes.focus();
      return;
    }
    if (speech) {
      speech.stop();
      return;
    }
    const recognition = new Recognition();
    recognition.lang = navigator.language || 'en-US';
    recognition.continuous = true;
    speech = recognition;
    recognition.onresult = (event) => {
      const words = Array.from(event.results).slice(event.resultIndex).map((result) => result[0].transcript.trim()).join(' ');
      if (words && notes.isConnected) {
        notes.value += (notes.value.trim() ? ' ' : '') + words;
        notes.dispatchEvent(new Event('input'));
      }
    };
    recognition.onerror = () => {
      status.textContent = 'Dictation unavailable. Check microphone access or use Windows voice typing (Win + H).';
    };
    recognition.onend = () => {
      if (speech === recognition) speech = undefined;
      caption.textContent = 'Dictate';
      control.setAttribute('aria-pressed', 'false');
      if (status.textContent === 'Listening…') status.textContent = 'Dictation stopped.';
    };
    try {
      recognition.start();
      status.textContent = 'Listening…';
      caption.textContent = 'Stop dictation';
      control.setAttribute('aria-pressed', 'true');
    } catch {
      speech = undefined;
      status.textContent = 'Could not start the microphone. Use Windows voice typing (Win + H).';
    }
  }, 'microphone');
  control.setAttribute('aria-pressed', 'false');
  control.append(icon, caption);
  return control;
}

function renderPicks() {
  $('draft-count').textContent = state.picks.length + ' selected';
  if (!state.picks.length) {
    $('picks').replaceChildren(el('p', 'Use Add to draft on an article to start writing.', 'empty'));
    return;
  }
  $('picks').replaceChildren(...state.picks.map((pick, index) => {
    const card = el('article', undefined, 'pick');
    const title = el('h3');
    title.append(articleLink(pick));
    const actions = el('div', undefined, 'choices');
    function move(offset) {
      const target = index + offset;
      [state.picks[index], state.picks[target]] = [state.picks[target], state.picks[index]];
      commit();
    }
    const up = button('Move up', () => move(-1));
    const down = button('Move down', () => move(1));
    up.disabled = index === 0;
    down.disabled = index === state.picks.length - 1;
    actions.append(up, down, button('Remove', () => { state.picks.splice(index, 1); commit(); }));
    const label = el('label', 'Your commentary');
    const notes = el('textarea');
    notes.id = 'commentary-' + index;
    label.htmlFor = notes.id;
    notes.rows = 3;
    notes.value = pick.notes;
    notes.oninput = () => { pick.notes = notes.value; store(); renderPreview(); };
    const editor = el('div', undefined, 'commentary-editor');
    const tools = el('div', undefined, 'choices commentary-tools');
    const status = el('span', '', 'muted');
    status.setAttribute('role', 'status');
    editor.append(notes, dictation(notes, status));
    tools.append(button(pick.queued ? 'In queue' : 'Add to mailing queue', () => {
      pick.queued = true;
      commit();
      $('preview').scrollIntoView({ block: 'start' });
    }, 'queue-action'), status);
    tools.querySelector('.queue-action').disabled = pick.queued;
    card.append(title, actions, label, editor, tools);
    return card;
  }));
}

function renderQueue() {
  const queued = state.picks.filter((pick) => pick.queued);
  const select = $('queue-group');
  const group = state.groups.includes(select.value) ? select.value : '';
  select.replaceChildren(...['', ...state.groups].map((name) => {
    const option = el('option', name || 'All queued stories');
    option.value = name;
    return option;
  }));
  select.value = group;
  $('queue-count').textContent = queued.length + ' queued';
  const visible = queued.filter((pick) => !group || !pick.groups.length || pick.groups.includes(group));
  if (!visible.length) {
    $('queue').replaceChildren(el('p', queued.length ? 'No stories for this group.' : 'Add a story from Howard’s take to organize it for mailing.', 'empty'));
    return;
  }
  $('queue').replaceChildren(...visible.map((pick) => {
    const card = el('article', undefined, 'pick');
    const title = el('h3');
    title.append(articleLink(pick));
    const audience = el('fieldset');
    const groups = el('div', undefined, 'choices');
    audience.append(el('legend', 'Article groups'), groups, el('p', 'Clear all groups to include this article for everyone receiving the issue.', 'muted'));
    checks(groups, state.groups, pick.groups, (name, checked) => {
      pick.groups = toggle(pick.groups, name, checked);
      store();
      if (group && pick.groups.length && !pick.groups.includes(group)) renderQueue();
      renderPreview();
    });
    card.append(title, audience, button('Return to draft', () => { pick.queued = false; commit(); }));
    return card;
  }));
}

function renderPreview() {
  const eligible = state.contacts.filter((contact) => !state.audience.length || contact.groups.some((name) => state.audience.includes(name)));
  const recipient = eligible.find((contact) => contact.email === chosenEmail) ?? eligible[0];
  const select = $('recipient');
  select.replaceChildren(...eligible.map((contact) => {
    const option = el('option', contact.name + ' · ' + contact.email);
    option.value = contact.email;
    return option;
  }));
  select.disabled = !recipient;
  if (recipient) select.value = recipient.email;
  const issue = $('issue');
  issue.replaceChildren(el('h3', state.title.trim() || 'Untitled issue', 'issue-title'));
  if (!recipient) return issue.append(el('p', 'There are no contacts in the selected mailing groups.', 'muted'));
  const visible = state.picks.filter((pick) => pick.queued && (!pick.groups.length || pick.groups.some((name) => recipient.groups.includes(name))));
  if (!visible.length) issue.append(el('p', 'This recipient has no articles in this issue.', 'muted'));
  for (const pick of visible) {
    const article = el('article', undefined, 'preview-article');
    const title = el('h4');
    title.append(articleLink(pick));
    article.append(el('p', pick.source, 'source'), title);
    if (pick.notes.trim()) article.append(el('p', pick.notes, 'commentary'));
    issue.append(article);
  }
}

function render() {
  renderArticles();
  checks($('issue-groups'), state.groups, state.audience, (name, checked) => {
    state.audience = toggle(state.audience, name, checked);
    store();
    renderPreview();
  });
  $('issue-groups').append(el('span', 'Clear all groups to include all contacts.', 'muted'));
  $('groups').replaceChildren(...state.groups.map((name) => el('span', name, 'pill')));
  checks($('contact-groups'), state.groups, []);
  $('contacts').replaceChildren(...state.contacts.map((contact) => {
    const row = el('details', undefined, 'contact');
    const memberships = el('div', undefined, 'choices');
    row.append(el('summary', contact.name + ' · ' + contact.email), memberships);
    checks(memberships, state.groups, contact.groups, (name, checked) => {
      contact.groups = toggle(contact.groups, name, checked);
      store();
      renderPreview();
    });
    return row;
  }));
  renderPicks();
  renderQueue();
  renderPreview();
}

$('issue-title').value = state.title;
$('issue-title').oninput = (event) => { state.title = event.target.value; store(); renderPreview(); };
$('recipient').onchange = (event) => { chosenEmail = event.target.value; renderPreview(); };
$('queue-group').onchange = renderQueue;
$('source-filter').onchange = (event) => {
  if (event.target.value === '\u0001add') {
    event.target.value = '';
    $('add-publisher').hidden = false;
    $('add-publisher').elements.publisherName.focus();
  }
  renderArticles();
};
$('article-search').value = new URLSearchParams(window.location.search).get('q') ?? '';
$('article-search').oninput = renderArticles;
$('show-dismissed').onchange = renderArticles;

function renderSources() {
  const sources = [...builtInSources, ...state.publishers.map(({ name, feed }) => {
    const result = customResults.get(name);
    return { source: name, available: Boolean(result?.articles.length), count: result?.articles.length ?? 0,
      customStatus: feed ? result?.status ?? 'Waiting for feed' : 'Saved links' };
  })];
  const picker = $('source-filter');
  const selected = picker.value;
  const options = (placeholder) => ['', ...sources.map(({ source }) => source)].map((source) => {
    const option = el('option', source || placeholder);
    option.value = source;
    return option;
  });
  const add = el('option', 'Add publisher…');
  add.value = '\u0001add';
  picker.replaceChildren(...options('All publishers'), add);
  picker.value = [...picker.options].some(({ value }) => value === selected) ? selected : '';
  const saved = $('saved-publisher');
  const savedSelection = saved.value;
  saved.replaceChildren(...options('Use the website name'));
  saved.value = [...saved.options].some(({ value }) => value === savedSelection) ? savedSelection : '';
  $('source-status').replaceChildren(...sources.map(({ source, available, count, home, customStatus }) => {
    const item = el('li', source + ' · ' + (customStatus ?? (available ? count + ' stories' : count ? 'Showing previous stories' : 'Unavailable')));
    if (home && !available) item.append(' · ', articleLink({ title: 'Open publisher', url: home }, true));
    return item;
  }));
}
async function loadPublisher({ name, feed }) {
  if (!feed) return;
  try {
    const response = await fetch(feed, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(6500) });
    if (!response.ok) throw new Error();
    const text = await response.text();
    if (text.length > 2_000_000) throw new Error();
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    const articles = [...xml.querySelectorAll('item, entry')].slice(0, 30).flatMap((item) => {
      const field = (selector) => item.querySelector(selector)?.textContent.trim() ?? '';
      const link = item.querySelector('link:not([rel]), link[rel="alternate"]');
      const href = link?.getAttribute('href') || link?.textContent.trim();
      const title = field('title');
      if (!title || !href) return [];
      const url = new URL(href, feed);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return [];
      const words = (field('description') || field('summary')).replace(/<[^>]*>/g, ' ').trim().split(/\s+/);
      return [{ title, url: url.href, source: name, date: field('pubDate, published, updated'),
        summary: words.slice(0, 85).join(' ') + (words.length > 85 ? '…' : '') }];
    });
    if (!articles.length) throw new Error();
    customResults.set(name, { articles, status: articles.length + ' stories' });
  } catch {
    customResults.set(name, { articles: customResults.get(name)?.articles ?? [], status: 'Feed unavailable in this browser · save links manually' });
  }
}
$('cancel-publisher').onclick = () => {
  $('add-publisher').hidden = true;
  $('source-filter').focus();
};
$('add-publisher').onsubmit = async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.publisherName.value.trim();
  const status = $('publisher-status');
  if (!name || [...builtInSources.map(({ source }) => source), ...state.publishers.map(({ name }) => name)]
    .some((item) => item.toLowerCase() === name.toLowerCase())) {
    status.textContent = 'Enter a new publisher name.';
    return;
  }
  const value = form.elements.feedUrl.value.trim();
  let feed = '';
  if (value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || !/\.[a-z]{2,}$/i.test(url.hostname) ||
      /\.(?:local|localhost|internal)$/i.test(url.hostname)) {
      status.textContent = 'Enter a public HTTPS RSS link.';
      return;
    }
    feed = url.href;
  }
  const publisher = { name, feed };
  state.publishers.push(publisher);
  store();
  form.reset();
  form.hidden = true;
  renderSources();
  $('source-filter').value = name;
  $('source-filter').focus();
  status.textContent = feed ? 'Publisher added. Checking its feed…' : 'Publisher added. Choose it when saving an article link.';
  renderArticles();
  if (feed) {
    await loadPublisher(publisher);
    status.textContent = customResults.get(name).status;
    renderSources();
    renderArticles();
  }
};
$('save-link').onsubmit = (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const url = new URL(data.get('url'));
  const title = data.get('title').trim();
  const field = form.elements.url;
  if (!['http:', 'https:'].includes(url.protocol)) {
    field.setCustomValidity('Use an HTTP or HTTPS link.');
    field.reportValidity();
    return;
  }
  if (!title) return;
  url.hash = '';
  state.saved = state.saved.filter((item) => item.url !== url.href);
  state.saved.unshift({ title, url: url.href, source: data.get('publisher') || url.hostname });
  form.reset();
  commit();
};
$('save-link').elements.url.oninput = (event) => event.target.setCustomValidity('');
$('add-group').onsubmit = (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const name = form.elements.group.value.trim();
  if (!name || state.groups.some((group) => group.toLowerCase() === name.toLowerCase())) return;
  state.groups.push(name);
  form.reset();
  commit();
};
$('add-contact').onsubmit = (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const name = data.get('name').trim();
  const email = data.get('email').trim().toLowerCase();
  if (!name) return;
  const groups = [...$('contact-groups').querySelectorAll('input:checked')].map((input) => input.value);
  state.contacts = state.contacts.filter((contact) => contact.email !== email);
  state.contacts.push({ name, email, groups });
  form.reset();
  commit();
};

async function refreshFeed() {
  $('refresh').disabled = true;
  $('feed-status').textContent = 'Checking publishers…';
  const custom = Promise.all(state.publishers.map(loadPublisher));
  try {
    const response = await fetch('/api/feed');
    if (!response.ok) throw new Error('Feed unavailable');
    const { articles, sources } = await response.json();
    builtInSources = sources;
    if (!articles.length) throw new Error('No articles');
    incoming = articles;
    $('feed-status').textContent = incoming.length + ' stories · ' + sources.filter(({ available }) => available).length + ' publishers available';
  } catch {
    if (!incoming.length) incoming = samples;
    $('feed-status').textContent = incoming === samples ? 'Live feed unavailable · showing sample articles' : 'Live feed unavailable · showing previously loaded articles';
  } finally {
    await custom;
    renderSources();
    $('refresh').disabled = false;
    renderArticles();
  }
}
$('refresh').onclick = refreshFeed;
const expandInbox = $('expand-inbox');
const workspace = $('editor-workspace');
function setInboxExpanded(expanded) {
  workspace.hidden = expanded;
  workspace.parentElement.classList.toggle('inbox-expanded', expanded);
  expandInbox.textContent = expanded ? 'Show split view' : 'Expand inbox';
  expandInbox.setAttribute('aria-pressed', String(expanded));
}
expandInbox.onclick = () => setInboxExpanded(!workspace.hidden);
for (const link of document.querySelectorAll('a[href="#draft"], a[href="#preview"], a[href="#audience"]')) {
  link.addEventListener('click', () => setInboxExpanded(false));
}
$('export-contacts').onclick = () => {
  const blob = new Blob([JSON.stringify({ groups: state.groups, contacts: state.contacts }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = el('a');
  link.href = url;
  link.download = 'news-desk-mailing-list.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('import-contacts').onclick = () => $('contacts-file').click();
function parseContactCsv(input) {
  const text = input.replace(/^\uFEFF/, '');
  const header = text.split(/\r?\n/, 1)[0];
  const delimiter = header.includes(',') ? ',' : header.includes(';') ? ';' : '\t';
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (quoted || !cell) quoted = !quoted;
      else cell += char;
    } else if (!quoted && (char === delimiter || char === '\n' || char === '\r')) {
      row.push(cell.trim());
      cell = '';
      if (char !== delimiter) {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (char === '\r' && text[index + 1] === '\n') index++;
      }
    } else cell += char;
  }
  if (quoted) throw new Error('Unclosed CSV field');
  if (cell || row.length) rows.push([...row, cell.trim()]);
  const headings = (rows.shift() ?? []).map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const emailColumns = headings.flatMap((key, index) => /^(?:primary|secondary)?email(?:[1-9])?(?:address|value)?$/.test(key) ? [index] : []);
  if (!emailColumns.length) throw new Error('Missing email column');
  const full = headings.findIndex((key) => ['name', 'fullname', 'displayname'].includes(key));
  const first = headings.findIndex((key) => ['firstname', 'givenname'].includes(key));
  const last = headings.findIndex((key) => ['lastname', 'familyname', 'surname'].includes(key));
  let skipped = 0;
  const contacts = rows.flatMap((record) => {
    const emails = emailColumns.map((index) => record[index]).filter((email) => email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    if (!emails.length) skipped++;
    const name = record[full] || [record[first], record[last]].filter(Boolean).join(' ');
    return emails.map((email) => ({ email, name: name || email, groups: [] }));
  });
  if (!contacts.length) throw new Error('No contacts with email addresses');
  return { groups: [], contacts, skipped };
}

$('contacts-file').onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const status = $('contacts-status');
  try {
    if (file.size > 2_000_000) throw new Error();
    const csv = /\.csv$/i.test(file.name);
    const text = await file.text();
    const { groups, contacts, skipped = 0 } = csv ? parseContactCsv(text) : JSON.parse(text);
    const validGroups = (list) => Array.isArray(list) &&
      list.every((name) => typeof name === 'string' && name.trim());
    if (!validGroups(groups) || !Array.isArray(contacts) || !contacts.every((contact) =>
      contact && typeof contact.name === 'string' && contact.name.trim() &&
      typeof contact.email === 'string' && /^[^\s@]+@[^\s@]+$/.test(contact.email) &&
      validGroups(contact.groups))) throw new Error();
    const groupNames = new Map(state.groups.map((name) => [name.toLowerCase(), name]));
    for (const name of [...groups, ...contacts.flatMap((contact) => contact.groups)]) {
      const clean = name.trim();
      if (!groupNames.has(clean.toLowerCase())) groupNames.set(clean.toLowerCase(), clean);
    }
    const countBefore = state.contacts.length;
    const existing = new Map(state.contacts.map((contact) => [contact.email.toLowerCase(), contact]));
    for (const contact of contacts) {
      const email = contact.email.toLowerCase();
      const previous = existing.get(email);
      const memberships = contact.groups.map((name) => groupNames.get(name.trim().toLowerCase()));
      existing.set(email, { name: previous?.name ?? contact.name.trim(), email,
        groups: [...new Set([...(previous?.groups ?? []), ...memberships])] });
    }
    state.groups = [...groupNames.values()];
    state.contacts = [...existing.values()];
    commit();
    const added = state.contacts.length - countBefore;
    status.textContent = added + ' new ' + (added === 1 ? 'contact' : 'contacts') + ' added.' +
      (skipped ? ' ' + skipped + (skipped === 1 ? ' row skipped' : ' rows skipped') + ' because no usable email address was found.' : '');
  } catch {
    status.textContent = 'Could not import contacts. Choose an Outlook CSV with email addresses or a News Desk export.';
  } finally {
    event.target.value = '';
  }
};
$('reader-close').onclick = () => $('reader').close();
$('reader').addEventListener('close', () => $('reader-page').removeAttribute('src'));
const navToggle = $('toggle-navigation');
function setNavigation(hidden) {
  $('desk-navigation').hidden = hidden;
  document.body.classList.toggle('nav-collapsed', hidden);
  navToggle.textContent = hidden ? 'Show sidebar' : 'Hide sidebar';
  navToggle.setAttribute('aria-expanded', String(!hidden));
}
setNavigation(localStorage.getItem('news-desk-sidebar-hidden') === 'true');
navToggle.onclick = () => {
  const hidden = !$('desk-navigation').hidden;
  setNavigation(hidden);
  localStorage.setItem('news-desk-sidebar-hidden', String(hidden));
};
$('similar-only').onchange = (event) => { state.similarOnly = event.target.checked; store(); renderArticles(); };
const today = new Date();
$('today').textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(today);
$('today').dateTime = new Intl.DateTimeFormat('sv-SE').format(today);
render();
renderSources();
refreshFeed();
