const user = guard('patient');
let doctors = [], selectedDoctor = null, visits = [], bills = [];
const qrOpen = new Set(), qrCache = {};

const show = tabs(name => {
  if (name === 'book') loadDoctors();
  if (name === 'history') loadHistory();
  if (name === 'bills') loadBills();
  if (name === 'profile') loadProfile();
});

/* ---------- My queue ---------- */
function apptCard(a) {
  const isToday = a.date === todayStr();
  let body = '';
  if (a.status === 'In consultation') {
    body = `<div class="callout go">It is your turn. Please go to <b>Room ${esc(a.room)}</b>.</div>`;
  } else if (a.status === 'Waiting') {
    body = a.patients_ahead === 0
      ? `<div class="callout go">You are next. Please wait near <b>Room ${esc(a.room)}</b>.</div>`
      : `<div class="stats3">
           <div><span class="big">${a.patients_ahead}</span><small>patients ahead</small></div>
           <div><span class="big">${a.estimated_wait}</span><small>min estimated wait</small></div>
           <div><span class="big">${a.position}</span><small>your position</small></div>
         </div>`;
  } else if (isToday) {
    body = `<p class="muted">${a.waiting_now} patient${a.waiting_now === 1 ? ' is' : 's are'} waiting for this doctor right now. Check in when you reach the hospital to join the live queue.</p>`;
  } else {
    body = `<p class="muted">Check-in opens on ${esc(fmtDate(a.date))}.</p>`;
  }
  if (a.status !== 'In consultation' && a.doctor_status !== 'In OPD') {
    body += `<div class="callout warn">${esc(drName(a.doctor_name))} is currently <b>${esc(a.doctor_status.toLowerCase())}</b>. Your waiting time may be longer.</div>`;
  }
  const actions = [];
  if (a.status === 'Booked' && isToday) {
    actions.push(`<button class="btn" data-act="checkin" data-id="${a.id}">I have arrived (check in)</button>`);
    actions.push(`<button class="btn ghost" data-act="qr" data-id="${a.id}">${qrOpen.has(a.id) ? 'Hide QR code' : 'Show QR code'}</button>`);
  }
  if (a.status === 'Booked' || a.status === 'Waiting') actions.push(`<button class="btn danger" data-act="cancel" data-id="${a.id}">Cancel</button>`);
  const qr = qrOpen.has(a.id) && qrCache[a.id]
    ? `<div class="callout"><img src="${qrCache[a.id].dataUrl}" width="180" height="180" alt="Check-in QR code"><br>
       <span class="small muted">Show this QR code at the reception desk to check in.</span></div>` : '';
  return `<div class="card appt">
    <div><div class="token">${esc(a.token_no)}</div>
      <div style="margin-top:8px">${labelBadge(a.label)}</div><div style="margin-top:8px">${statusBadge(a.status)}</div></div>
    <div>
      <h3>${esc(drName(a.doctor_name))} <span class="muted" style="font-weight:400">· ${esc(a.specialty)}</span></h3>
      <div class="docline"><span>Room <b>${esc(a.room)}</b></span><span>Doctor: ${statusBadge(a.doctor_status)}</span><span>${esc(fmtDate(a.date))}</span></div>
      ${body}${qr}<div class="row">${actions.join('')}</div>
    </div></div>`;
}

