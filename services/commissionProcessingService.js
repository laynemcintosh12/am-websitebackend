const { calculateCommission } = require('./commissionService');
const { sendCommissionNotification } = require('../utils/email');
const db = require('../config/db');

const processCustomerCommission = async (customer, oldStatus) => {
    const { id, status, salesman_id, supplementer_id, referrer_id } = customer;

    // Only process if status changed to Finalized
    if (status === 'Finalized' && oldStatus !== 'Finalized') {
        try {
            // Start transaction
            await db.query('BEGIN');

            // Process each role that gets commission
            const roles = [
                { userId: salesman_id, role: 'Salesman' },
                { userId: supplementer_id, role: 'Supplementer' },
                { userId: referrer_id, role: 'Affiliate Marketer' }
            ].filter(r => r.userId);

            for (const { userId, role } of roles) {
                // Get user and team data
                const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
                const team = await db.query('SELECT * FROM teams WHERE manager_id = $1', [userId]);

                // Calculate commission
                const commission = await calculateCommission(
                    user.rows[0],
                    customer,
                    team.rows[0]
                );

                // Insert/Update commission due record
                await db.query(`
                    INSERT INTO commissions_due (user_id, customer_id, commission_amount)
                    VALUES ($1, $2, $3)
                    ON CONFLICT (user_id, customer_id) 
                    DO UPDATE SET 
                        commission_amount = $3,
                        updated_at = CURRENT_TIMESTAMP
                `, [userId, id, commission]);

                // Update user balance
                await db.query(`
                    INSERT INTO user_balance (user_id, total_commissions_earned, current_balance)
                    SELECT 
                        $1,
                        COALESCE(SUM(cd.commission_amount), 0),
                        COALESCE(SUM(cd.commission_amount), 0) - COALESCE((
                            SELECT SUM(amount) FROM payments WHERE user_id = $1
                        ), 0)
                    FROM commissions_due cd
                    WHERE cd.user_id = $1
                    GROUP BY cd.user_id
                    ON CONFLICT (user_id) 
                    DO UPDATE SET
                        total_commissions_earned = EXCLUDED.total_commissions_earned,
                        current_balance = EXCLUDED.current_balance,
                        last_updated = CURRENT_TIMESTAMP
                `, [userId]);

                // Send notification
                await sendCommissionNotification(userId, id, commission);
            }

            await db.query('COMMIT');
        } catch (error) {
            await db.query('ROLLBACK');
            throw error;
        }
    }
};

module.exports = { processCustomerCommission };