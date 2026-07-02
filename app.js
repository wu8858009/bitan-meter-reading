/*
  碧潭商店街 水電瓦斯抄表系統 - Enterprise PRO
  純前端（無後端），資料以 localStorage 儲存。
*/

const STORAGE_KEY = 'bpt_meter_state_v2';
const COLUMN_PREFS_KEY = 'bpt_column_prefs_v1';
const SPIKE_RATIO = 2.5; // 用量超過歷史平均的倍數視為異常偏高
const ROLLOVER_MAX = { water: 10000, electric: 100000, gas: 100000 }; // 錶歸零進位上限（水表4位、電表5位）

let state = null;
let currentFilter = 'all'; // all | unfilled | anomaly
let searchKeyword = '';
let saveTimer = null;
let photoKeys = new Set(); // 本期已拍照存證的 `${rowId}_${type}` 集合
let thumbObjectUrls = [];
let previewObjectUrl = null;
let columnPrefs = loadColumnPrefs(); // 電腦版表格欄位顯示設定（僅存於本機瀏覽器，不隨備份匯出）

const TYPE_LABEL = { water: '水錶（度）', electric: '電錶（度）', gas: '瓦斯（KG）' };
const TYPE_SECTION_LABEL = { water: '水錶', electric: '電錶', gas: '瓦斯' };

/* ---------------- 拍照存證 ---------------- */

async function loadPhotoKeys() {
  try {
    photoKeys = await getPhotoKeysForPeriod(state.currentPeriod);
  } catch (err) {
    photoKeys = new Set();
  }
}

function revokeThumbUrls() {
  thumbObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  thumbObjectUrls = [];
}

async function loadPhotoThumbnails() {
  const imgs = document.querySelectorAll('.photo-thumb.has-photo');
  for (const img of imgs) {
    try {
      const blob = await getPhotoBlob(state.currentPeriod, img.dataset.row, img.dataset.type);
      if (!blob) continue;
      const url = URL.createObjectURL(blob);
      thumbObjectUrls.push(url);
      img.src = url;
      img.style.display = '';
    } catch (err) { /* 縮圖載入失敗不影響操作 */ }
  }
}

async function openPhotoPreview(rowId, type) {
  try {
    const blob = await getPhotoBlob(state.currentPeriod, rowId, type);
    if (!blob) return;
    if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = URL.createObjectURL(blob);
    document.getElementById('photoPreviewImg').src = previewObjectUrl;
    openModal('photoPreviewModal');
  } catch (err) {
    toast('照片載入失敗，請再試一次');
  }
}

function photoControlHtml(rowId, type) {
  const hasPhoto = photoKeys.has(`${rowId}_${type}`);
  return `
    <div class="photo-control">
      <img class="photo-thumb${hasPhoto ? ' has-photo' : ''}" data-row="${rowId}" data-type="${type}" style="display:none" alt="錶照片" />
      <button type="button" class="btn-photo" data-row="${rowId}" data-type="${type}">${hasPhoto ? '重拍' : '📷 拍照存證'}</button>
      <input type="file" accept="image/*" capture="environment" class="photo-file-input" data-row="${rowId}" data-type="${type}" hidden />
    </div>`;
}

/* ---------------- 掃碼填入錶號 ---------------- */

let html5QrCode = null;
let scanTargetInput = null;

function startScanner(targetInput) {
  if (typeof Html5Qrcode === 'undefined') {
    toast('掃碼功能載入失敗，請檢查網路連線');
    return;
  }
  scanTargetInput = targetInput;
  document.getElementById('scanOverlay').classList.add('open');

  html5QrCode = new Html5Qrcode('reader');
  const config = { fps: 15, qrbox: { width: 280, height: 200 }, aspectRatio: 1.0 };

  html5QrCode.start(
    { facingMode: 'environment' },
    config,
    (decodedText) => {
      if (scanTargetInput) {
        scanTargetInput.value = decodedText;
        scanTargetInput.dispatchEvent(new Event('input', { bubbles: true }));
        scanTargetInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (navigator.vibrate) navigator.vibrate(100);
      stopScanner();
    },
    () => { /* 忽略掃描過程中的一般辨識失敗 */ }
  ).catch((err) => {
    console.error('相機啟動失敗', err);
    toast('無法啟動相機，請檢查本機相機權限設定');
    document.getElementById('scanOverlay').classList.remove('open');
  });
}

function stopScanner() {
  const overlay = document.getElementById('scanOverlay');
  if (html5QrCode && html5QrCode.isScanning) {
    html5QrCode.stop().then(() => {
      overlay.classList.remove('open');
      html5QrCode.clear();
      html5QrCode = null;
    }).catch(() => {
      overlay.classList.remove('open');
    });
  } else {
    overlay.classList.remove('open');
  }
  scanTargetInput = null;
}

/* ---------------- 工具函式 ---------------- */

function hasMeter(slot) {
  return !!slot && slot.present === true;
}

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function fmtNum(n) {
  if (n === null || n === undefined) return '';
  return String(n);
}

function fmtMoney(n) {
  if (!Number.isFinite(n)) return '-';
  return n.toLocaleString('zh-TW', { maximumFractionDigits: 0 });
}

function periodLabel(period) {
  const [y, m] = period.split('-');
  return `${y}年${Number(m)}月`;
}

function nextPeriodKey(period) {
  const [y, m] = period.split('-').map(Number);
  let ny = y, nm = m + 1;
  if (nm > 12) { nm = 1; ny += 1; }
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

function sortedPeriods() {
  return Object.keys(state.periods).sort();
}

function debounceSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 250);
}

