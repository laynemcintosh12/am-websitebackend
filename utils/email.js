const nodemailer = require('nodemailer');

const sendErrorNotification = async (error) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail', // Use your email provider (e.g., Gmail, Outlook)
    auth: {
      user: process.env.EMAIL_USER, // Your email address
      pass: process.env.EMAIL_PASSWORD, // Your email password or app-specific password
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: process.env.NOTIFICATION_EMAIL, // Email address to send notifications to
    subject: 'Customer Sync Error Notification',
    text: `An error occurred during the customer sync process:\n\n${error.message}\n\nStack Trace:\n${error.stack}`,
  };

  await transporter.sendMail(mailOptions);
};

const sendPasswordResetEmail = async (email, resetToken) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail', // Use your email provider
    auth: {
      user: process.env.EMAIL_USER, // Your email address
      pass: process.env.EMAIL_PASSWORD, // Your email password or app-specific password
    },
  });

  const resetLink = `${process.env.RESET_PASSWORD_URL}?token=${resetToken}`; // Construct the reset link

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Password Reset Request',
    html: `
      <p>You requested a password reset. Click the link below to reset your password:</p>
      <a href="${resetLink}">${resetLink}</a>
      <p>If you did not request this, please ignore this email.</p>
    `,
  };

  await transporter.sendMail(mailOptions);
};

const sendCommissionNotification = async (userId, customerId, commissionAmount) => {
    try {
        const user = await db.query('SELECT name FROM users WHERE id = $1', [userId]);
        const customer = await db.query('SELECT customer_name FROM customers WHERE id = $1', [customerId]);
        
        const emailContent = {
            subject: `New Commission Ready to Be Paid for ${user.rows[0].name}`,
            text: `${user.rows[0].name} has finalized ${customer.rows[0].customer_name} and has earned $${commissionAmount} for this. Please check the commission dashboard to view further details, as well as user balance.`
        };

        await sendMail(process.env.ADMIN_EMAIL, emailContent.subject, emailContent.text);
    } catch (error) {
        console.error('Failed to send commission notification:', error);
        // Don't throw - we don't want to break the commission process if email fails
    }
};

module.exports = { sendErrorNotification, sendPasswordResetEmail, sendCommissionNotification };