const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');  // Add this import
const { sendErrorNotification } = require('../utils/email');

router.post('/send', async (req, res, next) => {
  try {
    const { to, subject, body } = req.body;
    
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD,
      },
    });

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to,
      subject,
      text: body,
    });

    res.json({ message: 'Email sent successfully' });
  } catch (error) {
    console.error('Email send error:', error);
    next(error);
  }
});

module.exports = router;