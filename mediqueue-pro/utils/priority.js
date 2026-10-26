// Smart priority logic (Section 7 of the project report)
// Score = symptom weight + age bonus + condition bonus + waiting-time bonus

const SYMPTOMS = {
  emergency: { label: 'Chest pain / breathing difficulty / severe bleeding', points: 100 },
  high:      { label: 'High fever / fracture / injury', points: 30 },
  mild:      { label: 'Cold or cough', points: 10 },
  routine:   { label: 'Routine checkup', points: 0 }
};

// Fixed when the appointment is booked (everything except waiting time)
function baseScore({ category, age, chronic }) {
  let s = SYMPTOMS[category].points;
  if (age < 5 || age > 60) s += 30;
  if (chronic) s += 20;
  return s;
}

// +0.5 per minute since the patient checked in
function waitBonus(arrivedAt) {
  if (!arrivedAt) return 0;
  const mins = Math.max(0, (Date.now() - Date.parse(arrivedAt)) / 60000);
  return Math.round(mins * 0.5 * 10) / 10;
}

const totalScore = (base, arrivedAt) => Math.round((base + waitBonus(arrivedAt)) * 10) / 10;

// 100+ Emergency, 40-99 High, below 40 Normal
function label(score) {
  if (score >= 100) return 'Emergency';
  if (score >= 40) return 'High';
  return 'Normal';
}

module.exports = { SYMPTOMS, baseScore, waitBonus, totalScore, label };
