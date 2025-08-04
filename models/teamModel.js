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

// ===== USER TEAM MEMBERSHIP FUNCTIONS =====

// Add a user to a team
const addUserToTeam = async (userId, teamId, role, joinedAt = new Date()) => {
  const query = `
    INSERT INTO user_team_membership (user_id, team_id, role, joined_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, team_id)
    DO UPDATE SET 
      role = EXCLUDED.role,
      joined_at = EXCLUDED.joined_at,
      left_at = NULL,
      updated_at = NOW()
    RETURNING *;
  `;
  const result = await pool.query(query, [userId, teamId, role, joinedAt]);
  return result.rows[0];
};

// Add user to team with specific join date
const addUserToTeamWithDate = async (userId, teamId, role, joinedAt) => {
  const query = `
    INSERT INTO user_team_membership (user_id, team_id, role, joined_at)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (user_id, team_id)
    DO UPDATE SET 
      role = EXCLUDED.role,
      joined_at = EXCLUDED.joined_at,
      left_at = NULL,
      updated_at = NOW()
    RETURNING *;
  `;
  const result = await pool.query(query, [userId, teamId, role, joinedAt]);
  return result.rows[0];
};

// Remove a user from a team's history (delete the row)
const removeUserFromTeamHistory = async (userId, teamId) => {
  const query = `
    DELETE FROM user_team_membership 
    WHERE user_id = $1 AND team_id = $2
    RETURNING *;
  `;
  const result = await pool.query(query, [userId, teamId]);
  return result.rows[0];
};

// Alias for controller compatibility
const removeUserFromTeam = removeUserFromTeamHistory;

// Remove user ID from team arrays (salesman_ids, supplementer_ids)
const removeUserIdFromTeamArrays = async (userId, teamId) => {
  const query = `
    UPDATE teams
    SET
      salesman_ids = array_remove(salesman_ids, $1),
      supplementer_ids = array_remove(supplementer_ids, $1)
    WHERE id = $2
    RETURNING *;
  `;
  const result = await pool.query(query, [userId, teamId]);
  return result.rows[0];
};

// Set departure date (mark as left, but keep history)
const setUserTeamDepartureDate = async (userId, teamId, leftAt) => {
  const query = `
    UPDATE user_team_membership
    SET left_at = $3, updated_at = NOW()
    WHERE user_id = $1 AND team_id = $2
    RETURNING *;
  `;
  const result = await pool.query(query, [userId, teamId, leftAt]);
  if (result.rows[0]) {
    await removeUserIdFromTeamArrays(userId, teamId);
  }
  return result.rows[0];
};

// Get all teams for a user
const getUserTeams = async (userId) => {
  const query = `
    SELECT 
      utm.user_id,
      utm.team_id,
      utm.role as membership_role,
      utm.joined_at,
      utm.updated_at,
      t.team_name,
      t.team_type,
      t.manager_id,
      u.name as manager_name
    FROM user_team_membership utm
    JOIN teams t ON utm.team_id = t.id
    JOIN users u ON t.manager_id = u.id
    WHERE utm.user_id = $1
    ORDER BY utm.joined_at DESC;
  `;
  const result = await pool.query(query, [userId]);
  return result.rows;
};

// Get all users in a team
const getTeamUsers = async (teamId) => {
  const query = `
    SELECT 
      utm.user_id,
      utm.team_id,
      utm.role as membership_role,
      utm.joined_at,
      utm.updated_at,
      u.name,
      u.email,
      u.role as user_role,
      u.permissions
    FROM user_team_membership utm
    JOIN users u ON utm.user_id = u.id
    WHERE utm.team_id = $1
    ORDER BY utm.role, u.name;
  `;
  const result = await pool.query(query, [teamId]);
  return result.rows;
};

// Update user's role in a team
const updateUserTeamRole = async (userId, teamId, newRole) => {
  const query = `
    UPDATE user_team_membership 
    SET role = $1, updated_at = NOW()
    WHERE user_id = $2 AND team_id = $3
    RETURNING *;
  `;
  const result = await pool.query(query, [newRole, userId, teamId]);
  return result.rows[0];
};

// Get user's role in a specific team
const getUserRoleInTeam = async (userId, teamId) => {
  const query = `
    SELECT role, joined_at, updated_at
    FROM user_team_membership 
    WHERE user_id = $1 AND team_id = $2;
  `;
  const result = await pool.query(query, [userId, teamId]);
  return result.rows[0];
};

// Remove user from all teams (useful when deleting a user)
const removeUserFromAllTeams = async (userId) => {
  const query = `
    DELETE FROM user_team_membership 
    WHERE user_id = $1
    RETURNING *;
  `;
  const result = await pool.query(query, [userId]);
  return result.rows;
};

// Remove all users from a team (useful when deleting a team)
const removeAllUsersFromTeam = async (teamId) => {
  const query = `
    DELETE FROM user_team_membership 
    WHERE team_id = $1
    RETURNING *;
  `;
  const result = await pool.query(query, [teamId]);
  return result.rows;
};

