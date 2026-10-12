import { escapeHtml as esc, safeHref, sortedDates } from './data/view-utils.js';

let reportsByDate = {};
let launchesByMonth = {};
let selectedDate = '';
const calendarYear = new Date().getFullYear();
const calendarMonths = () => Array.from({ length: 12 }, (_, index) => `${calendarYear}-${String(index + 1).padStart(2, '0')}`);
let selectedMonth = `${calendarYear}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
let calendarMonth = selectedDate.slice(0, 7);
let detailOpener = null;
const reportStartDate = '2026-09-01';

function selectableDates() {
  return sortedDates(reportsByDate).filter(date => date >= reportStartDate);
}

const dateSelect = document.querySelector('#date-select');
const leadGrid = document.querySelector('#lead-grid');
const brandStories = document.querySelector('#brand-stories');
const brandJump = document.querySelector('#brand-jump');
const industryList = document.querySelector('#industry-list');
const layer = document.querySelector('#detail-layer');
const calendarToggle = document.querySelector('#calendar-toggle');
const calendarPopover = document.querySelector('#date-popover');
const calendarGrid = document.querySelector('#calendar-grid');
const calendarLabel = document.querySelector('#calendar-month-label');
const calendarSelectedLabel = document.querySelector('#calendar-selected-label');

function reportSummary(report) {
  const stories = [...report.highlights, ...(report.otherBrands || []), ...report.industry, ...Object.values(report.brands).flat()];
  const count = new Set(stories.map(story => story.id)).size;
  const updatedAt = new Date(report.updatedAt);
  const time = Number.isFinite(updatedAt.getTime())
    ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false }).format(updatedAt)
    : '';
  const latest = selectedDate === selectableDates()[0];
  const window = report.windowLabel ? `收录范围 ${report.windowLabel} · ` : '';
  return `${window}${latest ? '截至' : '本期归档'}${time ? ` ${time}` : ''} · 已收录 ${count} 条可追溯信息${latest ? ' · 来源持续更新' : ''}`;
}

function sourceLink(story) {
  const href = safeHref(story.sourceUrl);
  if (href) return `<a class="source-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(story.evidenceLabel || '来源')} · ${esc(story.sourceName)} ↗</a>`;
  return `<span class="source-link">来源：${esc(story.sourceName)}</span>`;
}

function tagMarkup(tags, className) {
  return tags.map(tag => `<span class="${className}">${esc(tag)}</span>`).join('');
}

function bindDetailTrigger(element, open) {
  element.addEventListener('click', event => {
    if (event.target.closest('.source-link')) return;
    open();
  });
  element.addEventListener('keydown', event => {
    if (event.target.closest('a')) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      open();
    }
  });
}

function openStoryDetail(story, dateLabel) {
  detailOpener = document.activeElement;
  document.querySelector('#detail-type').textContent = [story.evidenceLabel, ...story.tags].filter(Boolean).join(' · ');
  document.querySelector('#detail-title').textContent = story.title;
  document.querySelector('#detail-date').textContent = `${dateLabel} · 信息发布时间：${story.publishedAt}`;
  document.querySelector('#detail-summary').innerHTML = (story.details || story.detail.split('\n\n')).map(paragraph => `<p>${esc(paragraph)}</p>`).join('');
  const source = document.querySelector('#detail-source');
  source.textContent = `查看原始来源：${story.sourceName} ↗`;
  source.href = safeHref(story.sourceUrl) || '#';
  source.hidden = !safeHref(story.sourceUrl);
  source.target = '_blank';
  document.querySelector('#detail-other-sources').innerHTML = (story.sourceLinks || []).filter(item => item.url !== story.sourceUrl).map(item => `<a href="${esc(safeHref(item.url))}" target="_blank" rel="noopener noreferrer">${esc(item.label)} · ${esc(item.name)} ↗</a>`).join('');
  document.body.classList.add('detail-open');
  document.querySelector('main').inert = true;
  document.querySelector('.site-header').inert = true;
  layer.classList.add('open');
  layer.setAttribute('aria-hidden', 'false');
  document.querySelector('.detail-close').focus();
}

function closeDetail() {
  layer.classList.remove('open');
  layer.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('detail-open');
  document.querySelector('main').inert = false;
  document.querySelector('.site-header').inert = false;
  detailOpener?.focus();
}

