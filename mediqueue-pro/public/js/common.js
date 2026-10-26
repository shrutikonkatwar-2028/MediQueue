const CATEGORIES = {
  emergency: 'Chest pain / breathing difficulty / severe bleeding',
  high: 'High fever / fracture / injury',
  mild: 'Cold or cough',
  routine: 'Routine checkup'
};
const STATUS_OPTIONS = ['In OPD', 'In surgery', 'On break', 'On ward round', 'Not in hospital'];
const HOME = { patient: '/patient.html', doctor: '/doctor.html', admin: '/admin.html', receptionist: '/reception.html' };
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const $ = (sel, root = document) => root.querySelector(sel);
const getToken = () => localStorage.getItem('mq_token');
function getUser() { try { return JSON.parse(localStorage.getItem('mq_user')); } catch { return null; } }
function saveSession(s) { localStorage.setItem('mq_token', s.token); localStorage.setItem('mq_user', JSON.stringify(s.user)); }
function logout() { localStorage.removeItem('mq_token'); localStorage.removeItem('mq_user'); location.href = '/'; }

async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (getToken()) headers.Authorization = 'Bearer ' + getToken();
  const res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401 && getToken()) { logout(); throw new Error('Please log in again'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

/* ---------- Logo (hospital plus symbol in red) and page chrome ---------- */
const logoSvg = (size = 36) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 40 40" role="img" aria-label="MediQueue"><circle cx="20" cy="20" r="19" fill="#fff" stroke="#0d5a35" stroke-width="2"/><path d="M16 8h8v8h8v8h-8v8h-8v-8H8v-8h8z" fill="#d32f2f"/></svg>`;

function initChrome() {
  document.querySelectorAll('.brand').forEach(el => {
    el.innerHTML = `${logoSvg(38)}<span><b>MediQueue</b><small class="hosp-name">Smart hospital care</small></span>`;
  });
  fetch('/api/public/info').then(r => r.json()).then(i => {
    document.querySelectorAll('.hosp-name').forEach(e => { e.textContent = i.hospital; });
  }).catch(() => {});
  const right = document.querySelector('.top .right');
  if (right && getToken()) {
    const b = document.createElement('button');
    b.className = 'btn light sm'; b.textContent = 'Change password';
    b.onclick = () => $('#pwDlg').showModal();
    right.insertBefore(b, right.lastElementChild);
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="pwDlg"><h2>Change password</h2>
        <form id="pwForm">
          <label for="pwOld">Current password</label><input id="pwOld" type="password" autocomplete="current-password" required>
          <label for="pwNew">New password (8+ characters, letters and numbers)</label><input id="pwNew" type="password" autocomplete="new-password" minlength="8" required>
          <label for="pwNew2">Repeat new password</label><input id="pwNew2" type="password" autocomplete="new-password" required>
          <div class="row" style="margin-top:16px"><button class="btn" type="submit">Save</button><button class="btn ghost" type="button" id="pwCancel">Cancel</button></div>
        </form></dialog>`);
    $('#pwCancel').onclick = () => $('#pwDlg').close();
    $('#pwForm').onsubmit = e => {
      e.preventDefault();
      if ($('#pwNew').value !== $('#pwNew2').value) return toast('The new passwords do not match', true);
      run(e.submitter, async () => {
        await api('/auth/change-password', { method: 'POST', body: { current_password: $('#pwOld').value, new_password: $('#pwNew').value } });
        toast('Password changed'); e.target.reset(); $('#pwDlg').close();
      });
    };
  }
}
document.addEventListener('DOMContentLoaded', initChrome);

/* ---------- Guards, formatting ---------- */
function guard(roles) {
  const u = getUser();
  if (!getToken() || !u || ![].concat(roles).includes(u.role)) { location.replace('/'); return null; }
  const who = document.getElementById('who');
  if (who) who.textContent = u.name;
  return u;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const drName = n => (/^dr\.?\s/i.test(n) ? n : 'Dr. ' + n);
const slug = s => String(s).toLowerCase().replace(/[^a-z]+/g, '-');
const statusBadge = s => `<span class="badge s-${slug(s)}">${esc(s)}</span>`;
const labelBadge = l => `<span class="badge b-${slug(l)}">${esc(l)}</span>`;
const money = n => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const stars = r => r ? `<span class="stars" title="${r} out of 5">${'★'.repeat(Math.round(r))}${'☆'.repeat(5 - Math.round(r))}</span> ${r}` : '<span class="muted">No ratings yet</span>';

const dstr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const todayStr = () => dstr(new Date());
const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return dstr(d); };
const fmtDate = d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '';
const fmtTime = iso => iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

function scheduleText(s) {
  if (!s || !s.length) return 'Any day';
  const n = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (s.every(x => x.start === s[0].start && x.end === s[0].end)) {
    const days = s.map(x => x.weekday), ranges = [];
    for (let i = 0; i < days.length;) {
      let j = i;
      while (j + 1 < days.length && days[j + 1] === days[j] + 1) j++;
      ranges.push(j > i ? `${n[days[i]]}-${n[days[j]]}` : n[days[i]]);
      i = j + 1;
    }
    return `${ranges.join(', ')} ${s[0].start}-${s[0].end}`;
  }
  return s.map(x => `${n[x.weekday]} ${x.start}-${x.end}`).join(', ');
}

// Weekly schedule editor (used by the doctor page and the admin dialog)
function scheduleEditor(el, schedule) {
  const by = Object.fromEntries((schedule || []).map(s => [s.weekday, s]));
  el.innerHTML = DAY_NAMES.map((d, i) => `
    <div class="sched-row">
      <label><input type="checkbox" data-day="${i}" ${by[i] ? 'checked' : ''}> ${d}</label>
      <input type="time" data-start="${i}" value="${by[i] ? by[i].start : '09:00'}" aria-label="${d} start">
      <input type="time" data-end="${i}" value="${by[i] ? by[i].end : '17:00'}" aria-label="${d} end">
    </div>`).join('') + '<p class="small muted">Tick the days this doctor sees patients. With no day ticked, patients can book on any day.</p>';
}
function readSchedule(el) {
  return [...el.querySelectorAll('[data-day]')].filter(c => c.checked).map(c => ({
    weekday: Number(c.dataset.day), start: el.querySelector(`[data-start="${c.dataset.day}"]`).value, end: el.querySelector(`[data-end="${c.dataset.day}"]`).value
  }));
}

/* ---------- UI helpers ---------- */
function toast(msg, isError = false) {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast' + (isError ? ' err' : '');
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

// Run an async click handler; show errors as toasts. Returns a promise (so callers can re-apply button state).
async function run(btn, fn) {
  if (btn) btn.disabled = true;
  try { await fn(); } catch (e) { toast(e.message, true); }
  finally { if (btn) btn.disabled = false; }
}

function bars(items, { red = false, fmt = v => v } = {}) {
  const max = Math.max(1, ...items.map(i => i.value));
  return `<div class="bars ${red ? 'red' : ''}">${items.map(i => `
    <div class="bar" title="${esc(i.label)}: ${esc(fmt(i.value))}"><span class="v">${i.value ? esc(fmt(i.value)) : ''}</span>
    <div class="fill" style="height:${Math.round(i.value / max * 105)}px"></div><span class="l">${esc(i.label)}</span></div>`).join('')}</div>`;
}
function hbars(items) {
  const max = Math.max(1, ...items.map(i => i.v));
  return items.length ? items.map(i => `<div class="hbar"><span>${esc(i.name)}</span><span class="track"><i style="width:${Math.round(i.v / max * 100)}%"></i></span><b>${i.v}</b></div>`).join('')
    : '<p class="muted">No data yet.</p>';
}
function pager(el, page, pages, onPage) {
  el.innerHTML = pages > 1 ? `<div class="row" style="margin-top:12px"><button class="btn ghost sm" data-p="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button>
    <span class="small muted">Page ${page} of ${pages}</span><button class="btn ghost sm" data-p="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next</button></div>` : '';
  el.querySelectorAll('[data-p]').forEach(b => { b.onclick = () => onPage(Number(b.dataset.p)); });
}

// Download a file from an API route that needs the login header (CSV exports)
async function downloadCsv(path, filename) {
  const res = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + getToken() } });
  if (!res.ok) throw new Error('Download failed');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Open a clean printable page (prescription, invoice, token slip)
function printHtml(title, body) {
  const w = window.open('', '_blank', 'width=820,height=900');
  if (!w) return toast('Please allow pop-ups to print', true);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
    body{font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif;color:#12261b;padding:28px;max-width:760px;margin:auto}
    .hd{display:flex;align-items:center;gap:12px;border-bottom:3px solid #0d5a35;padding-bottom:10px;margin-bottom:16px}
    .hd h1{margin:0;font-size:22px;color:#0d5a35}.hd small{color:#55705f}
    table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #cfe6d9;padding:6px 8px;text-align:left}
    .big{font-size:48px;font-weight:800;color:#0d5a35}.pre{white-space:pre-wrap}.muted{color:#55705f}
    .foot{margin-top:28px;font-size:12px;color:#55705f;border-top:1px solid #cfe6d9;padding-top:8px}
  </style></head><body><div class="hd">${logoSvg(46)}<div><h1>MediQueue</h1><small>${esc((document.querySelector('.hosp-name') || {}).textContent || '')}</small></div></div>
  ${body}<div class="foot">Computer generated document. Printed ${esc(new Date().toLocaleString())}</div></body></html>`);
  w.document.close(); w.focus();
  setTimeout(() => w.print(), 300);
}

// Live updates: Socket.IO pushes a "queue:update" event, polling is the safety net
function connectLive(refresh) {
  let timer;
  const go = () => { clearTimeout(timer); timer = setTimeout(() => Promise.resolve(refresh()).catch(() => {}), 250); };
  if (typeof io !== 'undefined') {
    const socket = io({ auth: { token: getToken() } });
    socket.on('queue:update', go);
    socket.on('notification', n => { toast(n.message); go(); });
  }
  setInterval(go, 15000);
}

function tabs(onShow) {
  const buttons = document.querySelectorAll('.tabs button');
  const show = name => {
    buttons.forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('[id^="tab-"]').forEach(s => { s.hidden = s.id !== 'tab-' + name; });
    if (onShow) onShow(name);
  };
  buttons.forEach(b => b.addEventListener('click', () => show(b.dataset.tab)));
  return show;
}

/* ---------- Bill editor (reception and admin only; the server refuses everyone else) ---------- */
function openBillEditor(bill, onSaved) {
  let dlg = document.getElementById('billEdDlg');
  if (!dlg) {
    document.body.insertAdjacentHTML('beforeend', `
      <dialog id="billEdDlg"><h2 id="beTitle">Edit bill</h2>
        <p class="note-box">Only reception and admin can change payment details. Every change is saved in the audit log.</p>
        <form id="beForm">
          <p class="muted" style="margin:10px 0 0">Consultation fee: <b id="beFee"></b></p>
          <div class="form-grid">
            <div><label for="beExtra">Extra charges (Rs.)</label><input id="beExtra" type="number" min="0" max="100000" step="1"></div>
            <div><label for="beDisc">Discount (Rs.)</label><input id="beDisc" type="number" min="0" step="1"></div>
            <div><label for="beStatus">Payment status</label><select id="beStatus"><option>Pending</option><option>Paid</option><option>Waived</option></select></div>
            <div><label for="beMethod">Paid by</label><select id="beMethod"><option>Cash</option><option>UPI</option><option>Card</option></select></div>
          </div>
          <p style="font-size:1.15rem;margin:14px 0 0">Total to pay: <b id="beTotal"></b></p>
          <div class="row" style="margin-top:16px"><button class="btn" type="submit">Save changes</button><button class="btn ghost" type="button" id="beCancel">Cancel</button></div>
        </form></dialog>`);
    dlg = document.getElementById('billEdDlg');
    const preview = () => {
      const st = $('#beStatus').value, extra = Number($('#beExtra').value || 0);
      const gross = Number(dlg._bill.amount) + extra;
      $('#beMethod').disabled = st !== 'Paid';
      $('#beDisc').disabled = st === 'Waived';
      $('#beTotal').textContent = money(st === 'Waived' ? 0 : Math.max(0, gross - Number($('#beDisc').value || 0)));
    };
    ['input', 'change'].forEach(ev => dlg.addEventListener(ev, preview));
    $('#beCancel').onclick = () => dlg.close();
    $('#beForm').onsubmit = e => {
      e.preventDefault();
      run(e.submitter, async () => {
        const st = $('#beStatus').value;
        await api('/billing/' + dlg._bill.id, { method: 'PUT', body: {
          extra_charges: Number($('#beExtra').value || 0), discount: Number($('#beDisc').value || 0),
          status: st, payment_method: st === 'Paid' ? $('#beMethod').value : null } });
        dlg.close(); toast('Bill updated');
        if (dlg._onSaved) await dlg._onSaved();
      });
    };
  }
  dlg._bill = bill; dlg._onSaved = onSaved;
  $('#beTitle').textContent = `Bill #${bill.id} · ${bill.patient_name}`;
  $('#beFee').textContent = money(bill.amount);
  $('#beExtra').value = bill.extra_charges; $('#beDisc').value = bill.discount;
  $('#beStatus').value = bill.status; $('#beMethod').value = bill.payment_method || 'Cash';
  $('#beExtra').dispatchEvent(new Event('input', { bubbles: true }));
  dlg.showModal();
}
