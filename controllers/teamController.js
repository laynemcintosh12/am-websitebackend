const { 
  createTeam, 
  updateTeam, 
  getAllTeams, 
  deleteTeam, 
  getTeamById,
  getTeamByUserIdFromDb,
  // Team membership functions
  addUserToTeam,
  addUserToTeamWithDate,
  removeUserFromTeam,
  setUserTeamDepartureDate,
  getUserTeams,
  getTeamUsers,
  updateUserTeamRole,
  getUserRoleInTeam,
  removeAllUsersFromTeam,
  removeUserFromAllTeams,
  bulkAddUsersToTeam,
  // Historical team functions
  getUserTeamMembershipAtDate,
  getTeamCompositionAtDate,
  getUserManagerAtDate,
  wasUserOnTeamAtDate,
  getHistoricalTeamDataForCommission
} = require('../models/teamModel');
const pool = require('../config/db');
const TeamService = require('../services/teamService');

// OPTIMIZED: Create a new team with membership management - Now with batched operations
const createNewTeam = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { 
      managerId, 
      teamName, 
      teamType = 'Sales', 
      salesmanIds = [], 
      supplementerIds = [],
      effectiveDate = new Date() // Optional backdating support
    } = req.body;

    // Input validation
    if (!managerId) return res.status(400).json({ error: 'Manager ID is required' });
    if (!teamName) return res.status(400).json({ error: 'Team name is required' });
    if (!['Sales', 'Supplement', 'Affiliate'].includes(teamType)) {
      return res.status(400).json({ error: 'Invalid team type' });
    }

    // Create the team
    const team = await createTeam(managerId, teamName, teamType, salesmanIds, supplementerIds);

    // Build membership mappings for batch processing
    const memberships = [
      // Manager
      { userId: managerId, teamId: team.id, role: 'manager', joinedAt: effectiveDate }
    ];
    
    // Add salesmen
    salesmanIds.forEach(userId => {
      memberships.push({ userId, teamId: team.id, role: 'salesman', joinedAt: effectiveDate });
    });
    
    // Add supplementers
    supplementerIds.forEach(userId => {
      memberships.push({ userId, teamId: team.id, role: 'supplementer', joinedAt: effectiveDate });
    });

    // Batch insert all memberships
    const membershipPromises = memberships.map(m => 
      addUserToTeamWithDate(m.userId, m.teamId, m.role, m.joinedAt)
    );
    await Promise.all(membershipPromises);

    await client.query('COMMIT');
    res.status(201).json({ message: 'Team created successfully', team });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error creating team:', error);
    next(error);
  } finally {
    client.release();
  }
};

// OPTIMIZED: Update team with membership management - Now with custom date support
const modifyTeam = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const teamId = req.body.team_id;
    const { 
      manager_id,
      team_name,
      team_type,
      salesman_ids,
      supplementer_ids,
      effective_date = new Date() // Optional backdating support
    } = req.body;
    
    // Get current team data
    const team = await getTeamById(teamId);
    if (!team) return res.status(404).json({ error: 'Team not found' });

    // Update team data
    const updateData = {
      team_name: team_name || team.team_name,
      team_type: team_type || team.team_type,
      manager_id: manager_id || team.manager_id,
      salesman_ids: salesman_ids || team.salesman_ids,
      supplementer_ids: supplementer_ids || team.supplementer_ids
    };

    const updatedTeam = await updateTeam(teamId, updateData);

    // Update membership table - Set departure date for all existing active members
    await client.query(`
      UPDATE user_team_membership 
      SET left_at = $1 
      WHERE team_id = $2 AND left_at IS NULL
    `, [effective_date, teamId]);

    // Add updated memberships with new effective date
    const memberships = [];

    // Add manager
    if (updateData.manager_id) {
      memberships.push({
        userId: updateData.manager_id,
        teamId: teamId,
        role: 'manager',
        joinedAt: effective_date
      });
    }

    // Add salesmen
    if (updateData.salesman_ids && updateData.salesman_ids.length > 0) {
      updateData.salesman_ids.forEach(userId => {
        memberships.push({
          userId,
          teamId: teamId,
          role: 'salesman',
          joinedAt: effective_date
        });
      });
    }

    // Add supplementers
    if (updateData.supplementer_ids && updateData.supplementer_ids.length > 0) {
      updateData.supplementer_ids.forEach(userId => {
        memberships.push({
          userId,
          teamId: teamId,
          role: 'supplementer',
          joinedAt: effective_date
        });
      });
    }

    // Batch insert new memberships
    const membershipPromises = memberships.map(m => 
      addUserToTeamWithDate(m.userId, m.teamId, m.role, m.joinedAt)
    );
    await Promise.all(membershipPromises);

    await client.query('COMMIT');
    res.json({ 
      message: 'Team updated successfully',
      team: updatedTeam,
      effectiveDate: effective_date
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating team:', error);
    next(error);
  } finally {
    client.release();
  }
};

