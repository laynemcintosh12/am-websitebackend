const pool = require('../config/db');

// Create a new team
const createTeam = async (managerId, teamName, teamType, salesmanIds = [], supplementerIds = []) => {
  const query = `
    INSERT INTO teams (
      manager_id, 
      team_name, 
      team_type, 
      salesman_ids, 
      supplementer_ids
    ) 
    VALUES ($1, $2, $3, $4, $5) 
    RETURNING *`;
  
  const values = [managerId, teamName, teamType, salesmanIds, supplementerIds];
  
  const result = await pool.query(query, values);
  return result.rows[0];
};

// Update a team (assign salesman/supplementers to a manager)
const updateTeam = async (teamId, { team_name, team_type, manager_id, salesman_ids, supplementer_ids }) => {
  const query = `
    UPDATE teams
    SET 
      team_name = COALESCE($1, team_name),
      team_type = COALESCE($2, team_type),
      manager_id = COALESCE($3, manager_id),
      salesman_ids = COALESCE($4, salesman_ids),
      supplementer_ids = COALESCE($5, supplementer_ids),
      updated_at = NOW()
    WHERE id = $6
    RETURNING *;
  `;
  const values = [team_name, team_type, manager_id, salesman_ids, supplementer_ids, teamId];
  const result = await pool.query(query, values);
  return result.rows[0];
};

// Get all team data - Updated query
const getAllTeams = async () => {
  const query = `
    SELECT 
      t.id AS team_id,
      t.team_name,
      t.team_type,
      t.manager_id,
      u.name AS manager_name,
      u.role AS manager_role,
      t.salesman_ids,
      t.supplementer_ids,
      t.created_at,
      t.updated_at
    FROM teams t
    JOIN users u ON t.manager_id = u.id
    ORDER BY t.team_type, t.created_at DESC;
  `;
  const result = await pool.query(query);
  return result.rows;
};

// New function to get team by customer
const getTeamsByCustomerId = async (customerId) => {
  const query = `
    SELECT 
      t.*,
      c.manager_id AS sales_manager_id,
      c.supplement_manager_id
    FROM teams t
    JOIN customers c ON 
      (c.manager_id = t.manager_id OR c.supplement_manager_id = t.manager_id)
    WHERE c.id = $1;
  `;
  const result = await pool.query(query, [customerId]);
  return result.rows;
};

// Updated function to get team by user ID
const getTeamByUserId = async (userId) => {
  const query = `
    SELECT t.*, u.role AS manager_role
    FROM teams t
    JOIN users u ON t.manager_id = u.id
    WHERE 
      t.manager_id = $1 
      OR $1 = ANY(t.salesman_ids) 
      OR $1 = ANY(t.supplementer_ids);
  `;
  const result = await pool.query(query, [userId]);
  return result.rows[0];
};

const getTeamByUserIdFromDb = async (userId) => {
  const query = `
    SELECT t.*, u.role AS manager_role
    FROM teams t
    JOIN users u ON t.manager_id = u.id
    WHERE 
      t.manager_id = $1 
      OR $1 = ANY(t.salesman_ids) 
      OR $1 = ANY(t.supplementer_ids);
  `;
  const result = await pool.query(query, [userId]);
  return result.rows[0];
};

// Get team by ID
const getTeamById = async (teamId) => {
  const query = `
    SELECT 
      t.id AS team_id,
      t.team_name,
      t.team_type,
      t.manager_id,
      u.name AS manager_name,
      u.role AS manager_role,
      t.salesman_ids,
      t.supplementer_ids,
      t.created_at,
      t.updated_at
    FROM teams t
    JOIN users u ON t.manager_id = u.id
    WHERE t.id = $1;
  `;
  const result = await pool.query(query, [teamId]);
  return result.rows[0];
};

// Delete a team
const deleteTeam = async (teamId) => {
  const query = `
    DELETE FROM teams
    WHERE id = $1
    RETURNING *;
  `;
  const result = await pool.query(query, [teamId]);
  return result.rows[0];
};

module.exports = {
  createTeam,
  updateTeam,
  getAllTeams,
  deleteTeam,
  getTeamsByCustomerId,
  getTeamByUserId,
  getTeamByUserIdFromDb,
  getTeamById  // Add the new function to exports
};