const axios = require('axios');

const fetchJobNimbusData = async () => {
  const token = process.env.JOBNIMBUSTOKEN;
  if (!token) {
    throw new Error('JobNimbus token is missing. Please set JOBNIMBUSTOKEN in your .env file.');
  }

  try {
    const response = await axios.get('https://app.jobnimbus.com/api1/jobs/', {
      headers: { Authorization: `Bearer ${token}` },
    });

    return response.data; // The `results` array will be accessed in the controller
  } catch (error) {
    console.error('JobNimbus API Error:', error.response?.data || error.message);
    throw new Error(`JobNimbus API request failed: ${error.message}`);
  }
};

module.exports = { fetchJobNimbusData };