// OPTIMIZED: Get all teams with optional historical data point
const getTeams = async (req, res, next) => {
  try {
    const { includeMembership, historicalDate } = req.query;
    const teams = await getAllTeams();
    
    // Optionally include membership details (current or historical)
    if (includeMembership === 'true') {
      const date = historicalDate ? new Date(historicalDate) : null;
      
      // Use Promise.all for parallel processing of team member queries
      await Promise.all(teams.map(async (team) => {
        if (date) {
          team.members = await getTeamCompositionAtDate(team.team_id, date);
          team.asOfDate = date;
        } else {
          team.members = await getTeamUsers(team.team_id);
        }
      }));
    }
    
    res.status(200).json(teams);
  } catch (error) {
    console.error('Error fetching teams:', error);
    next(error);
  }
};

// OPTIMIZED: Delete team with proper historical data handling
const removeTeam = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { teamId } = req.params;
    const { preserveHistory = false, effectiveDate = new Date() } = req.body;

    if (!teamId) {
      return res.status(400).json({ error: 'Team ID is required' });
    }

    // Get the team first to return in the response
    const team = await getTeamById(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    if (preserveHistory) {
      // Instead of deleting memberships, set left_at for all active members
      await client.query(`
        UPDATE user_team_membership 
        SET left_at = $1 
        WHERE team_id = $2 AND left_at IS NULL
      `, [effectiveDate, teamId]);
    } else {
      // Remove all memberships completely
      await removeAllUsersFromTeam(teamId);
    }

    // Then delete the team
    const deletedTeam = await deleteTeam(teamId);

    await client.query('COMMIT');
    res.status(200).json({ 
      message: 'Team deleted successfully', 
      team: deletedTeam,
      preservedHistory: preserveHistory
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting team:', error);
    next(error);
  } finally {
    client.release();
  }
};

// OPTIMIZED: Get team by user ID with historical support
const getTeamByUserId = async (req, res, next) => {
  try {
    const userId = parseInt(req.params?.userId || req);
    const { historicalDate } = req.query;
    
    if (!userId) {
      return next(new Error('User ID is required'));
    }

    let userTeams;
    
    // Get historical team membership if date provided
    if (historicalDate) {
      const date = new Date(historicalDate);
      if (isNaN(date.getTime())) {
        return res.status(400).json({ error: 'Invalid historical date format' });
      }
      
      const membership = await getUserTeamMembershipAtDate(userId, date);
      userTeams = membership ? [membership] : [];
    } else {
      // Get current teams
      userTeams = await getUserTeams(userId);
    }
    
    if (res) {
      if (!userTeams || userTeams.length === 0) {
        return res.status(404).json({ 
          error: historicalDate 
            ? `No teams found for user at ${historicalDate}` 
            : 'No teams found for this user' 
        });
      }

      return res.status(200).json(userTeams);
    }

    return userTeams;
  } catch (error) {
    if (next) {
      console.error('Error fetching user teams:', error);
      return next(error);
    }
    throw error;
  }
};

// OPTIMIZED: Get team members with historical support
const getTeamMembers = async (req, res, next) => {
  try {
    const { teamId } = req.params;
    const { historicalDate } = req.query;
    
    let members;
    
    // Get historical team composition if date provided
    if (historicalDate) {
      const date = new Date(historicalDate);
      if (isNaN(date.getTime())) {
        return res.status(400).json({ error: 'Invalid historical date format' });
      }
      
      members = await getTeamCompositionAtDate(teamId, date);
      
    } else {
      // Get current members
      members = await getTeamUsers(teamId);
    }
    
    res.status(200).json({
      members,
      asOfDate: historicalDate ? new Date(historicalDate) : new Date(),
      teamId
    });
  } catch (error) {
    console.error('Error fetching team members:', error);
    next(error);
  }
};

// NEW: Add user to team with custom join date
const addUserToTeamWithDateController = async (req, res, next) => {
  try {
    const { userId, teamId, role, joinedAt } = req.body;
    
    // Validate input
    if (!userId || !teamId || !role) {
      return res.status(400).json({ error: 'User ID, team ID, and role are required' });
    }

    if (!['manager', 'salesman', 'supplementer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be manager, salesman, or supplementer' });
    }

    // Parse date or use current date
    let joinDate = new Date();
    if (joinedAt) {
      joinDate = new Date(joinedAt);
      if (isNaN(joinDate.getTime())) {
        return res.status(400).json({ error: 'Invalid date format' });
      }
    }

    const membership = await addUserToTeamWithDate(userId, teamId, role, joinDate);
    res.status(201).json({ message: 'User added to team successfully', membership });
  } catch (error) {
    console.error('Error adding user to team:', error);
    next(error);
  }
};