function monthShift(monthKey, offset) {
  const [year, month] = monthKey.split('-').map(Number);
  const value = new Date(year, month - 1 + offset, 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`;
}

function renderDateCalendar() {
  const [year, month] = calendarMonth.split('-').map(Number);
  const allDates = sortedDates(reportsByDate);
  const availableDates = selectableDates();
  if (!allDates.length || !availableDates.length) return;
  const minMonth = allDates.at(-1).slice(0, 7);
  const maxMonth = availableDates[0].slice(0, 7);
  const firstOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  calendarLabel.textContent = `${year} 年 ${month} 月`;
  document.querySelector('#calendar-previous-month').disabled = calendarMonth <= minMonth;
  document.querySelector('#calendar-next-month').disabled = calendarMonth >= maxMonth;
  calendarGrid.innerHTML = `${'<span class="empty"></span>'.repeat(firstOffset)}${Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = `${calendarMonth}-${String(day).padStart(2, '0')}`;
    const hasReport = Boolean(reportsByDate[date]);
    const available = hasReport && date >= reportStartDate;
    return `<button class="calendar-day ${available ? 'available' : ''} ${hasReport && !available ? 'archived' : ''} ${date === selectedDate ? 'selected' : ''}" ${available ? `data-report-date="${date}"` : 'disabled'}>${day}</button>`;
  }).join('')}`;
  calendarGrid.querySelectorAll('[data-report-date]').forEach(button => button.addEventListener('click', () => {
    selectedDate = button.dataset.reportDate;
    calendarMonth = selectedDate.slice(0, 7);
    renderReport();
    closeCalendar();
  }));
}

function openCalendar() {
  calendarPopover.hidden = false;
  calendarToggle.setAttribute('aria-expanded', 'true');
  renderDateCalendar();
}

function closeCalendar() {
  calendarPopover.hidden = true;
  calendarToggle.setAttribute('aria-expanded', 'false');
}

function renderReport() {
  const report = reportsByDate[selectedDate];
  if (!report) return;
  const dates = selectableDates();
  document.querySelector('#previous-day').disabled = selectedDate === dates.at(-1);
  document.querySelector('#next-day').disabled = selectedDate === dates[0];
  dateSelect.value = selectedDate;
  calendarSelectedLabel.textContent = report.dateLabel;
  document.querySelector('#report-heading').textContent = `${report.dateLabel}，汽车行业发生了什么`;
  document.querySelector('#collection-summary').textContent = reportSummary(report);
  renderDateCalendar();
  leadGrid.innerHTML = report.highlights.length ? report.highlights.map((story, index) => `<article class="lead-card" data-lead-index="${index}" role="button" tabindex="0" aria-label="查看：${esc(story.title)}"><span class="tag-stack">${tagMarkup(story.tags, 'lead-type')}</span><div class="lead-content"><h3>${esc(story.title)}</h3><p>${esc(story.summary)}</p></div><span class="lead-source">${esc(story.evidenceLabel)}<br>${esc(story.sourceName)}</span></article>`).join('') : '<p class="empty-state">本期暂未收录重要摘要，可继续查看品牌与行业动态。</p>';

  const focusedBrands = Object.entries(report.brands);
  const brands = [...focusedBrands, ...((report.otherBrands || []).length ? [['其他品牌与车型', report.otherBrands]] : [])];
  document.querySelector('#brand-count').textContent = `${focusedBrands.length} 个重点品牌有更新`;
  brandJump.innerHTML = brands.map(([brand]) => `<button data-jump="brand-${esc(brand)}">${esc(brand)}</button>`).join('');
  brandStories.innerHTML = brands.length ? brands.map(([brand, stories]) => `<div class="brand-group" id="brand-${esc(brand)}"><div class="brand-label"><b>${esc(brand)}</b><span>${stories.length} 条更新</span></div><div>${stories.map(story => `<article class="detail-trigger" data-story-id="${esc(story.id)}" role="button" tabindex="0" aria-label="查看：${esc(story.title)}"><div class="story-content"><h3>${esc(story.title)}</h3><p>${esc(story.summary)}</p>${sourceLink(story)}</div></article>`).join('')}</div></div>`).join('') : '<p class="empty-state">本期暂未收录重点品牌新动态。来源未读到内容不等于品牌当天没有发布。</p>';
  industryList.innerHTML = report.industry.length ? report.industry.map(story => `<article class="industry-item detail-trigger" data-story-id="${esc(story.id)}" role="button" tabindex="0" aria-label="查看：${esc(story.title)}"><span class="tag-stack">${tagMarkup(story.tags, 'story-meta')}</span><h3>${esc(story.title)}</h3><p>${esc(story.summary)}</p>${sourceLink(story)}</article>`).join('') : '<p class="empty-state">本期暂未收录可追溯的行业动态。</p>';

  leadGrid.querySelectorAll('[data-lead-index]').forEach(card => bindDetailTrigger(card, () => openStoryDetail(report.highlights[Number(card.dataset.leadIndex)], report.dateLabel)));
  const storyIndex = new Map([...(report.otherBrands || []), ...report.industry, ...Object.values(report.brands).flat()].map(story => [story.id, story]));
  document.querySelectorAll('[data-story-id]').forEach(card => bindDetailTrigger(card, () => openStoryDetail(storyIndex.get(card.dataset.storyId), report.dateLabel)));
  brandJump.querySelectorAll('button').forEach(button => button.addEventListener('click', () => document.querySelector(`#${CSS.escape(button.dataset.jump)}`).scrollIntoView({ behavior: 'smooth' })));
}

