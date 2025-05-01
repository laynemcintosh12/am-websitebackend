-- =========================
-- USERS TABLE (First, since others depend on it)
-- =========================
DROP TABLE IF EXISTS users CASCADE;
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    email VARCHAR(255) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,        
    permissions VARCHAR(50) NOT NULL, 
    hire_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reset_password_token VARCHAR(255),
    reset_password_expires TIMESTAMP,
    yearly_goal NUMERIC(12,2) DEFAULT 50000.00
);

-- =========================
-- USER_BALANCE TABLE (Second, since it depends only on users)
-- =========================
DROP TABLE IF EXISTS user_balance CASCADE;
CREATE TABLE user_balance (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    total_commissions_earned NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    total_payments_received NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    current_balance NUMERIC(12,2) NOT NULL DEFAULT 0.00,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT user_balance_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT unique_user_balance UNIQUE (user_id)
);

-- =========================
-- CUSTOMERS TABLE
-- =========================
DROP TABLE IF EXISTS customers CASCADE;
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    customer_name VARCHAR(255) NOT NULL,
    address VARCHAR(255),
    phone VARCHAR(50),
    salesman_id INTEGER REFERENCES users(id),
    supplementer_id INTEGER REFERENCES users(id),
    manager_id INTEGER REFERENCES users(id),
    supplement_manager_id INTEGER REFERENCES users(id),
    status VARCHAR(100),
    initial_scope_price NUMERIC(12,2),
    total_job_price NUMERIC(12,2),
    lead_source VARCHAR(255),
    referrer_id INTEGER REFERENCES users(id),
    last_updated_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    build_date TIMESTAMP,
    status_changed BOOLEAN DEFAULT FALSE,
    CONSTRAINT unique_customer_name UNIQUE (customer_name)
);

-- Update customers table status_changed column
ALTER TABLE customers 
DROP COLUMN status_changed,
ADD COLUMN status_changed TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

-- =========================
-- TEAMS TABLE
-- =========================
DROP TABLE IF EXISTS teams CASCADE;
CREATE TABLE teams (
    id SERIAL PRIMARY KEY,
    team_name VARCHAR(255) NOT NULL DEFAULT 'New Team',
    team_type VARCHAR(50) NOT NULL DEFAULT 'Sales' CHECK (team_type IN ('Sales', 'Supplement', 'Affiliate')),
    manager_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    salesman_ids INTEGER[] DEFAULT '{}',
    supplementer_ids INTEGER[] DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- COMMISSIONS DUE TABLE
-- =========================
DROP TABLE IF EXISTS commissions_due CASCADE;
CREATE TABLE commissions_due (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    commission_amount NUMERIC(12,2) NOT NULL,
    is_paid BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    build_date TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_customer UNIQUE (user_id, customer_id)
);

-- =========================
-- PAYMENTS TABLE
-- =========================
DROP TABLE IF EXISTS payments CASCADE;
CREATE TABLE payments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount NUMERIC(12,2) NOT NULL,
    payment_type VARCHAR(50) NOT NULL CHECK (payment_type IN ('commission', 'advance')),
    check_number VARCHAR(100),
    payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Update payments table payment_type check constraint
ALTER TABLE payments 
DROP CONSTRAINT payments_payment_type_check,
ADD CONSTRAINT payments_payment_type_check 
CHECK (payment_type IN ('Check', 'Cash', 'Direct Deposit', 'Other'));

-- =========================
-- PAYMENT_COMMISSION_MAPPING TABLE
-- =========================
DROP TABLE IF EXISTS payment_commission_mapping CASCADE;
CREATE TABLE payment_commission_mapping (
    id SERIAL PRIMARY KEY,
    payment_id INTEGER NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    commission_due_id INTEGER NOT NULL REFERENCES commissions_due(id) ON DELETE CASCADE,
    amount_applied NUMERIC(12,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- =========================
-- COMMISSION TRIGGER
-- =========================
DROP TRIGGER IF EXISTS customer_commission_trigger ON customers;
DROP FUNCTION IF EXISTS process_customer_commission;