-- PostgreSQL schema for the invoice system

CREATE TABLE IF NOT EXISTS users (
    id                  SERIAL PRIMARY KEY,
    full_name           VARCHAR(100) NOT NULL,
    email               VARCHAR(120) NOT NULL UNIQUE,
    password_hash       VARCHAR(255) NOT NULL,
    role                VARCHAR(20) NOT NULL CHECK (role IN ('admin','manager','clerk')),
    status              BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
    failed_login_count  INTEGER NOT NULL DEFAULT 0,
    locked_until        TIMESTAMP NULL,
    created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
    id            SERIAL PRIMARY KEY,
    customer_name VARCHAR(150) NOT NULL,
    phone         VARCHAR(30),
    email         VARCHAR(120),
    address       TEXT,
    created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
    id              SERIAL PRIMARY KEY,
    invoice_number  VARCHAR(30) NOT NULL UNIQUE,
    customer_id     INTEGER NOT NULL REFERENCES customers(id),
    invoice_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    due_date        DATE,
    subtotal        DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax             DECIMAL(12,2) NOT NULL DEFAULT 0,
    total           DECIMAL(12,2) NOT NULL DEFAULT 0,
    status          VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','overdue','void')),
    created_by      INTEGER NOT NULL REFERENCES users(id),
    pdf_path        VARCHAR(255),
    created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoice_items (
    id          SERIAL PRIMARY KEY,
    invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    description VARCHAR(255) NOT NULL,
    quantity    DECIMAL(10,2) NOT NULL DEFAULT 1,
    unit_price  DECIMAL(12,2) NOT NULL DEFAULT 0,
    amount      DECIMAL(12,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id),
    action      VARCHAR(50) NOT NULL,       -- e.g. 'invoice.create', 'invoice.edit', 'login.success'
    entity_type VARCHAR(50),
    entity_id   INTEGER,
    ip_address  VARCHAR(45),
    details     TEXT,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- session store table (used by connect-pg-simple)
CREATE TABLE IF NOT EXISTS "session" (
    "sid"    varchar NOT NULL COLLATE "default" PRIMARY KEY,
    "sess"   json NOT NULL,
    "expire" timestamp(6) NOT NULL
)
WITH (OIDS=FALSE);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");