/* ---------------- 狀態建立 / 儲存 / 載入 ---------------- */

function buildInitialState() {
  const rows = METER_ROWS_SEED.map((seed, idx) => {
    const row = { id: `r${idx + 1}`, group: seed.group || '', name: seed.name || '', labelColor: seed.labelColor || null };
    ['water', 'electric', 'gas'].forEach((type) => {
      const s = seed[type];
      if (!s) { row[type] = null; return; }
      const present = ('meterNo' in s) || ('last' in s);
      const def = { present };
      if ('meterNo' in s) def.meterNo = s.meterNo;
      if ('note' in s) def.note = s.note;
      row[type] = def;
    });
    return row;
  });

  const readings = {};
  rows.forEach((row) => {
    readings[row.id] = {};
    ['water', 'electric', 'gas'].forEach((type) => {
      const seedSlot = METER_ROWS_SEED[rows.indexOf(row)][type];
      if (hasMeter(row[type])) {
        readings[row.id][type] = { last: seedSlot && 'last' in seedSlot ? seedSlot.last : null, this: null };
      }
    });
  });

  return {
    version: 2,
    rows,
    prices: { ...DEFAULT_PRICES },
    currentPeriod: INITIAL_PERIOD,
    periods: {
      [INITIAL_PERIOD]: { readingDate: '', readings }
    }
  };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return buildInitialState();
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.rows || !parsed.periods) return buildInitialState();
    return parsed;
  } catch {
    return buildInitialState();
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function defaultColumnPrefs() {
  return { water: true, electric: true, gas: true, meterNo: true, last: true, usage: true };
}

function loadColumnPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(COLUMN_PREFS_KEY));
    return raw ? { ...defaultColumnPrefs(), ...raw } : defaultColumnPrefs();
  } catch {
    return defaultColumnPrefs();
  }
}

function saveColumnPrefs() {
  localStorage.setItem(COLUMN_PREFS_KEY, JSON.stringify(columnPrefs));
}

function ensureReadingSlots() {
  // 確保每個期別對每一列的每個「有錶」欄位都存在 reading 物件（新增項目後補齊用）
  Object.keys(state.periods).forEach((period) => {
    const p = state.periods[period];
    state.rows.forEach((row) => {
      if (!p.readings[row.id]) p.readings[row.id] = {};
      ['water', 'electric', 'gas'].forEach((type) => {
        if (hasMeter(row[type]) && !p.readings[row.id][type]) {
          p.readings[row.id][type] = { last: null, this: null };
        }
      });
    });
  });
}

/* ---------------- 計算 ---------------- */

function computeUsage(last, thisVal) {
  if (last === null || last === undefined || thisVal === null || thisVal === undefined) return null;
  return thisVal - last;
}

function computeCost(type, usage) {
  if (usage === null || usage === undefined) return null;
  const price = state.prices[type] || 0;
  if (!price) return null;
  return usage * price;
}

function historicalAvgUsage(rowId, type, beforePeriod) {
  const periods = sortedPeriods().filter((p) => p < beforePeriod);
  const usages = [];
  periods.forEach((p) => {
    const r = state.periods[p].readings[rowId]?.[type];
    if (!r) return;
    const u = computeUsage(r.last, r.this);
    if (u !== null) usages.push(u);
  });
  if (!usages.length) return null;
  return usages.reduce((a, b) => a + b, 0) / usages.length;
}

function cellStatus(row, type) {
  const slot = row[type];
  if (!hasMeter(slot)) return { status: 'na' };
  const period = state.currentPeriod;
  const reading = state.periods[period].readings[row.id]?.[type] || { last: null, this: null };
  const usage = computeUsage(reading.last, reading.this);

  if (reading.this === null) return { status: 'unfilled', reading, usage };
  if (usage !== null && usage < 0) {
    // 本月度數小於上月度數：先檢查是否為錶歸零進位（本月度數看起來像剛歸零重新起算的原始錶面讀數），
    // 而不是直接當成資料異常。若像進位，顯示提醒讓使用者人工確認後套用修正值。
    const rolloverMax = ROLLOVER_MAX[type];
    if (rolloverMax && reading.this < rolloverMax) {
      // 進位次數：足以讓修正後的度數大於上月度數（通常是 1 次，但上月度數若已經
      // 是先前修正過的大數字，可能需要多次進位才會追上）
      const cycles = Math.floor(reading.last / rolloverMax) + 1;
      const correctedThis = reading.this + cycles * rolloverMax;
      return { status: 'rollover', reading, usage: correctedThis - reading.last, correctedThis };
    }
    return { status: 'negative', reading, usage };
  }

  const avg = historicalAvgUsage(row.id, type, period);
  if (avg !== null && avg > 0 && usage !== null && usage > avg * SPIKE_RATIO) {
    return { status: 'spike', reading, usage, avg };
  }
  return { status: 'ok', reading, usage };
}

/* ---------------- 渲染：統計卡片 ---------------- */

function renderStats() {
  const period = state.currentPeriod;
  const readings = state.periods[period].readings;
  let unfilled = 0, anomaly = 0;
  const totals = { water: 0, electric: 0, gas: 0 };
  const costs = { water: 0, electric: 0, gas: 0 };

  state.rows.forEach((row) => {
    ['water', 'electric', 'gas'].forEach((type) => {
      if (!hasMeter(row[type])) return;
      const st = cellStatus(row, type);
      if (st.status === 'unfilled') unfilled++;
      if (st.status === 'negative' || st.status === 'spike' || st.status === 'rollover') anomaly++;
      if (st.usage !== null && st.usage !== undefined) {
        totals[type] += st.usage;
        const cost = computeCost(type, st.usage);
        if (cost !== null) costs[type] += cost;
      }
    });
  });

  const totalCost = costs.water + costs.electric + costs.gas;

  document.getElementById('statUnfilled').textContent = unfilled;
  document.getElementById('statAnomaly').textContent = anomaly;
  document.getElementById('statUsage').innerHTML =
    `水 ${fmtNum(totals.water)} 度・電 ${fmtNum(totals.electric)} 度・瓦斯 ${fmtNum(totals.gas)} KG`;
  document.getElementById('statCost').textContent = totalCost ? `NT$ ${fmtMoney(totalCost)}` : '未設定單價';
}

