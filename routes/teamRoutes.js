const express = require('express');
const { 
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
} = require('../controllers/teamController');

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
//   supplementerIds?: array of supplementer IDs,
//   effectiveDate?: optional date to backdate team creation (ISO format)
// }
router.post('/', createNewTeam);

// Updates an existing team
// PUT /api/teams
// Required body: {
//   team_id: ID of team to update,
//   team_name?: new team name,
//   team_type?: new team type,
//   manager_id?: new manager ID,
//   salesman_ids?: updated array of salesman IDs,
//   supplementer_ids?: updated array of supplementer IDs,
//   effective_date?: optional date to apply changes from (ISO format)
// }
router.put('/', modifyTeam);

// Retrieves all teams with detailed information
// GET /api/teams
// Query params:
//   includeMembership: 'true' to include member details
//   historicalDate: ISO date to get team composition at that date
router.get('/', getTeams);

// Deletes a team
// DELETE /api/teams/:teamId
// Body params:
//   preserveHistory: boolean - keep historical memberships with departure date
//   effectiveDate: ISO date - when team was dissolved
router.delete('/:teamId', removeTeam);

/**
 * Team Member Routes
 */

// Gets team information for a specific user
// GET /api/teams/user/:userId
// Query params:
//   historicalDate: ISO date to check team membership at that date
router.get('/user/:userId', getTeamByUserId);

// Gets all teams for a user (including historical)
// GET /api/teams/users/:userId/teams
// Query params:
//   historicalDate: ISO date to check team at that point
//   includeHistory: 'true' to include all historical memberships
router.get('/users/:userId/teams', getUserTeamsController);

// Gets all members of a team
// GET /api/teams/:teamId/members
// Query params:
//   historicalDate: ISO date to get team members at that date
router.get('/:teamId/members', getTeamMembers);

// Gets membership history for a team
// GET /api/teams/:teamId/membership-history
router.get('/:teamId/membership-history', getTeamMembershipHistory);

// Add user to team (current date)
// POST /api/teams/membership
// Required body: { userId, teamId, role }
router.post('/membership', addUserToTeamController);

// Add user to team with custom join date
// POST /api/teams/membership/dated
// Required body: { userId, teamId, role, joinedAt (ISO date) }
router.post('/membership/dated', addUserToTeamWithDateController);

// Set departure date for team member
// PUT /api/teams/membership/:userId/:teamId/departure
// Required body: { departureDate (ISO date) }
router.put('/membership/:userId/:teamId/departure', setUserTeamDepartureDateController);

// Remove user from team (all history)
// DELETE /api/teams/membership/:userId/:teamId
router.delete('/membership/:userId/:teamId', removeUserFromTeamController);

// Update user role in team
// PUT /api/teams/membership/:userId/:teamId/role
// Required body: { role }
router.put('/membership/:userId/:teamId/role', updateUserRoleInTeam);

// Check if user was on team at a specific date
// GET /api/teams/membership/:userId/:teamId/check
// Query params: date (ISO format)
router.get('/membership/:userId/:teamId/check', checkUserTeamMembershipAtDate);

// Bulk update team memberships
// PUT /api/teams/:teamId/memberships
// Required body: { 
//   teamId,
//   memberships: Array of { userId, role },
//   effectiveDate: ISO date
// }
router.put('/:teamId/memberships', bulkUpdateTeamMemberships);

// Remove user from all teams
// DELETE /api/teams/users/:userId/memberships
router.delete('/users/:userId/memberships', removeUserFromAllTeamsController);

/**
 * Team Customer Routes
 */

// Gets all customers associated with a team
// GET /api/teams/:teamId/customers
// Query params:
//   historicalDate: ISO date - get customers as of this date
router.get('/:teamId/customers', getTeamCustomers);

// Gets team performance metrics
// GET /api/teams/:teamId/performance
router.get('/:teamId/performance', getTeamPerformanceMetrics);

module.exports = router;