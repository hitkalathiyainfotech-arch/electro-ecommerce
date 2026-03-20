import nodemailer from 'nodemailer';
import 'dotenv/config'

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  tls: {
    rejectUnauthorized: false
  },
  auth: {
    user: process.env.EMAIL_USER || "darshan1.kalathiyainfotech@gmail.com",
    pass: process.env.EMAIL_PASS || "fxea ykui olbg oqoh",
  },
});

transporter.verify(err => {
  if (err) console.log('Email error:', err.message);
});

export default transporter;