/* ---------------- 渲染：主表格 ---------------- */

function relevantTypes(row) {
  return ['water', 'electric', 'gas'].filter((t) => hasMeter(row[t]));
}

function rowMatchesFilter(row) {
  const types = relevantTypes(row);
  if (!types.length) return false;

  if (searchKeyword) {
    const kw = searchKeyword.toLowerCase();
    const hay = `${row.group} ${row.name}`.toLowerCase();
    if (!hay.includes(kw)) return false;
  }
  if (currentFilter === 'all') return true;
  if (currentFilter === 'unfilled') {
    return types.some((t) => cellStatus(row, t).status === 'unfilled');
  }
  if (currentFilter === 'anomaly') {
    return types.some((t) => ['negative', 'spike', 'rollover'].includes(cellStatus(row, t).status));
  }
  return true;
}

function cardMatchesFilter(row, type) {
  if (!hasMeter(row[type])) return false;
  if (searchKeyword) {
    const kw = searchKeyword.toLowerCase();
    const hay = `${row.group} ${row.name}`.toLowerCase();
    if (!hay.includes(kw)) return false;
  }
  if (currentFilter === 'all') return true;
  const status = cellStatus(row, type).status;
  if (currentFilter === 'unfilled') return status === 'unfilled';
  if (currentFilter === 'anomaly') return status === 'negative' || status === 'spike' || status === 'rollover';
  return true;
}

function statusClassOf(status) {
  if (status === 'unfilled') return 'cell-unfilled';
  if (status === 'negative') return 'cell-negative';
  if (status === 'spike') return 'cell-spike';
  if (status === 'rollover') return 'cell-rollover';
  return '';
}

function usageInnerHtml(st, cost, rowId, type) {
  return `
      <div class="usage-val">${st.usage === null ? '-' : fmtNum(st.usage)}</div>
      ${cost !== null ? `<div class="cost-val">NT$ ${fmtMoney(cost)}</div>` : ''}
      ${st.status === 'spike' ? '<div class="badge-warn">用量偏高</div>' : ''}
      ${st.status === 'negative' ? '<div class="badge-error">度數異常</div>' : ''}
      ${st.status === 'rollover' ? `
        <div class="badge-rollover">⚠ 疑似錶歸零進位</div>
        <button type="button" class="btn-apply-rollover" data-row="${rowId}" data-type="${type}" data-corrected="${st.correctedThis}">套用進位（→${fmtNum(st.correctedThis)}）</button>
      ` : ''}
  `;
}

function visibleSubcols(type) {
  const cols = [];
  if (type !== 'water' && columnPrefs.meterNo) cols.push('meterNo');
  if (columnPrefs.last) cols.push('last');
  cols.push('this');
  if (columnPrefs.usage) cols.push('usage');
  return cols;
}

function meterCellHtml(row, type) {
  if (!columnPrefs[type]) return '';
  const cols = visibleSubcols(type);
  const slot = row[type];

  if (!hasMeter(slot)) {
    const note = slot && slot.note ? `<div class="note-text">${escapeHtml(slot.note)}</div>` : '';
    return `<td class="hatch" colspan="${cols.length}">${note}</td>`;
  }

  const st = cellStatus(row, type);
  const reading = st.reading;
  const cost = computeCost(type, st.usage);
  const statusClass = statusClassOf(st.status);
  const editable = isAdmin();

  return cols.map((col) => {
    if (col === 'meterNo') {
      return `<td class="meter-no-cell">
        <input type="text" class="cell-input meter-no-input" value="${escapeHtml(slot.meterNo || '')}"
          ${editable ? '' : 'readonly'}
          data-row="${row.id}" data-type="${type}" data-field="meterNo" />
        ${slot.note ? `<div class="note-text">${escapeHtml(slot.note)}</div>` : ''}
      </td>`;
    }
    if (col === 'last') {
      return `<td class="last-cell">
        <input type="text" inputmode="decimal" class="cell-input last-input" value="${fmtNum(reading.last)}"
          ${editable ? '' : 'readonly'}
          data-row="${row.id}" data-type="${type}" data-field="last" />
      </td>`;
    }
    if (col === 'this') {
      return `<td class="this-cell field-this ${statusClass}" data-row="${row.id}" data-type="${type}">
        <div class="this-input-row">
          <input type="text" inputmode="decimal" class="cell-input this-input" value="${fmtNum(reading.this)}"
            placeholder="待填"
            data-row="${row.id}" data-type="${type}" data-field="this" />
          ${photoControlHtml(row.id, type)}
        </div>
      </td>`;
    }
    return `<td class="usage-cell usage-display ${statusClass}" data-row="${row.id}" data-type="${type}">${usageInnerHtml(st, cost, row.id, type)}</td>`;
  }).join('');
}

