const user = guard(['receptionist', 'admin']);
let chosenPatient = null, payingBill = null, bills = [];

const show = tabs(name => { if (name === 'billing') loadBills(); });
const catOptions = () => Object.entries(CATEGORIES).reverse().map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');

function tokenSlip(a) {
  printHtml('Token ' + a.token_no, `<div style="text-align:center"><p class="muted">Your token</p><div class="big">${esc(a.token_no)}</div>
    <p><b>${esc(drName(a.doctor_name))}</b><br>${esc(a.specialty)} · Room ${esc(a.room)}</p>
    <p>Priority: <b>${esc(a.label)}</b>${a.patients_ahead != null ? ` · Patients ahead: <b>${a.patients_ahead}</b> · Estimated wait: <b>${a.estimated_wait} min</b>` : ''}</p>
    <p class="muted">Please wait in the waiting area and watch the display board for your token.</p></div>`);
}
function resultBox(a) {
  return `<div class="callout go">Token <b style="font-size:1.6rem">${esc(a.token_no)}</b> for ${esc(drName(a.doctor_name))}, Room ${esc(a.room)}.<br>
    Priority: ${labelBadge(a.label)}${a.status === 'Waiting' ? ` · Patients ahead: ${a.patients_ahead} · Estimated wait: ${a.estimated_wait} min` : ` · Date: ${esc(fmtDate(a.date))}`}
    <div class="row" style="margin-top:8px"><button class="btn ghost sm" data-slip='${esc(JSON.stringify(a))}'>Print token slip</button></div></div>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-slip]');
  if (b) tokenSlip(JSON.parse(b.dataset.slip));
});

/* ---------- Walk-in and today's list ---------- */
async function loadToday() {
  const list = await api('/reception/today');
  $('#today').innerHTML = list.length ? `<table>
    <thead><tr><th>Token</th><th>Patient</th><th>Doctor</th><th>Priority</th><th>Status</th><th>Bill</th><th></th></tr></thead>
    <tbody>${list.map(a => `<tr>
      <td><b>${esc(a.token_no)}</b></td><td>${esc(a.patient_name)}<br><span class="small muted">${esc(a.patient_phone || '')}</span></td>
      <td>${esc(drName(a.doctor_name))}<br><span class="small muted">Room ${esc(a.room)}</span></td>
      <td>${labelBadge(a.label)}</td><td>${statusBadge(a.status)}</td>
      <td>${a.bill_status ? statusBadge(a.bill_status) : ''}</td>
      <td>${a.status === 'Booked' ? `<button class="btn sm" data-checkin="${a.id}">Check in</button>` : ''}
          ${a.status === 'No-show' ? `<button class="btn ghost sm" data-requeue="${a.id}">Back in queue</button>` : ''}</td>
    </tr>`).join('')}</tbody></table>` : '<div class="empty">No appointments today.</div>';
}
$('#today').addEventListener('click', e => {
  const c = e.target.closest('[data-checkin]'), r = e.target.closest('[data-requeue]');
  if (c) run(c, async () => { await api('/reception/checkin/' + c.dataset.checkin, { method: 'POST' }); toast('Patient checked in'); await loadToday(); });
  if (r) run(r, async () => { await api('/reception/requeue/' + r.dataset.requeue, { method: 'POST' }); toast('Patient is back in the queue'); await loadToday(); });
});
$('#walkForm').onsubmit = e => {
  e.preventDefault();
  run(e.submitter, async () => {
    const a = await api('/reception/walkin', { method: 'POST', body: {
      name: $('#wname').value, age: Number($('#wage').value), gender: $('#wgender').value, phone: $('#wphone').value,
      doctor_id: Number($('#wdoc').value), symptom_category: $('#wcat').value, symptoms: $('#wsym').value, chronic_flag: $('#wchronic').checked } });
    $('#result').innerHTML = resultBox(a);
    e.target.reset();
    await loadToday();
  });
};

/* ---------- Find patient and book ---------- */
let findTimer;
$('#pq').oninput = () => {
  clearTimeout(findTimer);
  findTimer = setTimeout(async () => {
    const q = $('#pq').value.trim();
    if (q.length < 2) { $('#presults').innerHTML = ''; return; }
    try {
      const list = await api('/reception/patients?q=' + encodeURIComponent(q));
      $('#presults').innerHTML = list.length ? list.map(p => `<button type="button" class="doc" data-pid="${p.patient_id}" data-pname="${esc(p.name)}">
        <b>${esc(p.name)}</b> <span class="muted">· ${p.age} yrs${p.gender ? ', ' + esc(p.gender) : ''}</span>
        <div class="small muted">${esc(p.phone || 'no phone')} · ${esc(p.email)}</div></button>`).join('') : '<p class="muted">No patient found.</p>';
    } catch (e) { toast(e.message, true); }
  }, 350);
};
$('#presults').addEventListener('click', e => {
  const b = e.target.closest('[data-pid]');
  if (!b) return;
  chosenPatient = Number(b.dataset.pid);
  $('#pchosen').innerHTML = `Booking for <b>${esc(b.dataset.pname)}</b>`;
  $('#bookBtn').disabled = false;
  document.querySelectorAll('#presults .doc').forEach(x => x.classList.toggle('sel', x === b));
});
$('#bookForm').onsubmit = e => {
  e.preventDefault();
  run(e.submitter, async () => {
    const a = await api('/reception/book', { method: 'POST', body: {
      patient_id: chosenPatient, doctor_id: Number($('#bdoc').value), date: $('#bdate').value,
      symptom_category: $('#bcat').value, symptoms: $('#bsym').value, checkin: $('#bcheckin').checked } });
    $('#bresult').innerHTML = resultBox(a);
    toast('Appointment booked');
    await loadToday();
  });
  // run() re-enables the button, so keep it disabled when nobody is selected
  if (!chosenPatient) $('#bookBtn').disabled = true;
};

/* ---------- Billing counter ---------- */
async function loadBills() {
  const q = new URLSearchParams({ status: $('#billFilter').value, q: $('#billSearch').value });
  bills = await api('/billing?' + q);
  $('#billTable').innerHTML = bills.length ? `<table><thead><tr><th>Date</th><th>Token</th><th>Patient</th><th>Doctor</th><th>Amount</th><th>Status</th><th></th></tr></thead>
    <tbody>${bills.map((b, i) => `<tr><td>${esc(fmtDate(b.date))}</td><td>${esc(b.token_no)}</td><td>${esc(b.patient_name)}</td><td>${esc(drName(b.doctor_name))}</td>
      <td class="num"><b>${money(b.total)}</b>${b.discount ? `<br><span class="small muted">discount ${money(b.discount)}</span>` : ''}</td>
      <td>${statusBadge(b.status)}${b.payment_method ? `<br><span class="small muted">${esc(b.payment_method)}</span>` : ''}</td>
      <td><div class="row">${b.status === 'Pending' ? `<button class="btn sm" data-pay="${i}">Collect payment</button>` : ''}
        ${b.status === 'Paid' ? `<button class="btn ghost sm" data-receipt="${i}">Print receipt</button>` : ''}
        <button class="btn ghost sm" data-editbill="${i}">Edit</button></div></td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">No bills here.</div>';
}
$('#billFilter').onchange = loadBills;
let billTimer; $('#billSearch').oninput = () => { clearTimeout(billTimer); billTimer = setTimeout(loadBills, 350); };
$('#billTable').addEventListener('click', e => {
  const p = e.target.closest('[data-pay]'), r = e.target.closest('[data-receipt]'), ed = e.target.closest('[data-editbill]');
  if (ed) openBillEditor(bills[Number(ed.dataset.editbill)], async () => { await loadBills(); await loadToday(); });
  if (p) {
    payingBill = bills[Number(p.dataset.pay)];
    $('#payInfo').innerHTML = `${esc(payingBill.patient_name)} · ${esc(drName(payingBill.doctor_name))}<br>Amount due: <b>${money(Number(payingBill.amount) + Number(payingBill.extra_charges))}</b>`;
    $('#payDiscount').value = 0;
    $('#payDlg').showModal();
  }
  if (r) {
    const x = bills[Number(r.dataset.receipt)];
    printHtml('Receipt', `<h2>Payment receipt #${x.id}</h2><p><b>Patient:</b> ${esc(x.patient_name)}<br><b>Doctor:</b> ${esc(drName(x.doctor_name))}<br><b>Visit:</b> ${esc(fmtDate(x.date))} · Token ${esc(x.token_no)}</p>
      <table><tr><td>Consultation fee</td><td>${money(x.amount)}</td></tr><tr><td>Extra charges</td><td>${money(x.extra_charges)}</td></tr>
      <tr><td>Discount</td><td>- ${money(x.discount)}</td></tr><tr><th>Total paid</th><th>${money(x.total)}</th></tr></table>
      <p><b>Paid by:</b> ${esc(x.payment_method || '')} on ${esc(fmtTime(x.paid_at))}</p>`);
  }
});
$('#payCancel').onclick = () => $('#payDlg').close();
$('#payConfirm').onclick = e => run(e.target, async () => {
  await api(`/reception/bills/${payingBill.id}/pay`, { method: 'POST', body: { method: $('#payMethod').value, discount: Number($('#payDiscount').value || 0) } });
  $('#payDlg').close(); toast('Payment recorded'); await loadBills(); await loadToday();
});

/* ---------- Init ---------- */
(async function init() {
  $('#wcat').innerHTML = catOptions(); $('#bcat').innerHTML = catOptions();
  $('#bdate').min = todayStr(); $('#bdate').max = plusDays(30); $('#bdate').value = todayStr();
  try {
    const docs = await api('/doctors');
    const opts = docs.map(d => `<option value="${d.id}">${esc(drName(d.name))} - ${esc(d.specialty)} (Room ${esc(d.room)}, ${esc(d.status)})</option>`).join('');
    $('#wdoc').innerHTML = opts; $('#bdoc').innerHTML = opts;
    await loadToday();
  } catch (e) { toast(e.message, true); }
  connectLive(() => document.querySelector('.tabs button.active').dataset.tab === 'queue' ? loadToday() : null);
})();
