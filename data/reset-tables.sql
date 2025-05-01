-- Drop and recreate specified tables
DROP TABLE IF EXISTS commission_payments CASCADE;
DROP TABLE IF EXISTS commissions_due CASCADE;
DROP TABLE IF EXISTS customers CASCADE;

-- Recreate customers table
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
    build_date TIMESTAMP,
    last_updated_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE customers ADD CONSTRAINT unique_customer_name UNIQUE (customer_name);

-- Recreate commissions_due table
CREATE TABLE commissions_due (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    commission_amount NUMERIC(12,2) NOT NULL,
    is_paid BOOLEAN DEFAULT FALSE,
    build_date TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE commissions_due ADD CONSTRAINT unique_user_customer UNIQUE (user_id, customer_id);

-- Recreate commission_payments table
CREATE TABLE commission_payments (
    id SERIAL PRIMARY KEY,
    commission_due_id INTEGER NOT NULL REFERENCES commissions_due(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    commission_amount NUMERIC(12,2) NOT NULL,
    check_number VARCHAR(100),
    paid_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);