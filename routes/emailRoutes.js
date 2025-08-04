const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const { sendErrorNotification } = require('../utils/email');

// Create transporter once to reuse
const createTransporter = () => {
  return nodemailer.createTransport({  // CHANGED: createTransport (not createTransporter)
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
};

// General email sending route
router.post('/send', async (req, res, next) => {
  try {
    const { to, subject, body } = req.body;
    
    const transporter = createTransporter();

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

// Issue reporting route
router.post('/report-issue', async (req, res, next) => {
  try {
    const { from, description, subject } = req.body;
    console.log('Issue report received:', { from, description, subject });  
    
    if (!description) {
      return res.status(400).json({ error: 'Issue description is required' });
    }

    const transporter = createTransporter();

    // Email content with better formatting
    const emailBody = `
DASHBOARD ISSUE REPORT
======================

Reporter: ${from || 'Unknown User'}
Date: ${new Date().toLocaleString('en-US', { 
  timeZone: 'America/New_York',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: true
})}

Issue Description:
${description}

---
This issue was reported from the Affordable Roofing dashboard.
Please respond to the user at: ${from}
    `.trim();

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626; border-bottom: 2px solid #dc2626; padding-bottom: 10px;">
          🚨 DASHBOARD ISSUE REPORT
        </h2>
        
        <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p><strong>Reporter:</strong> ${from || 'Unknown User'}</p>
          <p><strong>Date:</strong> ${new Date().toLocaleString('en-US', { 
            timeZone: 'America/New_York',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          })}</p>
        </div>

        <div style="background-color: #fff; border-left: 4px solid #3b82f6; padding: 20px; margin: 20px 0;">
          <h3 style="color: #1f2937; margin-top: 0;">Issue Description:</h3>
          <p style="white-space: pre-wrap; line-height: 1.6;">${description}</p>
        </div>

        <div style="background-color: #f3f4f6; padding: 15px; border-radius: 6px; font-size: 12px; color: #6b7280;">
          This issue was reported from the Affordable Roofing dashboard.<br>
          Please respond to the user at: <a href="mailto:${from}" style="color: #3b82f6;">${from}</a>
        </div>
      </div>
    `;

    console.log('Sending email to:', 'laynemcintosh12@gmail.com');
    console.log('Email user config:', process.env.EMAIL_USER ? 'Set' : 'Not set');

    // Send email to you (admin)
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: 'laynemcintosh12@gmail.com', // Your email
      subject: subject || 'NEW ISSUE ON DASHBOARD',
      text: emailBody,
      html: htmlBody,
      replyTo: from || process.env.EMAIL_USER
    });

    console.log('Admin email sent successfully');

    // Send confirmation email to the reporter if email is provided
    if (from && from.includes('@')) {
      const confirmationBody = `
Hi there,

Thank you for reporting an issue with the Affordable Roofing dashboard. We have received your report and will investigate it promptly.

Your Issue Description:
"${description}"

We'll get back to you as soon as possible with an update or resolution.

Best regards,
Dashboard Support Team
      `.trim();

      const confirmationHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #059669;">✅ Issue Report Received</h2>
          
          <p>Hi there,</p>
          
          <p>Thank you for reporting an issue with the Affordable Roofing dashboard. We have received your report and will investigate it promptly.</p>
          
          <div style="background-color: #f0fdf4; border: 1px solid #bbf7d0; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <h3 style="color: #065f46; margin-top: 0;">Your Issue Description:</h3>
            <p style="white-space: pre-wrap; color: #047857;">"${description}"</p>
          </div>
          
          <p>We'll get back to you as soon as possible with an update or resolution.</p>
          
          <p>Best regards,<br>
          <strong>Dashboard Support Team</strong></p>
        </div>
      `;

      try {
        await transporter.sendMail({
          from: process.env.EMAIL_USER,
          to: from,
          subject: 'Issue Report Confirmation - Affordable Roofing Dashboard',
          text: confirmationBody,
          html: confirmationHtml
        });
        console.log('Confirmation email sent successfully to:', from);
      } catch (confirmationError) {
        console.warn('Failed to send confirmation email:', confirmationError);
        // Don't fail the main request if confirmation email fails
      }
    }

    res.json({ 
      message: 'Issue reported successfully. We will investigate and get back to you soon.',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Issue report error:', error);
    
    // Try to send a notification about the failed issue report
    try {
      await sendErrorNotification({
        error: `Failed to process issue report: ${error.message}`,
        context: 'Issue Report System',
        userEmail: req.body.from
      });
    } catch (notificationError) {
      console.error('Failed to send error notification:', notificationError);
    }
    
    res.status(500).json({ 
      error: 'Failed to send issue report', 
      details: error.message 
    });
  }
});

module.exports = router;