// Bulk add users to a team
const bulkAddUsersToTeam = async (userTeamMappings) => {
  if (!userTeamMappings || userTeamMappings.length === 0) {
    return [];
  }

  const values = userTeamMappings.map((mapping, index) => {
    const offset = index * 3;
    return `($${offset + 1}, $${offset + 2}, $${offset + 3})`;
  }).join(', ');

  const flatValues = userTeamMappings.flatMap(mapping => [
    mapping.userId,
    mapping.teamId,
    mapping.role
  ]);

  const query = `
    INSERT INTO user_team_membership (user_id, team_id, role, joined_at)
    VALUES ${values}
    ON CONFLICT (user_id, team_id) 
    DO UPDATE SET 
      role = EXCLUDED.role,
      updated_at = NOW()
    RETURNING *;
  `;

  const result = await pool.query(query, flatValues);
  return result.rows;
};

// ===== HISTORICAL TEAM MEMBERSHIP FUNCTIONS =====

// Get user's team membership at a specific date
const getUserTeamMembershipAtDate = async (userId, targetDate) => {
  const query = `
    SELECT 
      utm.user_id,
      utm.team_id,
      utm.role as membership_role,
      utm.joined_at,
      utm.updated_at,
      t.team_name,
      t.team_type,
      t.manager_id,
      u.name as manager_name
    FROM user_team_membership utm
    JOIN teams t ON utm.team_id = t.id
    JOIN users u ON t.manager_id = u.id
    WHERE utm.user_id = $1 
      AND utm.joined_at <= $2
      AND (utm.left_at IS NULL OR utm.left_at > $2)
    ORDER BY utm.joined_at DESC
    LIMIT 1;
  `;
  const result = await pool.query(query, [userId, targetDate]);
  return result.rows[0];
};

// Get team composition at a specific date
const getTeamCompositionAtDate = async (teamId, targetDate) => {
  const query = `
    SELECT 
      utm.user_id,
      utm.team_id,
      utm.role as membership_role,
      utm.joined_at,
      utm.updated_at,
      u.name,
      u.email,
      u.role as user_role,
      u.permissions,
      u.hire_date
    FROM user_team_membership utm
    JOIN users u ON utm.user_id = u.id
    WHERE utm.team_id = $1
      AND utm.joined_at <= $2
      AND (utm.left_at IS NULL OR utm.left_at > $2)
    ORDER BY utm.role, u.name;
  `;
  const result = await pool.query(query, [teamId, targetDate]);
  return result.rows;
};

// Get manager for a user at a specific date
const getUserManagerAtDate = async (userId, targetDate, role = null) => {
  const query = `
    SELECT 
      t.manager_id,
      u.name as manager_name,
      u.role as manager_role,
      utm.role as user_team_role
    FROM user_team_membership utm
    JOIN teams t ON utm.team_id = t.id
    JOIN users u ON t.manager_id = u.id
    WHERE utm.user_id = $1 
      AND utm.joined_at <= $2
      AND (utm.left_at IS NULL OR utm.left_at > $2)
      ${role ? 'AND utm.role = $3' : ''}
    ORDER BY utm.joined_at DESC
    LIMIT 1;
  `;
  
  const params = role ? [userId, targetDate, role] : [userId, targetDate];
  const result = await pool.query(query, params);
  return result.rows[0];
};

// Check if user was on a team at a specific date
const wasUserOnTeamAtDate = async (userId, teamId, targetDate) => {
  const query = `
    SELECT EXISTS(
      SELECT 1 FROM user_team_membership 
      WHERE user_id = $1 
        AND team_id = $2
        AND joined_at <= $3
        AND (left_at IS NULL OR left_at > $3)
    ) as was_on_team;
  `;
  const result = await pool.query(query, [userId, teamId, targetDate]);
  return result.rows[0].was_on_team;
};

// Get historical team data for commission calculations
const getHistoricalTeamDataForCommission = async (userId, customerCreationDate) => {
  // If no customer creation date, use current team data
  if (!customerCreationDate) {
    return await getUserTeams(userId);
  }

  const membership = await getUserTeamMembershipAtDate(userId, customerCreationDate);
  if (!membership) {
    return null;
  }

  // Get the team composition at that date
  const teamComposition = await getTeamCompositionAtDate(membership.team_id, customerCreationDate);
  
  return {
    ...membership,
    team_members: teamComposition,
    // Add legacy arrays for backward compatibility
    salesman_ids: teamComposition.filter(m => m.membership_role === 'salesman').map(m => m.user_id),
    supplementer_ids: teamComposition.filter(m => m.membership_role === 'supplementer').map(m => m.user_id)
  };
};

module.exports = {
  // Original team functions
  createTeam,
  updateTeam,
  getAllTeams,
  deleteTeam,
  getTeamsByCustomerId,
  getTeamByUserId,
  getTeamByUserIdFromDb,
  getTeamById,
  
  // User team membership functions
  addUserToTeam,
  removeUserFromTeam, // <-- alias for controller
  removeUserFromTeamHistory,
  getUserTeams,
  getTeamUsers,
  updateUserTeamRole,
  getUserRoleInTeam,
  removeUserFromAllTeams,
  removeAllUsersFromTeam,
  bulkAddUsersToTeam,
  addUserToTeamWithDate,

  // Historical team membership functions
  getUserTeamMembershipAtDate,
  getTeamCompositionAtDate,
  getUserManagerAtDate,
  wasUserOnTeamAtDate,
  getHistoricalTeamDataForCommission,

  // New function
  setUserTeamDepartureDate,
};