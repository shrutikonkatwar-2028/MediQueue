-- MediQueue database schema (MySQL 5.7+ / 8.x / MariaDB 10.4+)
-- Run with:  npm run db:init   (safe to run again, it never deletes data)

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(120) NOT NULL UNIQUE,
  phone VARCHAR(20),
  password VARCHAR(100) NOT NULL,
  role ENUM('patient','doctor','admin','receptionist') NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  last_login DATETIME NULL,
  KEY idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS specialties (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS doctors (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  specialty_id INT NOT NULL,
  room VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Not in hospital',
  avg_consult_time INT NOT NULL DEFAULT 10,
  experience INT NOT NULL DEFAULT 0,
  consultation_fee DECIMAL(10,2) NOT NULL DEFAULT 500,
  max_daily_patients INT NOT NULL DEFAULT 40,
  qualification VARCHAR(120),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (specialty_id) REFERENCES specialties(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Weekly working days of a doctor (weekday 0 = Sunday ... 6 = Saturday).
-- A doctor with no rows can be booked on any day.
CREATE TABLE IF NOT EXISTS doctor_schedules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  doctor_id INT NOT NULL,
  weekday TINYINT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  UNIQUE KEY uq_doctor_weekday (doctor_id, weekday),
  FOREIGN KEY (doctor_id) REFERENCES doctors(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS patients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL UNIQUE,
  dob DATE NOT NULL,
  gender VARCHAR(10),
  blood_group VARCHAR(5),
  medical_history VARCHAR(500),
  allergies VARCHAR(200),
  chronic_flag TINYINT(1) NOT NULL DEFAULT 0,
  address VARCHAR(200),
  emergency_contact VARCHAR(100),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS appointments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  patient_id INT NOT NULL,
  doctor_id INT NOT NULL,
  date DATE NOT NULL,
  symptoms VARCHAR(500),
  symptom_category VARCHAR(20) NOT NULL,
  priority_score INT NOT NULL,
  token_no VARCHAR(10) NOT NULL,
  status ENUM('Booked','Waiting','In consultation','Completed','Cancelled','No-show') NOT NULL DEFAULT 'Booked',
  source ENUM('online','walk-in') NOT NULL DEFAULT 'online',
  qr_code VARCHAR(40) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL,
  arrived_at DATETIME NULL,
  called_at DATETIME NULL,
  completed_at DATETIME NULL,
  UNIQUE KEY uq_doctor_date_token (doctor_id, date, token_no),
  KEY idx_doctor_date_status (doctor_id, date, status),
  KEY idx_patient_status (patient_id, status),
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (doctor_id) REFERENCES doctors(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS prescriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  appointment_id INT NOT NULL UNIQUE,
  diagnosis VARCHAR(255),
  notes TEXT,
  medicines TEXT,
  tests_advised VARCHAR(500),
  follow_up_date DATE NULL,
  bp VARCHAR(10),
  temperature DECIMAL(4,1) NULL,
  pulse INT NULL,
  weight DECIMAL(5,1) NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS bills (
  id INT AUTO_INCREMENT PRIMARY KEY,
  appointment_id INT NOT NULL UNIQUE,
  amount DECIMAL(10,2) NOT NULL,
  extra_charges DECIMAL(10,2) NOT NULL DEFAULT 0,
  discount DECIMAL(10,2) NOT NULL DEFAULT 0,
  total DECIMAL(10,2) NOT NULL,
  status ENUM('Pending','Paid','Waived') NOT NULL DEFAULT 'Pending',
  payment_method VARCHAR(20) NULL,
  paid_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  KEY idx_bills_status (status),
  FOREIGN KEY (appointment_id) REFERENCES appointments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS feedback (
  id INT AUTO_INCREMENT PRIMARY KEY,
  appointment_id INT NOT NULL UNIQUE,
  rating TINYINT NOT NULL,
  comment VARCHAR(300),
  created_at DATETIME NOT NULL,
  FOREIGN KEY (appointment_id) REFERENCES appointments(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS medicines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  message VARCHAR(300) NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  KEY idx_notif_user (user_id, is_read),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  action VARCHAR(40) NOT NULL,
  details VARCHAR(255),
  ip VARCHAR(45),
  created_at DATETIME NOT NULL,
  KEY idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