function meterCardBlock(row, type) {
  const slot = row[type];
  if (!hasMeter(slot)) {
    if (!slot || !slot.note) return '';
    return `<div class="card-meter card-meter-na"><span class="card-meter-label">${TYPE_LABEL[type]}</span><span class="note-text">${escapeHtml(slot.note)}</span></div>`;
  }

  const st = cellStatus(row, type);
  const reading = st.reading;
  const cost = computeCost(type, st.usage);
  const statusClass = statusClassOf(st.status);
  const editable = isAdmin();

  const meterNoField = type === 'water' ? '' : `
    <div class="card-field-full">
      <label>${type === 'electric' ? '電表號碼' : '瓦斯錶號'}</label>
      <input type="text" class="cell-input meter-no-input" value="${escapeHtml(slot.meterNo || '')}"
        ${editable ? '' : 'readonly'}
        data-row="${row.id}" data-type="${type}" data-field="meterNo" />
      ${slot.note ? `<div class="note-text">${escapeHtml(slot.note)}</div>` : ''}
    </div>`;

  return `
    <div class="card-meter">
      <div class="card-meter-label">${TYPE_LABEL[type]}</div>
      ${meterNoField}
      <div class="card-meter-grid">
        <div class="card-field">
          <label>上月度數</label>
          <input type="text" inputmode="decimal" class="cell-input last-input" value="${fmtNum(reading.last)}"
            ${editable ? '' : 'readonly'}
            data-row="${row.id}" data-type="${type}" data-field="last" />
        </div>
        <div class="card-field field-this ${statusClass}" data-row="${row.id}" data-type="${type}">
          <label>本月度數</label>
          <div class="this-input-row">
            <input type="text" inputmode="decimal" class="cell-input this-input" value="${fmtNum(reading.this)}"
              placeholder="待填"
              data-row="${row.id}" data-type="${type}" data-field="this" />
            ${photoControlHtml(row.id, type)}
          </div>
        </div>
      </div>
      <div class="card-usage usage-display ${statusClass}" data-row="${row.id}" data-type="${type}">${usageInnerHtml(st, cost, row.id, type)}</div>
    </div>`;
}

function cardHtmlForType(row, type) {
  const block = meterCardBlock(row, type);
  if (!block) return '';
  const nameColorClass = row.labelColor ? `label-${row.labelColor}` : '';
  return `
    <div class="card-head">
      <div class="card-title">
        ${row.group ? `<span class="card-group">${escapeHtml(row.group)}</span>` : ''}
        <span class="card-name ${nameColorClass}">${escapeHtml(row.name) || '（未命名項目）'}</span>
      </div>
      <button type="button" class="link-btn history-btn" data-row="${row.id}" title="歷史紀錄">歷程</button>
    </div>
    ${block}`;
}

const SUBCOL_LABEL = { last: '上月度數', this: '本月度數', usage: '用量' };

function subcolLabel(type, col) {
  if (col === 'meterNo') return type === 'electric' ? '電表號碼' : '瓦斯錶號';
  return SUBCOL_LABEL[col];
}

function renderTableHead() {
  const thead = document.getElementById('tableHead');
  const types = ['water', 'electric', 'gas'].filter((t) => columnPrefs[t]);

  const groupRow = types.map((t) => `<th colspan="${visibleSubcols(t).length}">${TYPE_LABEL[t]}</th>`).join('');
  const subRow = types.map((t) => visibleSubcols(t).map((c) => `<th>${subcolLabel(t, c)}</th>`).join('')).join('');

  thead.innerHTML = `
    <tr>
      <th rowspan="2" class="sticky-col" style="left:0">門市</th>
      <th rowspan="2" class="sticky-col" style="left:56px">項目名稱</th>
      ${groupRow}
    </tr>
    <tr>${subRow}</tr>`;
}

function buildRowCellsHtml(row) {
  return meterCellHtml(row, 'water') + meterCellHtml(row, 'electric') + meterCellHtml(row, 'gas');
}

function renderTable() {
  renderTableHead();

  const tbody = document.getElementById('tableBody');
  const cardList = document.getElementById('cardList');
  tbody.innerHTML = '';
  cardList.innerHTML = '';

  let bandToggle = false;
  let lastGroup = null;

  state.rows.forEach((row) => {
    if (!rowMatchesFilter(row)) return;

    if (row.group) {
      if (row.group !== lastGroup) { bandToggle = !bandToggle; lastGroup = row.group; }
    }
    const tr = document.createElement('tr');
    tr.className = bandToggle ? 'band-a' : 'band-b';

    const nameColorClass = row.labelColor ? `label-${row.labelColor}` : '';

    tr.innerHTML = `
      <td class="sticky-col group-cell">${escapeHtml(row.group)}</td>
      <td class="sticky-col name-cell ${nameColorClass}">
        <span class="row-name">${escapeHtml(row.name)}</span>
        <button type="button" class="link-btn history-btn" data-row="${row.id}" title="歷史紀錄">歷程</button>
      </td>
      ${buildRowCellsHtml(row)}
    `;
    tbody.appendChild(tr);
  });

  let totalCards = 0;
  ['water', 'electric', 'gas'].forEach((type) => {
    const rowsForType = state.rows.filter((row) => cardMatchesFilter(row, type));
    if (!rowsForType.length) return;
    totalCards += rowsForType.length;

    const section = document.createElement('div');
    section.className = 'card-section';
    section.id = `cardSection-${type}`;

    const heading = document.createElement('div');
    heading.className = `card-section-heading type-${type}`;
    heading.textContent = TYPE_SECTION_LABEL[type];
    section.appendChild(heading);

    rowsForType.forEach((row) => {
      const card = document.createElement('div');
      card.className = `meter-card type-${type}`;
      card.innerHTML = cardHtmlForType(row, type);
      section.appendChild(card);
    });

    cardList.appendChild(section);
  });

  if (!totalCards) {
    cardList.innerHTML = '<div class="card-empty">沒有符合條件的項目</div>';
  }

  renderFooterTotals();
  revokeThumbUrls();
  loadPhotoThumbnails();
}

