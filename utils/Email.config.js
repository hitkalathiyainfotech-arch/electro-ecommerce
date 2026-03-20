import nodemailer from 'nodemailer'
import { config } from 'dotenv';
config();

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  requireTLS: true,
  auth: {
    user: process.env.EMAIL_USER || "darshan1.kalathiyainfotech@gmail.com",
    pass: process.env.EMAIL_PASS || "nxjtawvfcfmwmhjp",
  },
});

export default transporter