const user = guard('admin');
let doctorsData = { doctors: [], specialties: [] };
let editing = null, schedFor = null, userPage = 1, auditPage = 1;

const safe = fn => fn().catch(e => toast(e.message, true));
const show = tabs(name => {
  if (name === 'overview') safe(loadOverview);
  if (name === 'doctors') safe(loadDoctors);
  if (name === 'users') safe(loadUsers);
  if (name === 'billing') safe(loadBills);
  if (name === 'analytics') safe(loadAnalytics);
  if (name === 'audit') safe(loadAudit);
});

/* ---------- Overview ---------- */
const kpi = (cls, label, value, sub) => `<div class="kpi ${cls}"><div class="k-label">${esc(label)}</div><div class="k-value">${value}</div><div class="k-sub">${sub}</div></div>`;

async function loadOverview() {
  const o = await api('/admin/overview'), s = o.stats;
  $('#ovDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#ovKpis').innerHTML =
    kpi('green', 'Appointments today', s.appointments_today, `${s.completed_today} completed so far`) +
    kpi('orange', 'Waiting now', s.patients_waiting, `${s.in_consultation} with a doctor`) +
    kpi('purple', 'Doctors on duty', `${s.doctors_on_duty}<span style="font-size:1rem;color:var(--muted)"> / ${s.doctors_total}</span>`, 'in the hospital now') +
    kpi('red', 'Emergency cases', s.emergency_cases, 'registered today') +
    kpi('teal', 'Revenue today', money(s.revenue_today), `${money(s.pending_amount)} unpaid (${s.pending_bills} bills)`);
  $('#ovAlerts').innerHTML = o.attention.map(a => `<div class="alert ${a.level}">${esc(a.text)}</div>`).join('');
  $('#ovFlow').innerHTML = stackBar(o.flow.map(f => ({ name: f.status, value: f.count, color: STATUS_COLORS[f.status] })));

  const maxQ = Math.max(1, ...o.doctors.map(d => d.queue_length));
  $('#liveDoctors').innerHTML = `<table><thead><tr><th>Doctor</th><th>Room</th><th>Status</th><th>Now serving</th><th>Waiting</th><th>Seen today</th></tr></thead>
    <tbody>${o.doctors.map(d => `<tr><td><b>${esc(drName(d.name))}</b><br><span class="small muted">${esc(d.specialty)}</span></td><td>${esc(d.room)}</td>
      <td>${statusBadge(d.status)}</td><td>${d.now_serving ? `<b style="color:var(--c-purple)">${esc(d.now_serving)}</b>` : '<span class="muted">-</span>'}</td>
      <td><div class="qbar"><div class="t"><i style="width:${Math.round(d.queue_length / maxQ * 100)}%"></i></div><b>${d.queue_length}</b></div></td>
      <td class="num">${d.seen_today}</td></tr>`).join('')}</tbody></table>`;
  $('#recent').innerHTML = o.recent.length ? `<table><thead><tr><th>Token</th><th>Patient</th><th>Doctor</th><th>Date</th><th>Problem</th><th>Status</th></tr></thead>
    <tbody>${o.recent.map(r => `<tr><td><b>${esc(r.token_no)}</b></td><td>${esc(r.patient_name)}</td><td>${esc(drName(r.doctor_name))}</td>
      <td>${esc(fmtDate(r.date))}</td><td>${esc(CATEGORIES[r.symptom_category])}</td><td>${statusBadge(r.status)}${r.source === 'walk-in' ? ' <span class="small muted">walk-in</span>' : ''}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">No appointments yet.</div>';
}

