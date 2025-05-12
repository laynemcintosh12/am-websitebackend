-- 1. Modify commissions_due table
ALTER TABLE commissions_due 
ALTER COLUMN customer_id DROP NOT NULL,
ADD COLUMN IF NOT EXISTS admin_modified BOOLEAN DEFAULT FALSE;

-- 2. Ensure payments table has the correct constraint
ALTER TABLE payments 
DROP CONSTRAINT IF EXISTS payments_payment_type_check;

ALTER TABLE payments 
ADD CONSTRAINT payments_payment_type_check 
CHECK (payment_type IN ('Check', 'Cash', 'Direct Deposit', 'Other'));