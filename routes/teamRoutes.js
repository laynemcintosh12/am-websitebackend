const express = require('express');
const { 
  createNewTeam, 
  modifyTeam, 
  getTeams, 
  removeTeam, 
  getTeamByUserId,
  getTeamCustomers,
  getTeamPerformanceMetrics 
} = require('../controllers/teamController');
const { protectRoute } = require('../middleware/authMiddleware');

const router = express.Router();

/**
 * Team Management Routes
 * These routes handle the creation and management of teams
 */

// Creates a new team
// POST /api/teams
// Required body: { 
//   managerId: ID of team manager,
//   teamName: name of the team,
//   teamType: 'Sales' | 'Supplement' | 'Affiliate',
//   salesmanIds?: array of salesman IDs,
//   supplementerIds?: array of supplementer IDs
// }
// Effects:
// - Creates new team record
// - Associates manager and team members
router.post('/', createNewTeam);

// Updates an existing team
// PUT /api/teams
// Required body: {
//   team_id: ID of team to update,
//   team_name?: new team name,
//   team_type?: new team type,
//   manager_id?: new manager ID,
//   salesman_ids?: updated array of salesman IDs,
//   supplementer_ids?: updated array of supplementer IDs
// }
// Effects:
// - Updates team record
// - Updates team member associations
router.put('/', modifyTeam);

// Retrieves all teams with detailed information
// GET /api/teams
// Returns: Array of team records with:
// - Basic team information
// - Manager details
// - Team member lists
// - Creation and update timestamps
router.get('/', getTeams);

// Deletes a team
// DELETE /api/teams/:teamId
// Effects:
// - Removes team record
// - Maintains historical data for commissions
// - Does not remove user associations
router.delete('/:teamId', removeTeam);

/**
 * Team Member Routes
 */

// Gets team information for a specific user
// GET /api/teams/user/:userId
// Returns: Team record with:
// - Team details
// - Role-specific information
// - Shared customers if applicable
router.get('/user/:userId', getTeamByUserId);

/**
 * Team Performance Routes
 */

// Gets all customers associated with a team
// GET /api/teams/:teamId/customers
// Returns: Array of customers with:
// - Customer details
// - Status information
// - Job pricing
// - Associated team members
router.get('/:teamId/customers', getTeamCustomers);

// Gets team performance metrics
// GET /api/teams/:teamId/performance
// Returns: Performance data including:
// - Revenue metrics
// - Commission information
// - Customer counts
// - Team member performance
router.get('/:teamId/performance', getTeamPerformanceMetrics);

module.exports = router;