function renderCalendar() {
  const months = calendarMonths().map(key => [key, `${Number(key.slice(5))}月`]);
  if (!calendarMonths().includes(selectedMonth)) selectedMonth = months[new Date().getMonth()][0];
  document.querySelector('#month-tabs').innerHTML = months.map(([key, label]) => `<button class="${key === selectedMonth ? 'active' : ''}" data-month="${key}">${label}</button>`).join('');
  const launches = launchesByMonth[selectedMonth] || [];
  document.querySelector('#car-table-body').innerHTML = launches.length ? launches.map(launch => `<tr class="detail-trigger" data-launch-id="${esc(launch.id)}" role="button" tabindex="0" aria-label="查看：${esc(launch.brand)} ${esc(launch.model)}"><td>${esc(launch.dateText)}</td><td><span class="car-name">${esc(launch.brand)} / ${esc(launch.model)}</span></td><td>${esc(launch.kind)}</td><td>${esc(launch.powertrain)}</td><td>${esc(launch.priceText)}</td><td><span class="status ${esc(launch.status)}">${esc(launch.statusLabel)}</span></td><td>${esc(launch.evidenceLabel)}<br>${esc(launch.sourceName)}</td></tr>`).join('') : '<tr><td colspan="7" class="empty-state">该月暂未收录可追溯的新车节点。</td></tr>';
  document.querySelectorAll('[data-month]').forEach(button => button.addEventListener('click', () => { selectedMonth = button.dataset.month; renderCalendar(); }));
  const launchIndex = new Map(launches.map(launch => [launch.id, launch]));
  document.querySelectorAll('[data-launch-id]').forEach(row => bindDetailTrigger(row, () => {
    const launch = launchIndex.get(row.dataset.launchId);
    openStoryDetail({ ...launch, tags: ['新车一览', launch.statusLabel], title: `${launch.brand} / ${launch.model}`, detail: `${launch.dateText} ${launch.statusLabel}。${launch.kind}，${launch.powertrain}，价格信息：${launch.priceText}。\n\n${launch.detail}` }, `${selectedMonth.replace('-', '年')}月`);
  }));
}

function setupDates() {
  dateSelect.innerHTML = selectableDates().map(key => `<option value="${key}">${esc(reportsByDate[key].dateLabel)}</option>`).join('');
  dateSelect.addEventListener('change', event => { selectedDate = event.target.value; calendarMonth = selectedDate.slice(0, 7); renderReport(); });
  document.querySelector('#previous-day').addEventListener('click', () => {
    const keys = selectableDates();
    const index = keys.indexOf(selectedDate);
    if (index < keys.length - 1) { selectedDate = keys[index + 1]; calendarMonth = selectedDate.slice(0, 7); renderReport(); }
  });
  document.querySelector('#next-day').addEventListener('click', () => {
    const keys = selectableDates();
    const index = keys.indexOf(selectedDate);
    if (index > 0) { selectedDate = keys[index - 1]; calendarMonth = selectedDate.slice(0, 7); renderReport(); }
  });
  calendarToggle.addEventListener('click', () => calendarPopover.hidden ? openCalendar() : closeCalendar());
  document.querySelector('#calendar-previous-month').addEventListener('click', () => { calendarMonth = monthShift(calendarMonth, -1); renderDateCalendar(); });
  document.querySelector('#calendar-next-month').addEventListener('click', () => { calendarMonth = monthShift(calendarMonth, 1); renderDateCalendar(); });
  document.addEventListener('click', event => { if (!document.querySelector('.date-picker').contains(event.target)) closeCalendar(); });
}

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('active', item === button));
  document.querySelectorAll('.view').forEach(item => item.classList.toggle('active', item.id === `${button.dataset.view}-view`));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}));
document.querySelectorAll('[data-close-detail]').forEach(element => element.addEventListener('click', closeDetail));
document.addEventListener('keydown', event => { if (event.key === 'Escape') { closeDetail(); closeCalendar(); } });

async function boot() {
  try {
    const response = await fetch('./runtime/generated-reports.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('日报数据暂时无法读取');
    reportsByDate = await response.json();
    if (!Object.keys(reportsByDate).length) throw new Error('日报正在整理中');
  } catch {
    document.querySelector('#collection-summary').textContent = '日报数据暂时无法读取，请稍后刷新。';
    calendarSelectedLabel.textContent = '暂无可用日报';
    calendarToggle.disabled = true;
    document.querySelector('#previous-day').disabled = true;
    document.querySelector('#next-day').disabled = true;
    leadGrid.innerHTML = '<p class="empty-state">日报加载失败，请刷新重试。</p>';
    renderCalendar();
    return;
  }
  try {
    const response = await fetch('./runtime/generated-launches.json', { cache: 'no-store' });
    if (response.ok) for (const launch of await response.json()) (launchesByMonth[launch.month || launch.date?.slice(0, 7)] ||= []).push(launch);
  } catch { /* The launch calendar can be empty while reports remain readable. */ }
  selectedDate = selectableDates()[0];
  calendarMonth = selectedDate.slice(0, 7);
  setupDates();
  renderReport();
  renderCalendar();
}

boot();