/* ---------- Doctors and specialties ---------- */
function fillSpecialtySelects() {
  const opts = doctorsData.specialties.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  const cur = $('#dspec').value; $('#dspec').innerHTML = opts; if (cur) $('#dspec').value = cur;
  $('#eSpec').innerHTML = opts;
}
async function loadDoctors() {
  doctorsData = await api('/admin/doctors');
  fillSpecialtySelects();
  $('#docTable').innerHTML = `<table><thead><tr><th>Doctor</th><th>Specialty</th><th>Room</th><th>Fee</th><th>Per day</th><th>Schedule</th><th>Account</th><th></th></tr></thead>
    <tbody>${doctorsData.doctors.map(d => `<tr>
      <td><b>${esc(drName(d.name))}</b><br><span class="small muted">${esc(d.email)}</span></td><td>${esc(d.specialty)}</td><td>${esc(d.room)}</td>
      <td class="num">${money(d.consultation_fee)}</td><td class="num">${d.max_daily_patients}</td><td class="small">${esc(scheduleText(d.schedule))}</td>
      <td>${d.is_active ? '<span class="badge s-paid">Active</span>' : '<span class="badge s-no-show">Disabled</span>'}</td>
      <td><div class="row"><button class="btn ghost sm" data-edit="${d.id}">Edit</button><button class="btn ghost sm" data-sched="${d.id}">Schedule</button></div></td></tr>`).join('')}</tbody></table>`;
  $('#specList').innerHTML = doctorsData.specialties.map(s => `<div class="row between" style="padding:5px 0;border-bottom:1px solid var(--g100)"><span>${esc(s.name)}</span>
    <button class="btn danger sm" data-delspec="${s.id}">Delete</button></div>`).join('');
}
$('#docTable').addEventListener('click', e => {
  const ed = e.target.closest('[data-edit]'), sc = e.target.closest('[data-sched]');
  if (ed) {
    editing = doctorsData.doctors.find(d => d.id === Number(ed.dataset.edit));
    $('#editTitle').textContent = 'Edit ' + drName(editing.name);
    $('#eSpec').value = editing.specialty_id; $('#eRoom').value = editing.room; $('#eAvg').value = editing.avg_consult_time;
    $('#eExp').value = editing.experience; $('#eFee').value = editing.consultation_fee; $('#eMax').value = editing.max_daily_patients;
    $('#eQual').value = editing.qualification || ''; $('#eActive').checked = !!editing.is_active;
    $('#editDlg').showModal();
  }
  if (sc) {
    schedFor = doctorsData.doctors.find(d => d.id === Number(sc.dataset.sched));
    $('#schedTitle').textContent = 'Weekly schedule: ' + drName(schedFor.name);
    scheduleEditor($('#schedBox'), schedFor.schedule);
    $('#schedDlg').showModal();
  }
});
$('#editCancel').onclick = () => $('#editDlg').close();
$('#schedCancel').onclick = () => $('#schedDlg').close();
$('#editForm').onsubmit = e => {
  e.preventDefault();
  run(e.submitter, async () => {
    await api('/admin/doctors/' + editing.id, { method: 'PUT', body: {
      specialty_id: Number($('#eSpec').value), room: $('#eRoom').value, avg_consult_time: Number($('#eAvg').value),
      experience: Number($('#eExp').value || 0), consultation_fee: Number($('#eFee').value || 0),
      max_daily_patients: Number($('#eMax').value || 40), qualification: $('#eQual').value, is_active: $('#eActive').checked } });
    $('#editDlg').close(); toast('Doctor updated'); await loadDoctors();
  });
};
$('#schedSave').onclick = e => run(e.target, async () => {
  await api(`/admin/doctors/${schedFor.id}/schedule`, { method: 'PUT', body: { days: readSchedule($('#schedBox')) } });
  $('#schedDlg').close(); toast('Schedule saved'); await loadDoctors();
});
$('#docForm').onsubmit = e => {
  e.preventDefault();
  run(e.submitter, async () => {
    await api('/admin/doctors', { method: 'POST', body: {
      name: $('#dname').value, email: $('#demail').value, password: $('#dpass').value, phone: $('#dphone').value,
      specialty_id: Number($('#dspec').value), room: $('#droom').value, avg_consult_time: Number($('#davg').value),
      experience: Number($('#dexp').value || 0), consultation_fee: Number($('#dfee').value || 0),
      max_daily_patients: Number($('#dmax').value || 40), qualification: $('#dqual').value } });
    toast('Doctor added. You can now set the weekly schedule.'); e.target.reset(); await loadDoctors();
  });
};
$('#specForm').onsubmit = e => {
  e.preventDefault();
  run(e.submitter, async () => { await api('/admin/specialties', { method: 'POST', body: { name: $('#sname').value } }); toast('Specialty added'); e.target.reset(); await loadDoctors(); });
};
$('#specList').addEventListener('click', e => {
  const b = e.target.closest('[data-delspec]');
  if (!b || !confirm('Delete this specialty?')) return;
  run(b, async () => { await api('/admin/specialties/' + b.dataset.delspec, { method: 'DELETE' }); toast('Specialty deleted'); await loadDoctors(); });
});

