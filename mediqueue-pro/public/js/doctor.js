const user = guard('doctor');
let data = null;
let renderedCurrent = null;   // id of the consultation shown in the form (so live updates do not wipe what is typed)
let medicineNames = [];

tabs(name => { if (name === 'schedule') loadSchedule(); });

function patientInfo(p) {
  return `<div class="docline">
    <span><b>${esc(p.patient_name)}</b>, ${p.age} yrs${p.gender ? ', ' + esc(p.gender) : ''}</span>
    ${p.blood_group ? `<span>Blood group ${esc(p.blood_group)}</span>` : ''}
    ${p.chronic_flag ? '<span class="badge b-high">Chronic condition</span>' : ''}${labelBadge(p.label)}
  </div>
  <p style="margin:8px 0 0"><b>Symptoms:</b> ${esc(p.symptoms || CATEGORIES[p.symptom_category])}</p>
  <p style="margin:4px 0 0"><b>Medical history:</b> ${esc(p.medical_history || 'None recorded')}</p>
  ${p.allergies ? `<p style="margin:4px 0 0" class="callout warn"><b>Allergies:</b> ${esc(p.allergies)}</p>` : ''}`;
}

function renderHeader() {
  const d = data.doctor;
  $('#docName').textContent = drName(d.name);
  $('#docMeta').textContent = `${d.specialty} · Room ${d.room} · Fee ${money(d.consultation_fee)}`;
  $('#statusBtns').innerHTML = STATUS_OPTIONS.map(s =>
    `<button class="btn ghost ${d.status === s ? 'active' : ''}" data-status="${esc(s)}">${esc(s)}</button>`).join('');
  $('#stWaiting').textContent = data.stats.waiting;
  $('#stSeen').textContent = data.stats.seen;
  $('#stMissed').textContent = data.stats.missed;
  $('#stAvg').textContent = data.stats.avg_actual ?? d.avg_consult_time;
  $('#callNext').disabled = !!data.current || data.stats.waiting === 0 || d.status !== 'In OPD';
  $('#callNext').title = d.status !== 'In OPD' ? 'Set your status to In OPD first'
    : data.current ? 'Complete the current visit first' : data.stats.waiting === 0 ? 'The queue is empty' : '';
}

function renderCurrent() {
  const c = data.current;
  const id = c ? c.id : null;
  if (id === renderedCurrent) return;      // same patient: keep what the doctor has typed
  renderedCurrent = id;
  if (!c) { $('#current').innerHTML = ''; return; }
  $('#current').innerHTML = `
    <div class="card" style="border:2px solid var(--g600)">
      <div class="row between"><h2 style="margin:0;border:0">Now consulting: ${esc(c.token_no)}</h2>
        <div class="row"><button class="btn ghost sm" data-hist="${c.patient_id}" data-name="${esc(c.patient_name)}">View past visits</button>
        <button class="btn danger sm" id="skipBtn">Patient not here (skip)</button></div></div>
      ${patientInfo(c)}
      <h3 style="margin-top:16px">Vitals (optional)</h3>
      <div class="form-grid">
        <div><label for="vbp">Blood pressure</label><input id="vbp" placeholder="120/80" maxlength="7"></div>
        <div><label for="vtemp">Temperature (°C)</label><input id="vtemp" type="number" step="0.1" min="30" max="45"></div>
        <div><label for="vpulse">Pulse (per min)</label><input id="vpulse" type="number" min="30" max="250"></div>
        <div><label for="vweight">Weight (kg)</label><input id="vweight" type="number" step="0.1" min="1" max="400"></div>
      </div>
      <label for="diag">Diagnosis</label><input id="diag" maxlength="255">
      <label for="notes">Notes and advice</label>
      <textarea id="notes" maxlength="2000" placeholder="Advice, follow-up instructions"></textarea>
      <label for="medPick">Add a medicine</label>
      <div class="row"><input id="medPick" list="medList" placeholder="Start typing a medicine name" style="flex:1;min-width:200px">
        <button class="btn ghost" id="addMed" type="button">Add</button></div>
      <datalist id="medList">${medicineNames.map(m => `<option value="${esc(m)}">`).join('')}</datalist>
      <label for="meds">Prescription (one medicine per line, add dose and days)</label>
      <textarea id="meds" maxlength="2000" placeholder="Paracetamol 500mg - 1-0-1 - 5 days"></textarea>
      <div class="form-grid">
        <div><label for="tests">Tests advised</label><input id="tests" maxlength="500" placeholder="CBC, X-ray chest"></div>
        <div><label for="follow">Follow-up date</label><input id="follow" type="date" min="${todayStr()}"></div>
        <div><label for="extra">Extra charges (Rs.)</label><input id="extra" type="number" min="0" max="100000" placeholder="0"></div>
      </div>
      <p class="small muted">The consultation fee (${money(data.doctor.consultation_fee)}) plus any extra charges is added to the patient's bill.</p>
      <p><button class="btn lg" id="complete" data-id="${c.id}">Complete visit</button></p>
    </div>`;
}

