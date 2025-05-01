/**
 * Converts a Date object to Unix timestamp (seconds)
 */
const formatToUnixTimestamp = (date) => {
  return Math.floor(date.getTime() / 1000);
};

module.exports = {
  formatToUnixTimestamp
};