/* ---------- Users ---------- */
async function loadUsers() {
  const q = new URLSearchParams({ page: userPage, role: $('#uRole').value, q: $('#uSearch').value });
  const r = await api('/admin/users?' + q);
  $('#userTable').innerHTML = `<table><thead><tr><th>Name</th><th>Role</th><th>Email / phone</th><th>Last login</th><th>Account</th><th></th></tr></thead>
    <tbody>${r.users.map(u => `<tr><td><b>${esc(u.name)}</b></td><td>${esc(u.role)}</td>
      <td>${esc(u.email)}<br><span class="small muted">${esc(u.phone || '')}</span></td><td class="small">${u.last_login ? esc(fmtTime(u.last_login)) : 'Never'}</td>
      <td>${u.is_active ? '<span class="badge s-paid">Active</span>' : '<span class="badge s-no-show">Disabled</span>'}</td>
      <td><div class="row"><button class="btn ghost sm" data-toggle="${u.id}" data-active="${u.is_active ? 0 : 1}">${u.is_active ? 'Disable' : 'Enable'}</button>
        <button class="btn ghost sm" data-reset="${u.id}" data-email="${esc(u.email)}">Reset password</button></div></td></tr>`).join('')}</tbody></table>`;
  pager($('#userPager'), r.page, r.pages, p => { userPage = p; loadUsers(); });
}
$('#uRole').onchange = () => { userPage = 1; loadUsers(); };
let searchTimer; $('#uSearch').oninput = () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => { userPage = 1; loadUsers(); }, 350); };
$('#userTable').addEventListener('click', e => {
  const t = e.target.closest('[data-toggle]'), r = e.target.closest('[data-reset]');
  if (t) run(t, async () => { await api(`/admin/users/${t.dataset.toggle}/active`, { method: 'PUT', body: { active: t.dataset.active === '1' } }); await loadUsers(); });
  if (r) {
    if (!confirm('Create a new temporary password for ' + r.dataset.email + '?')) return;
    run(r, async () => {
      const x = await api(`/admin/users/${r.dataset.reset}/reset-password`, { method: 'POST' });
      prompt('Temporary password (give it to the user, shown only once):', x.temp_password);
    });
  }
});
$('#staffForm').onsubmit = e => {
  e.preventDefault();
  run(e.submitter, async () => {
    await api('/admin/users', { method: 'POST', body: { name: $('#stname').value, email: $('#stemail').value, password: $('#stpass').value, role: $('#strole').value } });
    toast('Staff account created'); e.target.reset(); await loadUsers();
  });
};

/* ---------- Billing ---------- */
let billRows = [];
async function loadBills() {
  const q = new URLSearchParams({ status: $('#billStatus').value, q: $('#billSearch').value });
  billRows = await api('/billing?' + q);
  $('#billTable').innerHTML = billRows.length ? `<table><thead><tr><th>Date</th><th>Token</th><th>Patient</th><th>Doctor</th><th>Total</th><th>Status</th><th></th></tr></thead>
    <tbody>${billRows.map((b, i) => `<tr><td>${esc(fmtDate(b.date))}</td><td>${esc(b.token_no)}</td><td>${esc(b.patient_name)}</td><td>${esc(drName(b.doctor_name))}</td>
      <td class="num"><b>${money(b.total)}</b>${b.discount ? `<br><span class="small muted">discount ${money(b.discount)}</span>` : ''}</td>
      <td>${statusBadge(b.status)}${b.payment_method ? `<br><span class="small muted">${esc(b.payment_method)}</span>` : ''}</td>
      <td><button class="btn ghost sm" data-editbill="${i}">Edit</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">No bills found.</div>';
}
$('#billStatus').onchange = loadBills;
let billTimer; $('#billSearch').oninput = () => { clearTimeout(billTimer); billTimer = setTimeout(loadBills, 350); };
$('#billTable').addEventListener('click', e => {
  const b = e.target.closest('[data-editbill]');
  if (b) openBillEditor(billRows[Number(b.dataset.editbill)], loadBills);
});
document.addEventListener('click', e => {
  const x = e.target.closest('[data-export]');
  if (x) run(x, () => downloadCsv('/admin/export/' + x.dataset.export, `${x.dataset.export}.csv`));
});