// Add or update user membership
const addUserToTeamController = async (req, res, next) => {
  try {
    const { userId, teamId, role, joinedAt } = req.body;
    if (!userId || !teamId || !role) {
      return res.status(400).json({ error: 'User ID, team ID, and role are required' });
    }
    const membership = await addUserToTeam(userId, teamId, role, joinedAt);
    res.status(201).json({ message: 'User added/updated on team', membership });
  } catch (error) {
    console.error('Error adding/updating user on team:', error);
    next(error);
  }
};

// NEW: Set user departure date from team
const setUserTeamDepartureDateController = async (req, res, next) => {
  try {
    const { userId, teamId } = req.params;
    const { departureDate } = req.body;
    
    // Parse date or use current date
    let leftAt = new Date();
    if (departureDate) {
      leftAt = new Date(departureDate);
      if (isNaN(leftAt.getTime())) {
        return res.status(400).json({ error: 'Invalid date format' });
      }
    }
    
    const updatedMembership = await setUserTeamDepartureDate(userId, teamId, leftAt);
    
    if (!updatedMembership) {
      return res.status(404).json({ error: 'Active membership not found' });
    }

    res.status(200).json({ 
      message: 'User departure date set successfully', 
      membership: updatedMembership 
    });
  } catch (error) {
    console.error('Error setting departure date:', error);
    next(error);
  }
};

// Remove user from team completely
const removeUserFromTeamController = async (req, res, next) => {
  try {
    const { userId, teamId } = req.params;
    
    const removedMembership = await removeUserFromTeam(userId, teamId);
    
    if (!removedMembership) {
      return res.status(404).json({ error: 'Membership not found' });
    }

    res.status(200).json({ message: 'User removed from team successfully', removedMembership });
  } catch (error) {
    console.error('Error removing user from team:', error);
    next(error);
  }
};

