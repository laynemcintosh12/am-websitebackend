const pool = require('../config/db');

class TeamService {
  static async getManagersByCustomerId(customerId) {
    const query = `
      SELECT 
        c.id AS customer_id,
        sm.id AS sales_manager_id,
        sm.name AS sales_manager_name,
        t.team_name AS sales_team_name,
        t.team_type AS sales_team_type,
        spm.id AS supplement_manager_id,
        spm.name AS supplement_manager_name,
        st.team_name AS supplement_team_name,
        st.team_type AS supplement_team_type
      FROM customers c
      LEFT JOIN users sm ON c.manager_id = sm.id
      LEFT JOIN teams t ON t.manager_id = sm.id
      LEFT JOIN users spm ON c.supplement_manager_id = spm.id
      LEFT JOIN teams st ON st.manager_id = spm.id
      WHERE c.id = $1;
    `;
    const result = await pool.query(query, [customerId]);
    return result.rows[0];
  }

  static async getSharedCustomers(managerId) {
    const query = `
      SELECT * FROM customers
      WHERE 
        (manager_id = $1 AND supplement_manager_id IS NOT NULL) OR
        (supplement_manager_id = $1 AND manager_id IS NOT NULL);
    `;
    const result = await pool.query(query, [managerId]);
    return result.rows;
  }

  static async calculateTeamPerformance(teamId) {
    const query = `
      WITH team_metrics AS (
        SELECT 
          t.id as team_id,
          t.team_type,
          COUNT(DISTINCT c.id) as total_customers,
          COUNT(DISTINCT CASE WHEN c.status = 'Finalized' THEN c.id END) as finalized_customers,
          SUM(CASE WHEN c.status = 'Finalized' THEN c.total_job_price ELSE 0 END) as total_revenue,
          SUM(CASE 
            WHEN c.status = 'Finalized' 
            THEN c.total_job_price - c.initial_scope_price 
            ELSE 0 
          END) as total_margin_increase,
          SUM(cd.commission_amount) as total_commission_due,
          SUM(CASE WHEN cd.is_paid THEN cd.commission_amount ELSE 0 END) as total_commission_paid
        FROM teams t
        LEFT JOIN users u ON u.id = ANY(t.salesman_ids) OR u.id = ANY(t.supplementer_ids)
        LEFT JOIN customers c ON c.salesman_id = u.id OR c.supplementer_id = u.id
        LEFT JOIN commissions_due cd ON cd.user_id = u.id AND cd.customer_id = c.id
        WHERE t.id = $1
        GROUP BY t.id, t.team_type
      )
      SELECT 
        tm.*,
        CASE 
          WHEN tm.total_customers > 0 
          THEN ROUND((tm.finalized_customers::NUMERIC / tm.total_customers) * 100, 2)
          ELSE 0 
        END as conversion_rate,
        CASE 
          WHEN tm.finalized_customers > 0 
          THEN ROUND(tm.total_revenue::NUMERIC / tm.finalized_customers, 2)
          ELSE 0 
        END as average_job_price,
        CASE 
          WHEN tm.finalized_customers > 0 
          THEN ROUND(tm.total_margin_increase::NUMERIC / tm.finalized_customers, 2)
          ELSE 0 
        END as average_margin_increase
      FROM team_metrics tm;
    `;
    
    const result = await pool.query(query, [teamId]);
    return result.rows[0];
  }

  static async getTeamMemberPerformance(teamId) {
    const query = `
      SELECT 
        u.id as user_id,
        u.name,
        u.role,
        COUNT(DISTINCT c.id) as total_customers,
        COUNT(DISTINCT CASE WHEN c.status = 'Finalized' THEN c.id END) as finalized_customers,
        SUM(CASE WHEN c.status = 'Finalized' THEN c.total_job_price ELSE 0 END) as revenue_generated,
        SUM(cd.commission_amount) as total_commission_due,
        SUM(CASE WHEN cd.is_paid THEN cd.commission_amount ELSE 0 END) as total_commission_paid
      FROM teams t
      JOIN users u ON u.id = ANY(t.salesman_ids) OR u.id = ANY(t.supplementer_ids)
      LEFT JOIN customers c ON c.salesman_id = u.id OR c.supplementer_id = u.id
      LEFT JOIN commissions_due cd ON cd.user_id = u.id AND cd.customer_id = c.id
      WHERE t.id = $1
      GROUP BY u.id, u.name, u.role
      ORDER BY u.role, revenue_generated DESC;
    `;
    
    const result = await pool.query(query, [teamId]);
    return result.rows;
  }
}

module.exports = TeamService;