/* ---------- Analytics ---------- */
let anDays = 7;
// Difference against the previous period: green = better, red = worse
function delta(cur, prev, { lowerBetter = false, points = false } = {}) {
  if (cur == null || prev == null) return '<span class="delta flat">no earlier data</span>';
  if (!points && prev === 0) return cur > 0 ? '<span class="delta good">new</span>' : '<span class="delta flat">no change</span>';
  const diff = points ? cur - prev : Math.round((cur - prev) / prev * 100);
  if (diff === 0) return '<span class="delta flat">no change</span>';
  const good = lowerBetter ? diff < 0 : diff > 0;
  return `<span class="delta ${good ? 'good' : 'bad'}">${diff > 0 ? '▲' : '▼'} ${Math.abs(diff)}${points ? ' pts' : '%'} vs previous</span>`;
}
function ratingDelta(c, p) {
  if (c == null || p == null) return '';
  const d = Math.round((c - p) * 10) / 10;
  return d === 0 ? '<span class="delta flat">no change</span>' : `<span class="delta ${d > 0 ? 'good' : 'bad'}">${d > 0 ? '▲' : '▼'} ${Math.abs(d)} vs previous</span>`;
}
const dayLabel = d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
const dayLong = d => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
const setText = (id, html) => { $(id).innerHTML = html; };