function renderFooterTotals() {
  const totals = { water: 0, electric: 0, gas: 0 };
  const costs = { water: 0, electric: 0, gas: 0 };

  state.rows.forEach((row) => {
    ['water', 'electric', 'gas'].forEach((type) => {
      if (!hasMeter(row[type])) return;
      const st = cellStatus(row, type);
      if (st.usage !== null && st.usage !== undefined) {
        totals[type] += st.usage;
        const c = computeCost(type, st.usage);
        if (c !== null) costs[type] += c;
      }
    });
  });

  const cellHtml = (type) => `<div>${fmtNum(totals[type])}</div><div class="cost-val" style="color:#fff">${costs[type] ? `NT$ ${fmtMoney(costs[type])}` : ''}</div>`;
  const tfoot = document.getElementById('tableFoot');

  const types = ['water', 'electric', 'gas'].filter((t) => columnPrefs[t]);
  const typeCellsHtml = types.map((type) => visibleSubcols(type)
    .map((col) => (col === 'this' ? `<td>${cellHtml(type)}</td>` : '<td></td>'))
    .join('')).join('');

  tfoot.innerHTML = `
    <tr>
      <td class="sticky-col" style="left:0" colspan="2">合計</td>
      ${typeCellsHtml}
    </tr>`;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

/* ---------------- 期別控制 ---------------- */

function renderPeriodControls() {
  const sel = document.getElementById('periodSelect');
  const periods = sortedPeriods();
  sel.innerHTML = periods.map((p) => `<option value="${p}" ${p === state.currentPeriod ? 'selected' : ''}>${periodLabel(p)}</option>`).join('');

  document.getElementById('readingDateInput').value = state.periods[state.currentPeriod].readingDate || '';
}

async function switchPeriod(period) {
  state.currentPeriod = period;
  saveState();
  await loadPhotoKeys();
  renderAll();
}

async function createNextPeriod() {
  const cur = state.currentPeriod;
  const next = nextPeriodKey(cur);
  if (state.periods[next]) {
    await switchPeriod(next);
    toast(`已切換至 ${periodLabel(next)}（該期別已存在）`);
    return;
  }
  const curReadings = state.periods[cur].readings;
  const newReadings = {};
  state.rows.forEach((row) => {
    newReadings[row.id] = {};
    ['water', 'electric', 'gas'].forEach((type) => {
      if (!hasMeter(row[type])) return;
      const prev = curReadings[row.id]?.[type] || { last: null, this: null };
      const carriedLast = prev.this !== null && prev.this !== undefined ? prev.this : prev.last;
      newReadings[row.id][type] = { last: carriedLast ?? null, this: null };
    });
  });
  state.periods[next] = { readingDate: '', readings: newReadings };
  state.currentPeriod = next;
  saveState();
  await loadPhotoKeys();
  renderAll();
  toast(`已建立 ${periodLabel(next)}，上月度數已自動帶入`);
}

/* ---------------- 進位補正 ---------------- */

function applyRolloverCorrection(rowId, type) {
  const row = state.rows.find((r) => r.id === rowId);
  if (!row) return;
  const st = cellStatus(row, type);
  if (st.status !== 'rollover') return; // 畫面重繪後狀態可能已改變，避免套用到過期的修正值

  const reading = state.periods[state.currentPeriod].readings[rowId][type];
  reading.this = st.correctedThis;
  saveState();
  refreshRowDisplay(row, null);
  renderStats();
  renderFooterTotals();
  toast(`已套用進位補正，本月度數更新為 ${fmtNum(st.correctedThis)}`);
}

/* ---------------- 事件處理：表格輸入 ---------------- */

function handleTableInput(e) {
  const input = e.target;
  if (!input.matches('.cell-input')) return;
  const rowId = input.dataset.row;
  const type = input.dataset.type;
  const field = input.dataset.field;
  const row = state.rows.find((r) => r.id === rowId);
  if (!row) return;
  if (field !== 'this' && !isAdmin()) return; // 上月度數／錶號僅管理員可編輯

  if (field === 'meterNo') {
    row[type].meterNo = input.value;
    document.querySelectorAll(`.meter-no-input[data-row="${rowId}"][data-type="${type}"]`).forEach((el) => {
      if (el !== input) el.value = input.value;
    });
    debounceSave();
    return;
  }

  const reading = state.periods[state.currentPeriod].readings[rowId][type];
  reading[field] = toNum(input.value);
  debounceSave();

  // 即時更新該列（表格與手機卡片）用量/狀態顯示，不整表重繪以維持輸入焦點
  refreshRowDisplay(row, input);
  renderStats();
  renderFooterTotals();
}

function refreshRowDisplay(row, activeInput) {
  ['water', 'electric', 'gas'].forEach((type) => {
    if (!hasMeter(row[type])) return;
    const st = cellStatus(row, type);
    const cost = computeCost(type, st.usage);
    const statusClass = statusClassOf(st.status);

    ['last', 'this'].forEach((field) => {
      const val = field === 'last' ? st.reading.last : st.reading.this;
      document.querySelectorAll(`.${field}-input[data-row="${row.id}"][data-type="${type}"]`).forEach((inp) => {
        if (inp !== activeInput) inp.value = fmtNum(val);
      });
    });

    document.querySelectorAll(`.field-this[data-row="${row.id}"][data-type="${type}"], .usage-display[data-row="${row.id}"][data-type="${type}"]`).forEach((el) => {
      el.classList.remove('cell-unfilled', 'cell-negative', 'cell-spike', 'cell-rollover');
      if (statusClass) el.classList.add(statusClass);
    });

    document.querySelectorAll(`.usage-display[data-row="${row.id}"][data-type="${type}"]`).forEach((el) => {
      el.innerHTML = usageInnerHtml(st, cost, row.id, type);
    });
  });
}

/* ---------------- 歷史紀錄 modal ---------------- */

function openHistoryModal(rowId) {
  const row = state.rows.find((r) => r.id === rowId);
  if (!row) return;
  const periods = sortedPeriods();
  const typeLabel = { water: '水錶(度)', electric: '電錶(度)', gas: '瓦斯(KG)' };

  let rowsHtml = '';
  periods.forEach((p) => {
    const cells = ['water', 'electric', 'gas'].map((type) => {
      if (!hasMeter(row[type])) return '<td>-</td><td>-</td><td>-</td>';
      const r = state.periods[p].readings[row.id]?.[type] || { last: null, this: null };
      const usage = computeUsage(r.last, r.this);
      return `<td>${fmtNum(r.last)}</td><td>${fmtNum(r.this)}</td><td>${usage === null ? '-' : fmtNum(usage)}</td>`;
    }).join('');
    rowsHtml += `<tr><td>${periodLabel(p)}</td>${cells}</tr>`;
  });

  const typesPresent = ['water', 'electric', 'gas'].filter((t) => hasMeter(row[t]));
  const headCols = typesPresent.length
    ? ['water', 'electric', 'gas'].map((t) => hasMeter(row[t]) ? `<th colspan="3">${typeLabel[t]}</th>` : '<th colspan="3">-</th>').join('')
    : '';

  document.getElementById('historyTitle').textContent = `${row.group ? row.group + ' ' : ''}${row.name || '(未命名項目)'} - 歷史紀錄`;
  document.getElementById('historyTableWrap').innerHTML = `
    <table class="history-table">
      <thead>
        <tr><th rowspan="2">期別</th>${headCols}</tr>
        <tr>${['water', 'electric', 'gas'].map(() => '<th>上月</th><th>本月</th><th>用量</th>').join('')}</tr>
      </thead>
      <tbody>${rowsHtml || '<tr><td colspan="10">尚無資料</td></tr>'}</tbody>
    </table>
  `;
  openModal('historyModal');
}

/* ---------------- 單價設定 modal ---------------- */

function openPriceModal() {
  document.getElementById('priceWater').value = state.prices.water || '';
  document.getElementById('priceElectric').value = state.prices.electric || '';
  document.getElementById('priceGas').value = state.prices.gas || '';
  openModal('priceModal');
}

function savePrices() {
  state.prices.water = toNum(document.getElementById('priceWater').value) || 0;
  state.prices.electric = toNum(document.getElementById('priceElectric').value) || 0;
  state.prices.gas = toNum(document.getElementById('priceGas').value) || 0;
  saveState();
  closeModal('priceModal');
  renderAll();
  toast('單價設定已更新');
}

/* ---------------- 欄位顯示設定 modal ---------------- */

const COLUMN_PREF_CHECKBOX_IDS = {
  water: 'colWater',
  electric: 'colElectric',
  gas: 'colGas',
  meterNo: 'colMeterNo',
  last: 'colLast',
  usage: 'colUsage',
};

function openColumnPrefsModal() {
  Object.entries(COLUMN_PREF_CHECKBOX_IDS).forEach(([key, id]) => {
    document.getElementById(id).checked = columnPrefs[key];
  });
  openModal('columnPrefsModal');
}

function saveColumnPrefsFromModal() {
  Object.entries(COLUMN_PREF_CHECKBOX_IDS).forEach(([key, id]) => {
    columnPrefs[key] = document.getElementById(id).checked;
  });
  saveColumnPrefs();
  closeModal('columnPrefsModal');
  renderTable();
  toast('欄位顯示設定已更新');
}

function resetColumnPrefsModal() {
  const defaults = defaultColumnPrefs();
  Object.entries(COLUMN_PREF_CHECKBOX_IDS).forEach(([key, id]) => {
    document.getElementById(id).checked = defaults[key];
  });
}

/* ---------------- 抄表項目管理 modal ---------------- */

function openManageModal() {
  renderManageTable();
  openModal('manageModal');
}

function renderManageTable() {
  const wrap = document.getElementById('manageTableWrap');
  const rowsHtml = state.rows.map((row, idx) => `
    <tr data-row="${row.id}">
      <td><input type="text" class="mg-input mg-group" value="${escapeHtml(row.group)}" /></td>
      <td><input type="text" class="mg-input mg-name" value="${escapeHtml(row.name)}" /></td>
      <td>
        <select class="mg-input mg-color">
          <option value="" ${!row.labelColor ? 'selected' : ''}>一般</option>
          <option value="blue" ${row.labelColor === 'blue' ? 'selected' : ''}>藍字</option>
          <option value="cyan" ${row.labelColor === 'cyan' ? 'selected' : ''}>青字</option>
        </select>
      </td>
      <td class="mg-check"><input type="checkbox" class="mg-has-water" ${hasMeter(row.water) ? 'checked' : ''} /></td>
      <td class="mg-check"><input type="checkbox" class="mg-has-electric" ${hasMeter(row.electric) ? 'checked' : ''} /></td>
      <td>
        <div class="mg-scan-cell">
          <input type="text" class="mg-input mg-elec-no" value="${escapeHtml(row.electric?.meterNo || '')}" placeholder="電錶號碼" />
          <button type="button" class="mg-scan-btn" title="掃碼填入電錶號碼">📷</button>
        </div>
      </td>
      <td class="mg-check"><input type="checkbox" class="mg-has-gas" ${hasMeter(row.gas) ? 'checked' : ''} /></td>
      <td>
        <div class="mg-scan-cell">
          <input type="text" class="mg-input mg-gas-no" value="${escapeHtml(row.gas?.meterNo || '')}" placeholder="瓦斯錶號" />
          <button type="button" class="mg-scan-btn" title="掃碼填入瓦斯錶號">📷</button>
        </div>
      </td>
      <td><button type="button" class="btn-danger-mini mg-delete" data-idx="${idx}">刪除</button></td>
    </tr>
  `).join('');

  wrap.innerHTML = `
    <table class="manage-table">
      <thead>
        <tr>
          <th>門市代號</th><th>項目名稱</th><th>字色</th>
          <th>水錶</th><th>電錶</th><th>電錶號碼</th>
          <th>瓦斯</th><th>瓦斯錶號</th><th></th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
  `;

  wrap.querySelectorAll('.mg-delete').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.idx);
      if (!confirm('確定刪除此抄表項目？（將移除所有期別中此項目的資料）')) return;
      const removed = state.rows.splice(idx, 1)[0];
      Object.values(state.periods).forEach((p) => delete p.readings[removed.id]);
      renderManageTable();
    });
  });

  wrap.querySelectorAll('.mg-scan-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetInput = btn.previousElementSibling;
      startScanner(targetInput);
    });
  });
}