async function loadActive() {
  const list = await api('/patient/appointments');
  $('#active').innerHTML = list.length ? list.map(apptCard).join('')
    : `<div class="empty">You have no active appointments.<br><button class="btn" style="margin-top:12px" id="goBook">Book an appointment</button></div>`;
  const go = $('#goBook');
  if (go) go.onclick = () => show('book');
}
async function loadNotes() {
  const { items } = await api('/notifications');
  $('#notes').innerHTML = items.length
    ? items.map(n => `<div class="note ${n.is_read ? '' : 'unread'}">${esc(n.message)}<br><span class="small muted">${esc(fmtTime(n.created_at))}</span></div>`).join('')
    : '<p class="muted">No notifications yet.</p>';
}
$('#active').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = Number(btn.dataset.id);
  run(btn, async () => {
    if (btn.dataset.act === 'checkin') { await api(`/patient/appointments/${id}/checkin`, { method: 'POST' }); toast('You are checked in'); }
    else if (btn.dataset.act === 'cancel') {
      if (!confirm('Cancel this appointment?')) return;
      await api(`/patient/appointments/${id}/cancel`, { method: 'POST' }); toast('Appointment cancelled');
    } else if (btn.dataset.act === 'qr') {
      if (qrOpen.has(id)) qrOpen.delete(id);
      else { qrCache[id] = qrCache[id] || await api(`/patient/appointments/${id}/qr`); qrOpen.add(id); }
    }
    await loadActive();
  });
});
$('#markRead').onclick = e => run(e.target, async () => { await api('/notifications/read', { method: 'POST' }); await loadNotes(); });

/* ---------- Book appointment ---------- */
function renderDoctors() {
  if (!doctors.length) { $('#doctors').innerHTML = '<div class="empty">No doctors found for this specialty.</div>'; return; }
  $('#doctors').innerHTML = doctors.map(d => `
    <button type="button" class="doc ${selectedDoctor === d.id ? 'sel' : ''}" data-id="${d.id}">
      <div class="row between"><b>${esc(drName(d.name))}</b>${statusBadge(d.status)}</div>
      <div class="docline"><span>${esc(d.specialty)}</span><span>Room <b>${esc(d.room)}</b></span><span>${d.experience} yrs</span><span>Fee <b>${money(d.consultation_fee)}</b></span></div>
      <div class="docline">${d.qualification ? `<span>${esc(d.qualification)}</span>` : ''}<span>${stars(d.rating)}${d.rating_count ? ` (${d.rating_count})` : ''}</span></div>
      <div class="docline"><span>Available: <b>${esc(scheduleText(d.schedule))}</b></span><span>${d.waiting} waiting now</span></div>
    </button>`).join('');
  const d = doctors.find(x => x.id === selectedDoctor);
  $('#chosen').innerHTML = d ? `Selected: <b>${esc(drName(d.name))}</b>, Room ${esc(d.room)}, fee ${money(d.consultation_fee)}` : 'No doctor selected yet.';
}
async function loadDoctors() {
  const sid = $('#spec').value;
  doctors = await api('/doctors' + (sid ? `?specialty_id=${sid}` : ''));
  renderDoctors();
}
$('#doctors').addEventListener('click', e => {
  const b = e.target.closest('.doc');
  if (!b) return;
  selectedDoctor = Number(b.dataset.id);
  renderDoctors();
});
$('#spec').onchange = loadDoctors;
$('#bookBtn').onclick = e => run(e.target, async () => {
  if (!selectedDoctor) throw new Error('Please select a doctor first');
  const a = await api('/patient/appointments', { method: 'POST',
    body: { doctor_id: selectedDoctor, date: $('#date').value, symptom_category: $('#cat').value, symptoms: $('#symptoms').value } });
  toast(`Booked. Your token is ${a.token_no}`);
  $('#symptoms').value = '';
  show('queue');
  await loadActive();
});

