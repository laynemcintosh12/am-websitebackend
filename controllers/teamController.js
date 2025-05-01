const { 
  createTeam, 
  updateTeam, 
  getAllTeams, 
  deleteTeam, 
  getTeamById,
  getTeamByUserIdFromDb 
} = require('../models/teamModel');
const pool = require('../config/db');
const TeamService = require('../services/teamService');

// Create a new team
const createNewTeam = async (req, res, next) => {
  try {
    
    const { 
      managerId, 
      teamName, 
      teamType = 'Sales', 
      salesmanIds = [], 
      supplementerIds = [] 
    } = req.body;

    // Validate input
    if (!managerId) {
      return res.status(400).json({ error: 'Manager ID is required' });
    }
    if (!teamName) {
      return res.status(400).json({ error: 'Team name is required' });
    }
    if (!['Sales', 'Supplement', 'Affiliate'].includes(teamType)) {
      return res.status(400).json({ error: 'Invalid team type' });
    }

    const team = await createTeam(managerId, teamName, teamType, salesmanIds, supplementerIds);
    res.status(201).json({ message: 'Team created successfully', team });
  } catch (error) {
    next(error);
  }
};

// Update the modifyTeam function to handle the correct request format
const modifyTeam = async (req, res, next) => {
  try {
    const teamId = req.body.team_id; // Get ID from URL params
    const { 
      manager_id,
      team_name,
      team_type,
      salesman_ids,
      supplementer_ids
    } = req.body;
    
    // Get current team data
    const team = await getTeamById(teamId);
    
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    // Update team data
    const updateData = {
      team_name: team_name || team.team_name,
      team_type: team_type || team.team_type,
      manager_id: manager_id || team.manager_id,
      salesman_ids: salesman_ids || team.salesman_ids,
      supplementer_ids: supplementer_ids || team.supplementer_ids
    };

    const updatedTeam = await updateTeam(teamId, updateData);
    res.json(updatedTeam);
  } catch (error) {
    next(error);
  }
};

// Helper function to remove user from all teams
const removeUserFromAllTeams = async (userId) => {
  const query = `
    UPDATE teams 
    SET salesman_ids = array_remove(salesman_ids, $1),
        supplementer_ids = array_remove(supplementer_ids, $1)
    WHERE $1 = ANY(salesman_ids) OR $1 = ANY(supplementer_ids)
  `;
  await pool.query(query, [userId]);
};

// Get all teams
const getTeams = async (req, res, next) => {
  try {
    const teams = await getAllTeams();
    res.status(200).json(teams);
  } catch (error) {
    next(error);
  }
};

// Delete a team
const removeTeam = async (req, res, next) => {
  try {
    const { teamId } = req.params;

    // Validate input
    if (!teamId) {
      return res.status(400).json({ error: 'Team ID is required' });
    }

    const deletedTeam = await deleteTeam(teamId);

    if (!deletedTeam) {
      return res.status(404).json({ error: 'Team not found' });
    }

    res.status(200).json({ message: 'Team deleted successfully', deletedTeam });
  } catch (error) {
    next(error);
  }
};

// Updated getTeamByUserId function
const getTeamByUserId = async (req, res, next) => {
  try {
    const userId = parseInt(req.params?.userId || req);
    
    // If no userId provided, return early
    if (!userId) {
      return next(new Error('User ID is required'));
    }

    const team = await getTeamByUserIdFromDb(userId); // Use new function from model
    
    // If this is a direct API call (not internal)
    if (res) {
      if (!team) {
        return res.status(404).json({ error: 'Team not found for this user' });
      }

      // Get all customers associated with this team
      const customersQuery = `
        SELECT * FROM customers 
        WHERE 
          (manager_id = $1 AND supplement_manager_id IS NOT NULL) OR
          (supplement_manager_id = $1 AND manager_id IS NOT NULL)
      `;
      const customers = await pool.query(customersQuery, [team.manager_id]);
      
      team.shared_customers = customers.rows;
      
      return res.status(200).json(team);
    }

    // If this is an internal call
    return team;

  } catch (error) {
    if (next) {
      return next(error);
    }
    throw error;
  }
};

// New function to get customers by team
const getTeamCustomers = async (req, res, next) => {
  try {
    const { teamId } = req.params;
    const team = await getTeamById(teamId);

    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const customers = await pool.query(`
      SELECT * FROM customers 
      WHERE manager_id = $1 OR supplement_manager_id = $1
    `, [team.manager_id]);

    res.status(200).json(customers.rows);
  } catch (error) {
    next(error);
  }
};


// Add this new controller function
const getTeamPerformanceMetrics = async (req, res) => {
  try {
    const { teamId } = req.params;
    
    // Get both overall performance and member-specific performance
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
  createNewTeam, 
  modifyTeam, 
  getTeams, 
  removeTeam,
  getTeamByUserId,
  getTeamCustomers,
  getTeamPerformanceMetrics
};