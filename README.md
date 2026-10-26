# MediQueue: Priority-Aware Real-Time Queue Management for Hospital OPDs

**MediQueue** is a web-based hospital Outpatient Department (OPD) management system designed to improve patient queue transparency, appointment management, and doctor availability tracking. It uses a rule-based priority scoring mechanism to prioritize patients according to symptom severity, age, chronic conditions, and waiting time.

The system provides separate interfaces for patients, doctors, receptionists, and administrators, along with a public queue display and real-time updates.

## 🎯 Objectives

- Develop an integrated web-based OPD management system.
- Enable online appointment booking and token generation.
- Provide QR-assisted and button-based patient check-in.
- Display live queue position and estimated waiting time.
- Prioritize patients using a transparent scoring algorithm.
- Display doctor availability and status.
- Manage digital prescriptions and visit history.
- Integrate billing with completed consultations.
- Provide role-based access control and administrative analytics.
- Improve emergency queue handling while reducing indefinite waits for routine patients.

## ✨ Key Features

### 👤 Patient Module
- Patient registration and login.
- Appointment booking by specialty and doctor.
- Symptom selection during booking.
- Token generation and QR-assisted check-in.
- Live queue position and estimated waiting time.
- Doctor status and room information.
- Digital prescriptions and visit history.

### 🩺 Doctor Module
- View and manage the patient queue.
- Identify patients according to priority.
- Update consultation status.
- Record vitals, diagnosis, medicines, and tests.
- Add follow-up dates and consultation charges.
- Complete patient visits.

### 🏥 Receptionist Module
- Manage patient appointments and walk-ins.
- Assist with patient check-in.
- Monitor queue status.
- Handle billing and payment records.

### 📊 Administrator Module
- Monitor hospital-wide patient flow.
- View daily summaries and alerts.
- Track doctor availability and queue status.
- Access specialty-wise and doctor-wise analytics.

### ⚡ Real-Time Queue Management
- Live queue updates using WebSocket communication.
- Doctor status updates.
- Public queue display using token numbers.
- Audit logging for important operations.
- Role-restricted access to sensitive operations.

## 🧠 AI Concepts Used

MediQueue uses **rule-based decision-making and priority scheduling**, rather than a trained machine-learning model, for its core patient-prioritization mechanism.

1. **Rule-Based Classification:** Patients are assigned priority levels using predefined symptom weights and score thresholds.
2. **Priority Queue:** Patients are ordered by their calculated priority score rather than only by arrival time.
3. **Waiting-Time Aging:** A patient's score increases with waiting time to reduce starvation of lower-priority patients.
4. **Waiting-Time Estimation:** The system estimates waiting time using the number of patients ranked ahead and the average consultation duration.
5. **Simulation-Based Evaluation:** The queue strategy is compared with First-Come, First-Served (FCFS) and static-priority scheduling.

## ⚙️ Priority Scoring Algorithm

The priority score is calculated using:

`S(p,t) = b(p) + α × (t − a(p))`

Where:

- `S(p,t)` = Current priority score of a patient.
- `b(p)` = Base score determined by symptoms and patient factors.
- `α` = Waiting-time aging rate, set to **0.5 points per minute**.
- `t` = Current time.
- `a(p)` = Patient's check-in time.

### Base Priority Weights

| Condition | Points |
|---|---:|
| Chest pain, breathing difficulty, or severe bleeding | 100 |
| High fever, fracture, or injury | 30 |
| Cold or cough | 10 |
| Routine check-up | 0 |
| Age under 5 or over 60 | +30 |
| Chronic condition | +20 |

Priority categories:

- **Emergency:** Score ≥ 100
- **High:** Score 40–99
- **Normal:** Score below 40

These are prototype scoring rules and have not been clinically validated. MediQueue supports workflow coordination and does not replace professional medical triage.

## 🛠️ Technology Stack

The project report describes the following technologies:

| Component | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js, Express.js |
| Database | SQLite or MySQL |
| Authentication | JSON Web Tokens (JWT) |
| Password Security | Password hashing |
| APIs | REST APIs |
| Real-Time Communication | WebSockets |
| Simulation | JavaScript |
| Result Visualization | Python |

The system is designed using a three-tier client-server architecture.

## 🏗️ System Architecture

```text
Users / Client Interfaces
          |
          | HTTP / REST / WebSocket
          v
Node.js / Express.js Server
          |
          |-- Authentication
          |-- Role-Based Access Control
          |-- Priority Calculation
          |-- Queue Management
          |-- Billing and Audit Logging
          |-- Real-Time Updates
          |
          v
     SQLite / MySQL
          |
          |-- Patients
          |-- Appointments
          |-- Queue Records
          |-- Prescriptions
          |-- Billing Records
          |-- Audit Logs
```

The research paper describes 57 REST endpoints.

## 🔄 Appointment Workflow

1. Patient registration and login.
2. Appointment booking and symptom selection.
3. Priority score calculation and token generation.
4. Patient arrival and QR/button check-in.
5. Entry into the live queue.
6. Doctor consultation and visit-record entry.
7. Prescription generation.
8. Billing and payment recording.
9. Appointment completion and visit history update.

Appointment states include **Booked, Waiting, In Consultation, Completed, Cancelled, and No-show**.

## 📈 Simulation Results

The research evaluation uses a discrete-event simulation of a single-doctor OPD session. It uses assumed parameters and synthetic arrivals, not real patient data.

At 90% offered load:

| Queue Policy | Emergency Mean Waiting Time |
|---|---:|
| First-Come, First-Served (FCFS) | 20.6 minutes |
| Static Priority | 5.2 minutes |
| MediQueue with Aging | 5.2 minutes |

The simulated Emergency mean waiting time decreased by approximately **75%** compared with FCFS.

For Routine patients at the same load:

| Queue Policy | Routine Mean Waiting Time |
|---|---:|
| FCFS | 20.7 minutes |
| Static Priority | 32.0 minutes |
| MediQueue with Aging | 28.7 minutes |

The aging mechanism reduced the longest observed Routine wait by approximately 28% relative to static priority in the simulation.

**Important:** These are simulation results, not clinical evidence or guaranteed real-world performance. Overall mean waiting time remained approximately unchanged because priority scheduling redistributes waiting time among patient classes.

## 🔐 Security and Privacy

- JWT-based authentication.
- Password hashing.
- Role-based access control.
- Role-restricted billing operations.
- Audit logging for payment changes.
- Public queue display using token numbers rather than patient names.

Do not commit passwords, API keys, database credentials, real patient information, or `.env` files to GitHub.

## 🚀 Getting Started

The exact installation commands depend on the project files included in the repository.

### Prerequisites

- Node.js and npm.
- A supported browser.
- SQLite or MySQL, depending on the configured database.
- Python, if required for simulation and plotting scripts.

### Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/YOUR-USERNAME/MediQueue.git
   cd MediQueue
   ```

2. Install dependencies using the package manager and dependency files included in the project.

3. Configure the required environment variables and database settings using the project's setup instructions. Do not upload secret values.

4. Start the backend and frontend using the scripts defined in the project's configuration files.

5. Open the local application URL printed in the terminal.

> **Note:** Replace `YOUR-USERNAME` with your GitHub username. Check the actual project structure and README instructions before running commands; frontend and backend startup commands may differ.

## 🧪 Research Evaluation

The simulation compares three queue policies:

- First-Come, First-Served (FCFS).
- Static priority scheduling.
- MediQueue priority scheduling with waiting-time aging.

The reported setup uses 3,000 simulated sessions per load level, a 240-minute session, and a mean consultation time of 10 minutes.

No real patient data or external dataset was used in this evaluation.

## ⚠️ Limitations

- Priority weights are heuristic and not clinically validated.
- Evaluation is based on a simulated single-doctor OPD.
- Real hospital arrival patterns and multiple-doctor scenarios require further study.
- Waiting-time estimates can be optimistic under heavy load.
- A supervised pilot and
