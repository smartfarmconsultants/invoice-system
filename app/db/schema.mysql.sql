-- MySQL/MariaDB schema variant (for HostPinnacle shared hosting plans)

CREATE TABLE IF NOT EXISTS users (
    id                    INT AUTO_INCREMENT PRIMARY KEY,
    full_name             VARCHAR(100) NOT NULL,
    email                 VARCHAR(120) NOT NULL UNIQUE,
    password_hash         VARCHAR(255) NOT NULL,
    role                  ENUM('admin','manager','clerk') NOT NULL,
    status                TINYINT(1) NOT NULL DEFAULT 1,
    must_change_password  TINYINT(1) NOT NULL DEFAULT 1,
    failed_login_count    INT NOT NULL DEFAULT 0,
    locked_until          DATETIME NULL,
    created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS customers (
    id            INT AUTO_INCREMENT PRIMARY KEY,
    customer_name VARCHAR(150) NOT NULL,
    phone         VARCHAR(30),
    email         VARCHAR(120),
    address       TEXT,
    created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoices (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    invoice_number  VARCHAR(30) UNIQUE,
    customer_id     INT NOT NULL,
    invoice_date    DATE NOT NULL,
    due_date        DATE,
    subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax             DECIMAL(12,2) NOT NULL DEFAULT 0,
    total           DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount        DECIMAL(12,2) NOT NULL DEFAULT 0,
    status          ENUM('draft','sent','paid','overdue','void') NOT NULL DEFAULT 'draft',
    created_by      INT NOT NULL,
    pdf_path        VARCHAR(255),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id),
    FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS invoice_items (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    invoice_id  INT NOT NULL,
    description VARCHAR(255) NOT NULL,
    quantity    DECIMAL(10,2) NOT NULL DEFAULT 1,
    unit_price  DECIMAL(12,2) NOT NULL DEFAULT 0,
    amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
    FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_log (
    id          INT AUTO_INCREMENT PRIMARY KEY,
    user_id     INT,
    action      VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50),
    entity_id   INT,
    ip_address  VARCHAR(45),
    details     TEXT,
    created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- Note: for MySQL-hosted sessions, use `express-mysql-session` in place of
-- connect-pg-simple in server.js (see comment there).

CREATE TABLE IF NOT EXISTS app_settings (
    id                    INT PRIMARY KEY DEFAULT 1,
    company_name          VARCHAR(150) NOT NULL DEFAULT 'SmartFarm Consultants Kenya',
    company_address       VARCHAR(255) NOT NULL DEFAULT 'smartfarmconsultants.co.ke',
    company_contact       VARCHAR(255) NOT NULL DEFAULT 'Tel: +254 711 580 975 | smartfarmconsultants@gmail.com',
    payment_instructions  TEXT NOT NULL,
    default_tax_rate      DECIMAL(5,2) NOT NULL DEFAULT 16,
    updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CHECK (id = 1)
) ENGINE=InnoDB;
INSERT IGNORE INTO app_settings (id, payment_instructions) VALUES (1, 'Bank transfer — details on file. Paybill 400200, A/C 1183282.');