function addManageRow() {
  const newId = `r${Date.now()}`;
  state.rows.push({ id: newId, group: '', name: '', labelColor: null, water: null, electric: null, gas: null });
  ensureReadingSlots();
  renderManageTable();
}

function saveManageTable() {
  const wrap = document.getElementById('manageTableWrap');
  const trs = wrap.querySelectorAll('tbody tr');
  trs.forEach((tr) => {
    const rowId = tr.dataset.row;
    const row = state.rows.find((r) => r.id === rowId);
    if (!row) return;
    row.group = tr.querySelector('.mg-group').value.trim();
    row.name = tr.querySelector('.mg-name').value.trim();
    row.labelColor = tr.querySelector('.mg-color').value || null;

    const hasWater = tr.querySelector('.mg-has-water').checked;
    row.water = hasWater ? { ...(row.water || {}), present: true } : null;

    const hasElectric = tr.querySelector('.mg-has-electric').checked;
    const elecNo = tr.querySelector('.mg-elec-no').value.trim();
    row.electric = hasElectric ? { ...(row.electric || {}), present: true, meterNo: elecNo } : null;

    const hasGas = tr.querySelector('.mg-has-gas').checked;
    const gasNo = tr.querySelector('.mg-gas-no').value.trim();
    row.gas = hasGas ? { ...(row.gas || {}), present: true, meterNo: gasNo } : null;
  });

  ensureReadingSlots();
  saveState();
  closeModal('manageModal');
  renderAll();
  toast('抄表項目已更新');
}