/* ---------- History (with prescriptions, printing, rating) ---------- */
function visitHtml(v, i) {
  const vitals = [v.bp && `BP ${esc(v.bp)}`, v.temperature != null && `Temp ${v.temperature} °C`, v.pulse != null && `Pulse ${v.pulse}`, v.weight != null && `Weight ${v.weight} kg`].filter(Boolean).join(' · ');
  const rate = v.status === 'Completed' && !v.rating
    ? `<div class="row" style="margin-top:8px"><select data-rating="${v.id}" aria-label="Rating" style="width:auto"><option value="5">★★★★★ Excellent</option><option value="4">★★★★ Good</option><option value="3">★★★ Average</option><option value="2">★★ Poor</option><option value="1">★ Bad</option></select>
       <input data-comment="${v.id}" placeholder="Comment (optional)" maxlength="300" style="flex:1;min-width:160px"><button class="btn ghost sm" data-rate="${v.id}">Rate this visit</button></div>`
    : v.rating ? `<div class="small">Your rating: ${stars(v.rating)}${v.feedback ? ' · ' + esc(v.feedback) : ''}</div>` : '';
  return `<div class="visit">
    <div class="row between"><div><b>${esc(drName(v.doctor_name))}</b> <span class="muted">· ${esc(v.specialty)} · ${esc(fmtDate(v.date))}</span></div>
      <div class="row">${statusBadge(v.status)}${v.status === 'Completed' ? `<button class="btn ghost sm" data-print="${i}">Print prescription</button>` : ''}</div></div>
    ${v.symptoms ? `<div class="small muted">Reason: ${esc(v.symptoms)}</div>` : ''}
    ${v.diagnosis ? `<p style="margin:6px 0 0"><b>Diagnosis:</b> ${esc(v.diagnosis)}</p>` : ''}
    ${vitals ? `<div class="small muted">${vitals}</div>` : ''}
    ${v.notes ? `<p class="pre"><b>Doctor's notes:</b> ${esc(v.notes)}</p>` : ''}
    ${v.medicines ? `<p class="pre"><b>Prescription:</b>\n${esc(v.medicines)}</p>` : ''}
    ${v.tests_advised ? `<p style="margin:4px 0 0"><b>Tests advised:</b> ${esc(v.tests_advised)}</p>` : ''}
    ${v.follow_up_date ? `<p style="margin:4px 0 0"><b>Follow-up on:</b> ${esc(fmtDate(v.follow_up_date))}</p>` : ''}
    ${rate}</div>`;
}
async function loadHistory() {
  visits = await api('/patient/history');
  $('#tab-history').innerHTML = visits.length ? `<div class="card">${visits.map(visitHtml).join('')}</div>` : '<div class="empty">No visits yet.</div>';
}
$('#tab-history').addEventListener('click', e => {
  const pr = e.target.closest('[data-print]');
  if (pr) {
    const v = visits[Number(pr.dataset.print)];
    printHtml('Prescription', `<h2>Prescription</h2><p><b>Patient:</b> ${esc(user.name)}<br><b>Doctor:</b> ${esc(drName(v.doctor_name))} (${esc(v.specialty)})<br><b>Date:</b> ${esc(fmtDate(v.date))} · Token ${esc(v.token_no)}</p>
      ${v.diagnosis ? `<p><b>Diagnosis:</b> ${esc(v.diagnosis)}</p>` : ''}
      <p class="muted">${[v.bp && 'BP ' + esc(v.bp), v.temperature != null && 'Temp ' + v.temperature + ' C', v.pulse != null && 'Pulse ' + v.pulse, v.weight != null && 'Weight ' + v.weight + ' kg'].filter(Boolean).join(' | ')}</p>
      ${v.medicines ? `<h3>Medicines</h3><p class="pre">${esc(v.medicines)}</p>` : ''}
      ${v.notes ? `<h3>Advice</h3><p class="pre">${esc(v.notes)}</p>` : ''}
      ${v.tests_advised ? `<p><b>Tests advised:</b> ${esc(v.tests_advised)}</p>` : ''}
      ${v.follow_up_date ? `<p><b>Follow-up on:</b> ${esc(fmtDate(v.follow_up_date))}</p>` : ''}`);
    return;
  }
  const rt = e.target.closest('[data-rate]');
  if (rt) run(rt, async () => {
    const id = rt.dataset.rate;
    await api(`/patient/appointments/${id}/feedback`, { method: 'POST',
      body: { rating: Number($(`[data-rating="${id}"]`).value), comment: $(`[data-comment="${id}"]`).value } });
    toast('Thank you for your feedback');
    await loadHistory();
  });
});

/* ---------- Bills ---------- */
async function loadBills() {
  bills = await api('/patient/bills');
  $('#tab-bills').innerHTML = bills.length ? `<div class="card"><div class="scroll"><table>
    <thead><tr><th>Date</th><th>Doctor</th><th>Token</th><th>Total</th><th>Status</th><th></th></tr></thead>
    <tbody>${bills.map((b, i) => `<tr><td>${esc(fmtDate(b.date))}</td><td>${esc(drName(b.doctor_name))}<br><span class="small muted">${esc(b.specialty)}</span></td>
      <td>${esc(b.token_no)}</td><td class="num"><b>${money(b.total)}</b></td>
      <td>${statusBadge(b.status)}${b.payment_method ? `<br><span class="small muted">${esc(b.payment_method)}</span>` : ''}</td>
      <td><button class="btn ghost sm" data-invoice="${i}">Print invoice</button></td></tr>`).join('')}</tbody></table></div>
    <p class="note-box" style="margin-top:12px">Bills are paid at the reception desk. Only reception and admin can change payment details, you can view and print your invoices here.</p></div>` : '<div class="empty">No bills yet.</div>';
}
$('#tab-bills').addEventListener('click', e => {
  const b = e.target.closest('[data-invoice]');
  if (!b) return;
  const x = bills[Number(b.dataset.invoice)];
  printHtml('Invoice', `<h2>Invoice #${x.id}</h2><p><b>Patient:</b> ${esc(user.name)}<br><b>Doctor:</b> ${esc(drName(x.doctor_name))} (${esc(x.specialty)})<br><b>Visit date:</b> ${esc(fmtDate(x.date))} · Token ${esc(x.token_no)}</p>
    <table><tr><td>Consultation fee</td><td>${money(x.amount)}</td></tr>
    <tr><td>Extra charges</td><td>${money(x.extra_charges)}</td></tr><tr><td>Discount</td><td>- ${money(x.discount)}</td></tr>
    <tr><th>Total</th><th>${money(x.total)}</th></tr></table>
    <p><b>Status:</b> ${esc(x.status)}${x.payment_method ? ' (' + esc(x.payment_method) + ')' : ''}</p>`);
});

/* ---------- Profile ---------- */
async function loadProfile() {
  const p = await api('/patient/profile');
  $('#pname').value = p.name; $('#pphone').value = p.phone || ''; $('#pdob').value = p.dob; $('#pdob').max = todayStr();
  $('#pgender').value = p.gender || 'Male'; $('#pblood').value = p.blood_group || '';
  $('#pallergy').value = p.allergies || ''; $('#phist').value = p.medical_history || '';
  $('#paddr').value = p.address || ''; $('#pemerg').value = p.emergency_contact || '';
  $('#pchronic').checked = p.chronic; $('#pemail').textContent = p.email;
}
$('#profForm').onsubmit = e => {
  e.preventDefault();
  run(e.submitter, async () => {
    await api('/patient/profile', { method: 'PUT', body: {
      name: $('#pname').value, phone: $('#pphone').value, dob: $('#pdob').value, gender: $('#pgender').value,
      blood_group: $('#pblood').value, allergies: $('#pallergy').value, medical_history: $('#phist').value,
      address: $('#paddr').value, emergency_contact: $('#pemerg').value, chronic: $('#pchronic').checked } });
    toast('Profile saved');
  });
};

/* ---------- Init ---------- */
const refresh = () => Promise.all([loadActive(), loadNotes()]);
(async function init() {
  $('#cat').innerHTML = Object.entries(CATEGORIES).reverse().map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
  $('#date').min = todayStr(); $('#date').max = plusDays(30); $('#date').value = todayStr();
  try {
    (await api('/specialties')).forEach(s => $('#spec').insertAdjacentHTML('beforeend', `<option value="${s.id}">${esc(s.name)}</option>`));
    await refresh();
  } catch (e) { toast(e.message, true); }
  connectLive(() => {
    const tab = document.querySelector('.tabs button.active').dataset.tab;
    return tab === 'book' ? loadDoctors() : tab === 'queue' ? refresh() : null;
  });
})();