async function loadAnalytics() {
  const a = await api('/admin/analytics?days=' + anDays), cur = a.current, prev = a.previous;
  setText('#anRange', `${dayLong(a.from)} to ${dayLong(a.to)} · compared with the ${a.days} days before`);

  $('#anKpis').innerHTML =
    kpi('green', 'Appointments', cur.appointments, delta(cur.appointments, prev.appointments)) +
    kpi('blue', 'Completed visits', cur.completed, `${cur.completion_rate == null ? '-' : cur.completion_rate + '%'} completion rate<br>${delta(cur.completed, prev.completed)}`) +
    kpi('teal', 'Revenue collected', money(cur.revenue), delta(cur.revenue, prev.revenue)) +
    kpi('orange', 'Average waiting time', cur.avg_wait == null ? '-' : cur.avg_wait + ' min', delta(cur.avg_wait, prev.avg_wait, { lowerBetter: true })) +
    kpi('red', 'Missed appointments', cur.no_show_rate == null ? '-' : cur.no_show_rate + '%', `${cur.no_show} no-shows, ${cur.cancelled} cancelled<br>${delta(cur.no_show_rate, prev.no_show_rate, { lowerBetter: true, points: true })}`) +
    kpi('purple', 'Patient rating', cur.rating == null ? '-' : cur.rating + ' / 5', `${cur.rating_count} reviews<br>${ratingDelta(cur.rating, prev.rating)}`);

  // appointments vs completed
  const labels = a.daily.map(d => dayLabel(d.date));
  $('#chAppts').innerHTML = lineChart(labels, [
    { name: 'Appointments', color: C.green, values: a.daily.map(d => d.booked) },
    { name: 'Completed visits', color: C.blue, values: a.daily.map(d => d.completed) }]);
  const best = a.daily.slice().sort((x, y) => y.booked - x.booked)[0];
  setText('#inAppts', best && best.booked ? `Busiest day: <b>${esc(dayLong(best.date))}</b> with <b>${best.booked}</b> appointments. Average: <b>${Math.round(cur.appointments / a.days * 10) / 10}</b> per day. Walk-ins: <b>${cur.walk_in}</b>.` : 'No appointments in this period.');

  // revenue
  $('#chRev').innerHTML = lineChart(labels, [{ name: 'Revenue', color: C.teal, values: a.daily.map(d => d.revenue) }], { fmt: money, height: 220 });
  const bestRev = a.daily.slice().sort((x, y) => y.revenue - x.revenue)[0];
  setText('#inRev', cur.revenue ? `Total <b>${money(cur.revenue)}</b>${bestRev ? `, best day <b>${esc(dayLabel(bestRev.date))}</b> (${money(bestRev.revenue)})` : ''}.` : 'No payments collected in this period.');
  const pay = a.payment_methods.map(m => ({ name: m.name, value: m.v, color: METHOD_COLORS[m.name] || C.grey }));
  $('#chPay').innerHTML = donut(pay, { fmt: money, centerValue: compact(cur.revenue), centerLabel: 'collected' });
  const topPay = pay.slice().sort((x, y) => y.value - x.value)[0];
  setText('#inPay', topPay ? `Most payments are by <b>${esc(topPay.name)}</b> (${Math.round(topPay.value / (cur.revenue || 1) * 100)}%).` : 'No payments yet.');

  // status + priority
  const order = ['Completed', 'Booked', 'Waiting', 'In consultation', 'No-show', 'Cancelled'];
  $('#chStatus').innerHTML = donut(order.map(n => ({ name: n, value: (a.by_status.find(x => x.name === n) || {}).v || 0, color: STATUS_COLORS[n] })), { centerLabel: 'appointments' });
  setText('#inStatus', cur.completion_rate == null ? 'No finished appointments yet.' : `<b>${cur.completion_rate}%</b> of finished appointments were completed, <b>${cur.no_show_rate}%</b> were missed.`);
  const prio = ['emergency', 'high', 'mild', 'routine'].map(k => ({ name: PRIORITY_NAMES[k], value: (a.by_priority.find(x => x.name === k) || {}).v || 0, color: PRIORITY_COLORS[k] }));
  $('#chPrio').innerHTML = donut(prio, { centerLabel: 'patients' });
  const ptot = prio.reduce((x, y) => x + y.value, 0);
  setText('#inPrio', ptot ? `<b>${Math.round(prio[0].value / ptot * 100)}%</b> of patients came with an emergency.` : 'No patients yet.');

  // busiest hours
  $('#chHours').innerHTML = columnChart(a.peak_hours.map(h => ({ label: String(h.hour).padStart(2, '0'), value: h.value })), { color: C.blue, highlight: C.orange });
  const ph = a.peak_hours.slice().sort((x, y) => y.value - x.value)[0];
  setText('#inHours', ph && ph.value ? `Peak hour: <b>${String(ph.hour).padStart(2, '0')}:00 to ${String(ph.hour + 1).padStart(2, '0')}:00</b> with ${ph.value} check-ins (orange bar). Plan extra staff then.` : 'No check-ins in this period.');

  // wait by doctor, specialty, top doctors
  $('#chWait').innerHTML = hbarChart(a.wait_by_doctor.map(d => ({ name: drName(d.name), value: d.v, color: d.v > 30 ? C.red : d.v > 15 ? C.orange : C.green })), { fmt: v => v + ' min' });
  setText('#inWait', a.wait_by_doctor.length ? `Longest average wait: <b>${esc(drName(a.wait_by_doctor[0].name))}</b> (${a.wait_by_doctor[0].v} min). Green is under 15 min, orange is 15-30, red is over 30.` : 'No waiting-time data yet.');
  $('#chSpec').innerHTML = hbarChart(a.by_specialty.map(x => ({ name: x.name, value: x.v })));
  setText('#inSpec', a.by_specialty.length ? `Most in demand: <b>${esc(a.by_specialty[0].name)}</b> (${a.by_specialty[0].v} appointments).` : 'No data yet.');
  $('#chTop').innerHTML = hbarChart(a.top_doctors.map(d => ({ name: drName(d.name), value: d.v, note: d.rating ? '★ ' + d.rating : '' })), { color: C.green });
  setText('#inTop', a.top_doctors.length ? `<b>${esc(drName(a.top_doctors[0].name))}</b> completed the most visits (${a.top_doctors[0].v}).` : 'No completed visits yet.');
}
$('#anPeriod').addEventListener('click', e => {
  const b = e.target.closest('button[data-d]');
  if (!b) return;
  anDays = Number(b.dataset.d);
  document.querySelectorAll('#anPeriod button').forEach(x => x.classList.toggle('active', x === b));
  loadAnalytics().catch(err => toast(err.message, true));
});

/* ---------- Announcements, audit ---------- */
$('#annForm').onsubmit = e => {
  e.preventDefault();
  run(e.submitter, async () => { await api('/admin/announcements', { method: 'POST', body: { audience: $('#annAud').value, message: $('#annMsg').value } }); toast('Announcement sent'); e.target.reset(); });
};
async function loadAudit() {
  const r = await api('/admin/audit?page=' + auditPage);
  $('#auditTable').innerHTML = `<table><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Details</th><th>IP</th></tr></thead>
    <tbody>${r.logs.map(l => `<tr><td class="small">${esc(fmtTime(l.created_at))}</td><td>${l.user_name ? esc(l.user_name) + ` <span class="small muted">(${esc(l.user_role)})</span>` : '<span class="muted">-</span>'}</td>
      <td><b>${esc(l.action)}</b></td><td class="small">${esc(l.details || '')}</td><td class="small">${esc(l.ip || '')}</td></tr>`).join('')}</tbody></table>`;
  pager($('#auditPager'), r.page, r.pages, p => { auditPage = p; loadAudit(); });
}

loadOverview().catch(e => toast(e.message, true));
connectLive(() => document.querySelector('.tabs button.active').dataset.tab === 'overview' ? loadOverview() : null);