/* ---------------- Modal 共用 ---------------- */

function openModal(id) {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

/* ---------------- 匯出功能 ---------------- */

function exportCSV() {
  const period = state.currentPeriod;
  const header = ['門市代號', '項目名稱', '水錶-上月', '水錶-本月', '水錶-用量',
    '電錶號碼', '電錶-上月', '電錶-本月', '電錶-用量',
    '瓦斯錶號', '瓦斯-上月', '瓦斯-本月', '瓦斯-用量', '備註'];
  const lines = [header.join(',')];

  state.rows.forEach((row) => {
    const cells = [row.group, row.name];
    let note = '';
    ['water', 'electric', 'gas'].forEach((type) => {
      if (!hasMeter(row[type])) {
        if (type === 'water') cells.push('', '', '');
        else cells.push('', '', '', '');
        if (row[type]?.note) note += (note ? ' / ' : '') + row[type].note;
        return;
      }
      const st = cellStatus(row, type);
      if (type !== 'water') cells.push(row[type].meterNo || '');
      cells.push(fmtNum(st.reading.last), fmtNum(st.reading.this), st.usage === null ? '' : fmtNum(st.usage));
      if (row[type]?.note) note += (note ? ' / ' : '') + row[type].note;
    });
    cells.push(note);
    lines.push(cells.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
  });

  const csv = '﻿' + lines.join('\r\n');
  downloadBlob(csv, `碧潭抄表_${period}.csv`, 'text/csv;charset=utf-8');
}

function exportExcel() {
  const period = state.currentPeriod;
  const table = document.getElementById('meterTable');
  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
    <head><meta charset="utf-8"><style>td,th{border:1px solid #999;padding:4px;font-family:Arial;font-size:12px;} table{border-collapse:collapse;}</style></head>
    <body>${table.outerHTML}</body></html>`;
  downloadBlob(html, `碧潭抄表_${period}.xls`, 'application/vnd.ms-excel;charset=utf-8');
}

function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportBackup() {
  downloadBlob(JSON.stringify(state, null, 2), `碧潭抄表_備份_${Date.now()}.json`, 'application/json');
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed.rows || !parsed.periods) throw new Error('格式不正確');
      if (!confirm('匯入將覆蓋目前所有資料，確定要繼續嗎？')) return;
      state = parsed;
      ensureReadingSlots();
      saveState();
      renderAll();
      toast('備份已還原');
    } catch (e) {
      toast(`匯入失敗：${e.message}`);
    }
  };
  reader.readAsText(file);
}

/* ---------------- toast ---------------- */

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------------- 角色權限 ---------------- */

const ADMIN_ONLY_BUTTON_IDS = [
  'btnNextPeriod', 'btnPrice', 'btnManage',
  'btnExportCsv', 'btnExportExcel', 'btnPrint',
  'btnBackupExport', 'btnBackupImport',
];

function applyRolePermissions() {
  const admin = isAdmin();
  ADMIN_ONLY_BUTTON_IDS.forEach((id) => {
    document.getElementById(id).style.display = admin ? '' : 'none';
  });
}

/* ---------------- 主渲染 ---------------- */

function renderAll() {
  renderPeriodControls();
  renderStats();
  renderTable();
}

/* ---------------- 事件綁定 ---------------- */

function setHandlers() {
  ['tableBody', 'cardList'].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener('input', handleTableInput);
    el.addEventListener('click', (e) => {
      const photoThumb = e.target.closest('.photo-thumb.has-photo');
      if (photoThumb) {
        openPhotoPreview(photoThumb.dataset.row, photoThumb.dataset.type);
        return;
      }
      const photoBtn = e.target.closest('.btn-photo');
      if (photoBtn) {
        const fileInput = el.querySelector(
          `.photo-file-input[data-row="${photoBtn.dataset.row}"][data-type="${photoBtn.dataset.type}"]`
        );
        if (fileInput) fileInput.click();
        return;
      }
      const rolloverBtn = e.target.closest('.btn-apply-rollover');
      if (rolloverBtn) {
        applyRolloverCorrection(rolloverBtn.dataset.row, rolloverBtn.dataset.type);
        return;
      }
      const btn = e.target.closest('.history-btn');
      if (btn) openHistoryModal(btn.dataset.row);
    });
    el.addEventListener('change', async (e) => {
      const fileInput = e.target;
      if (!fileInput.matches('.photo-file-input')) return;
      const file = fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      const rowId = fileInput.dataset.row;
      const type = fileInput.dataset.type;
      try {
        await savePhoto(state.currentPeriod, rowId, type, file);
        photoKeys.add(`${rowId}_${type}`);
        renderTable();
        toast('拍照存證完成，可以輸入本月度數了');
      } catch (err) {
        toast('拍照存證失敗，請再試一次');
      }
    });
  });

  document.getElementById('periodSelect').addEventListener('change', (e) => switchPeriod(e.target.value));
  document.getElementById('btnNextPeriod').addEventListener('click', createNextPeriod);
  document.getElementById('readingDateInput').addEventListener('change', (e) => {
    state.periods[state.currentPeriod].readingDate = e.target.value;
    saveState();
  });

  document.getElementById('searchInput').addEventListener('input', (e) => {
    searchKeyword = e.target.value.trim();
    renderTable();
  });

  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter;
      renderTable();
    });
  });

  document.querySelectorAll('.type-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(`cardSection-${btn.dataset.target}`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  document.getElementById('btnPrice').addEventListener('click', openPriceModal);
  document.getElementById('btnPriceSave').addEventListener('click', savePrices);
  document.getElementById('btnPriceCancel').addEventListener('click', () => closeModal('priceModal'));

  document.getElementById('btnManage').addEventListener('click', openManageModal);
  document.getElementById('btnManageAdd').addEventListener('click', addManageRow);
  document.getElementById('btnManageSave').addEventListener('click', saveManageTable);
  document.getElementById('btnManageCancel').addEventListener('click', () => closeModal('manageModal'));

  document.getElementById('btnColumnPrefs').addEventListener('click', openColumnPrefsModal);
  document.getElementById('btnColumnPrefsSave').addEventListener('click', saveColumnPrefsFromModal);
  document.getElementById('btnColumnPrefsReset').addEventListener('click', resetColumnPrefsModal);

  document.getElementById('btnHistoryClose').addEventListener('click', () => closeModal('historyModal'));

  document.getElementById('btnPhotoPreviewClose').addEventListener('click', () => closeModal('photoPreviewModal'));

  document.getElementById('btnScanCancel').addEventListener('click', stopScanner);

  document.getElementById('btnExportCsv').addEventListener('click', exportCSV);
  document.getElementById('btnExportExcel').addEventListener('click', exportExcel);
  document.getElementById('btnPrint').addEventListener('click', () => window.print());

  document.getElementById('btnBackupExport').addEventListener('click', exportBackup);
  document.getElementById('btnBackupImport').addEventListener('click', () => document.getElementById('backupFileInput').click());
  document.getElementById('backupFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importBackup(file);
    e.target.value = '';
  });

  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });

  window.addEventListener('resize', syncHeaderHeight);
}

/* ---------------- 固定頂部功能區 ---------------- */

function syncHeaderHeight() {
  const header = document.querySelector('.app-header');
  const toolbar = document.querySelector('.toolbar');
  if (header) document.documentElement.style.setProperty('--header-h', `${header.offsetHeight}px`);
  if (toolbar) document.documentElement.style.setProperty('--toolbar-h', `${toolbar.offsetHeight}px`);
}

/* ---------------- 啟動 ---------------- */

async function bootstrap() {
  state = loadState();
  ensureReadingSlots();
  setHandlers();
  applyRolePermissions();
  await loadPhotoKeys();
  renderAll();
  syncHeaderHeight();
}

/*
  登入 / 註冊 / 帳號審核邏輯已移至 auth.js（帳號資料存在瀏覽器本機 localStorage，
  不需要任何雲端服務設定）。unlockApp() 由 auth.js 在核准後呼叫。
*/