function renderQueue() {
  const q = data.queue;
  $('#queue').innerHTML = q.length ? `<table>
    <thead><tr><th>#</th><th>Token</th><th>Patient</th><th>Priority</th><th>Waited</th><th>Symptoms</th><th>History</th><th></th></tr></thead>
    <tbody>${q.map((p, i) => `<tr>
      <td class="num">${i + 1}</td><td><b>${esc(p.token_no)}</b></td>
      <td>${esc(p.patient_name)}<br><span class="small muted">${p.age} yrs${p.gender ? ', ' + esc(p.gender) : ''}</span></td>
      <td>${labelBadge(p.label)}<br><span class="small muted">score ${p.total_score}</span></td>
      <td class="num">${p.waited_min} min</td>
      <td>${esc(p.symptoms || CATEGORIES[p.symptom_category])}</td>
      <td class="small">${p.chronic_flag ? '<span class="badge b-high">Chronic</span> ' : ''}${esc(p.medical_history || '-')}${p.allergies ? `<br><b>Allergy:</b> ${esc(p.allergies)}` : ''}</td>
      <td><button class="btn ghost sm" data-hist="${p.patient_id}" data-name="${esc(p.patient_name)}">Past visits</button></td>
    </tr>`).join('')}</tbody></table>` : '<div class="empty">No patients are waiting right now.</div>';
}

function renderWeek() {
  $('#weekChart').innerHTML = columnChart(
    data.week.map(w => ({ label: new Date(w.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' }), value: w.seen })), { color: C.green, highlight: C.blue });
}

async function load() {
  data = await api('/doctor/dashboard');
  renderHeader(); renderCurrent(); renderQueue(); renderWeek();
}

document.addEventListener('click', e => {
  const st = e.target.closest('[data-status]');
  if (st) return run(st, async () => { await api('/doctor/status', { method: 'PUT', body: { status: st.dataset.status } }); await load(); });

  const hist = e.target.closest('[data-hist]');
  if (hist) return run(hist, async () => {
    const list = await api('/doctor/history/' + hist.dataset.hist);
    $('#historyTitle').textContent = 'Past visits: ' + hist.dataset.name;
    $('#historyBody').innerHTML = list.length ? list.map(v => `
      <div class="visit"><b>${esc(drName(v.doctor_name))}</b> <span class="muted">· ${esc(v.specialty)} · ${esc(fmtDate(v.date))}</span>
        ${v.symptoms ? `<div class="small muted">Reason: ${esc(v.symptoms)}</div>` : ''}
        ${v.diagnosis ? `<p style="margin:4px 0 0"><b>Diagnosis:</b> ${esc(v.diagnosis)}</p>` : ''}
        ${v.notes ? `<p class="pre"><b>Notes:</b> ${esc(v.notes)}</p>` : ''}
        ${v.medicines ? `<p class="pre"><b>Prescription:</b>\n${esc(v.medicines)}</p>` : ''}</div>`).join('')
      : '<p class="muted">No earlier completed visits.</p>';
    $('#historyDlg').showModal();
  });

  if (e.target.id === 'addMed') {
    const v = $('#medPick').value.trim();
    if (!v) return;
    const box = $('#meds');
    box.value = (box.value ? box.value.replace(/\n?$/, '\n') : '') + v + ' - ';
    $('#medPick').value = '';
    box.focus();
  }

  if (e.target.id === 'skipBtn') {
    if (!confirm('Mark this patient as not present? They will be told to see the reception.')) return;
    run(e.target, async () => { await api('/doctor/skip', { method: 'POST' }); toast('Patient marked as missed'); renderedCurrent = undefined; await load(); });
  }

  if (e.target.id === 'complete') run(e.target, async () => {
    await api('/doctor/complete', { method: 'POST', body: {
      appointment_id: Number(e.target.dataset.id), diagnosis: $('#diag').value, notes: $('#notes').value, medicines: $('#meds').value,
      tests_advised: $('#tests').value, follow_up_date: $('#follow').value, bp: $('#vbp').value, temperature: $('#vtemp').value,
      pulse: $('#vpulse').value, weight: $('#vweight').value, extra_charges: $('#extra').value } });
    toast('Visit completed. Prescription saved and bill created.');
    renderedCurrent = undefined;
    await load();
  });
});
$('#closeDlg').onclick = () => $('#historyDlg').close();

$('#callNext').onclick = e => run(e.target, async () => {
  const r = await api('/doctor/call-next', { method: 'POST' });
  toast(`Called ${r.called}. The patient has been notified.`);
  await load();
}).then(() => data && renderHeader());   // run() re-enables the button, so apply the real state again

/* ---------- Schedule ---------- */
async function loadSchedule() { scheduleEditor($('#schedEditor'), await api('/doctor/schedule')); }
$('#saveSched').onclick = e => run(e.target, async () => {
  await api('/doctor/schedule', { method: 'PUT', body: { days: readSchedule($('#schedEditor')) } });
  toast('Schedule saved');
});

(async function init() {
  try {
    medicineNames = await api('/medicines');
    await load();
  } catch (e) { toast(e.message, true); }
  connectLive(() => document.querySelector('.tabs button.active').dataset.tab === 'today' ? load() : null);
})();