// Update user's role in team
const updateUserRoleInTeam = async (req, res, next) => {
  try {
    const { userId, teamId } = req.params;
    const { role } = req.body;
    
    if (!role) {
      return res.status(400).json({ error: 'Role is required' });
    }

    if (!['manager', 'salesman', 'supplementer'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be manager, salesman, or supplementer' });
    }

    const updatedMembership = await updateUserTeamRole(userId, teamId, role);
    
    if (!updatedMembership) {
      return res.status(404).json({ error: 'Membership not found' });
    }

    res.status(200).json({ message: 'User role updated successfully', updatedMembership });
  } catch (error) {
    console.error('Error updating user role:', error);
    next(error);
  }
};

// Get user's teams
const getUserTeamsController = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { historicalDate, includeHistory = false } = req.query;

    let teams;
    
    if (historicalDate) {
      // Get team at specific date
      const date = new Date(historicalDate);
      if (isNaN(date.getTime())) {
        return res.status(400).json({ error: 'Invalid date format' });
      }
      
      const membership = await getUserTeamMembershipAtDate(userId, date);
      teams = membership ? [membership] : [];
      
    } else if (includeHistory === 'true') {
      // Get all teams including history (join and leave dates)
      const query = `
        SELECT 
          utm.user_id,
          utm.team_id,
          utm.role as membership_role,
          utm.joined_at,
          utm.left_at,
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
      teams = result.rows;
      
    } else {
      // Get current teams (no left_at date)
      teams = await getUserTeams(userId);
    }
    
    res.status(200).json({
      userId: parseInt(userId),
      teams,
      asOfDate: historicalDate ? new Date(historicalDate) : null,
      includesHistory: includeHistory === 'true'
    });
  } catch (error) {
    console.error('Error fetching user teams:', error);
    next(error);
  }
};

// Get team customers (with historical option)
const getTeamCustomers = async (req, res, next) => {
  try {
    const { teamId } = req.params;
    const { historicalDate } = req.query;
    
    let team;
    
    if (historicalDate) {
      // Get team composition at historical date
      const date = new Date(historicalDate);
      if (isNaN(date.getTime())) {
        return res.status(400).json({ error: 'Invalid historical date format' });
      }
      
      // Get basic team info
      team = await getTeamById(teamId);
      if (!team) {
        return res.status(404).json({ error: 'Team not found' });
      }
      
      // Get manager at that time (might be different)
      const teamMembers = await getTeamCompositionAtDate(teamId, date);
      const managerMember = teamMembers.find(m => m.membership_role === 'manager');
      
      // Use historical manager if found
      const managerId = managerMember ? managerMember.user_id : team.manager_id;
      
      // Get customers with dates before or equal to historical date
      const customers = await pool.query(`
        SELECT * FROM customers 
        WHERE (manager_id = $1 OR supplement_manager_id = $1)
        AND (jn_date_added <= $2 OR created_at <= $2)
      `, [managerId, date]);
      
      res.status(200).json({
        team,
        asOfDate: date,
        customers: customers.rows
      });
      
    } else {
      // Standard current customers
      team = await getTeamById(teamId);
      
      if (!team) {
        return res.status(404).json({ error: 'Team not found' });
      }
      
      const customers = await pool.query(`
        SELECT * FROM customers 
        WHERE manager_id = $1 OR supplement_manager_id = $1
      `, [team.manager_id]);

      res.status(200).json({
        team,
        customers: customers.rows
      });
    }
  } catch (error) {
    console.error('Error fetching team customers:', error);
    next(error);
  }
};

// OPTIMIZED: Bulk operations for team memberships with transaction
const bulkUpdateTeamMemberships = async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    const { teamId, memberships, effectiveDate } = req.body;
    const date = effectiveDate ? new Date(effectiveDate) : new Date();
    
    // Validate input
    if (!teamId || !Array.isArray(memberships)) {
      return res.status(400).json({ error: 'Team ID and memberships array are required' });
    }

    // Validate memberships format
    for (const membership of memberships) {
      if (!membership.userId || !membership.role) {
        return res.status(400).json({ error: 'Each membership must have userId and role' });
      }
      if (!['manager', 'salesman', 'supplementer'].includes(membership.role)) {
        return res.status(400).json({ error: 'Invalid role in membership' });
      }
    }

    // End all current memberships
    await client.query(`
      UPDATE user_team_membership 
      SET left_at = $1 
      WHERE team_id = $2 AND left_at IS NULL
    `, [date, teamId]);

    // Add new memberships with the effective date
    const membershipPromises = memberships.map(m => 
      addUserToTeamWithDate(m.userId, teamId, m.role, date)
    );
    
    const results = await Promise.all(membershipPromises);

    await client.query('COMMIT');
    res.status(200).json({ 
      message: 'Team memberships updated successfully', 
      memberships: results,
      effectiveDate: date
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error updating team memberships:', error);
    next(error);
  } finally {
    client.release();
  }
};

// NEW: Get team membership history
const getTeamMembershipHistory = async (req, res, next) => {
  try {
    const { teamId } = req.params;
    
    // Get team details first
    const team = await getTeamById(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    
    // Get all membership records for this team with user details
    const query = `
      SELECT 
        utm.user_id,
        utm.team_id,
        utm.role as membership_role,
        utm.joined_at,
        utm.left_at,
        utm.updated_at,
        u.name,
        u.email,
        u.role as user_role,
        u.permissions
      FROM user_team_membership utm
      JOIN users u ON utm.user_id = u.id
      WHERE utm.team_id = $1
      ORDER BY utm.joined_at DESC, utm.role, u.name;
    `;
    
    const result = await pool.query(query, [teamId]);
    
    res.status(200).json({
      team,
      membershipHistory: result.rows
    });
  } catch (error) {
    console.error('Error fetching team membership history:', error);
    next(error);
  }
};

// Remove user from all teams (helper for user deletion)
const removeUserFromAllTeamsController = async (req, res, next) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ error: 'User ID is required' });
    }

    const removedMemberships = await removeUserFromAllTeams(userId);
    
    res.status(200).json({ 
      message: 'User removed from all teams successfully', 
      removedMemberships 
    });
  } catch (error) {
    console.error('Error removing user from all teams:', error);
    next(error);
  }
};

// NEW: Check if user was on team at a specific date
const checkUserTeamMembershipAtDate = async (req, res, next) => {
  try {
    const { userId, teamId } = req.params;
    const { date } = req.query;
    
    if (!date) {
      return res.status(400).json({ error: 'Date parameter is required' });
    }
    
    const checkDate = new Date(date);
    if (isNaN(checkDate.getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
    
    const wasOnTeam = await wasUserOnTeamAtDate(userId, teamId, checkDate);
    
    res.status(200).json({
      userId: parseInt(userId),
      teamId: parseInt(teamId),
      date: checkDate,
      wasOnTeam
    });
  } catch (error) {
    console.error('Error checking historical team membership:', error);
    next(error);
  }
};

// Get team performance metrics
const getTeamPerformanceMetrics = async (req, res, next) => {
  try {
    const { teamId } = req.params;
    
    // Get both overall performance and member-specific performance
    const TeamService = require('../services/teamService');
    const [teamMetrics, memberPerformance] = await Promise.all([
      TeamService.calculateTeamPerformance(teamId),
      TeamService.getTeamMemberPerformance(teamId)
    ]);

    res.json({
      teamMetrics,
      memberPerformance
    });
  } catch (error) {
    console.error('Error fetching team performance:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = { 
  // Original team functions
  createNewTeam, 
  modifyTeam, 
  getTeams, 
  removeTeam,
  getTeamByUserId,
  getTeamCustomers,
  getTeamPerformanceMetrics,
  
  // Membership functions
  getTeamMembers,
  addUserToTeamController,
  addUserToTeamWithDateController,
  setUserTeamDepartureDateController,
  removeUserFromTeamController,
  updateUserRoleInTeam,
  getUserTeamsController,
  bulkUpdateTeamMemberships,
  removeUserFromAllTeamsController,
  
  // Historical functions
  getTeamMembershipHistory,
  checkUserTeamMembershipAtDate
};