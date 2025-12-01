import userModel from '../models/user.model.js';
import { comparePassword, hashPassword } from '../utils/bcrypt.utils.js';
import { checkRequired, sendBadRequestResponse, sendErrorResponse, sendNotFoundResponse, sendSuccessResponse } from '../utils/response.utils.js';
import jwt from 'jsonwebtoken';
import 'dotenv/config';
import transporter from '../config/email.config.js';
import axios from "axios";
import mongoose from 'mongoose';


const JWT_SECRET = process.env.JWT_SECRET || process.env.JWT_SCERET;

export const createUser = async (req, res) => {
  try {
    const { fullName, phone, email, password } = req.body;

    const missing = checkRequired(req.body, ["fullName", "phone", "email", "password"]);
    if (missing.length > 0) {
      return sendBadRequestResponse(res, "Missing fields", 400, missing);
    }

    const existing = await userModel.findOne({ email });

    if (existing) {
      if (existing.isSocialLogin) {
        return sendBadRequestResponse(res, "Social login users cannot use manual registration. Please use social login or reset your password.", 400);
      }

      const match = await comparePassword(password, existing.password);
      if (!match) {
        return sendBadRequestResponse(res, "Invalid credentials", 401);
      }

      const payload = {
        _id: existing._id,
        fullName: existing.fullName,
        email: existing.email
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });

      const safeUser = {
        _id: existing._id,
        fullName: existing.fullName,
        email: existing.email,
        phone: existing.phone,
        avatar: existing.avatar,
        isSocialLogin: existing.isSocialLogin
      };

      return sendSuccessResponse(res, "User Login Successful", {
        user: safeUser,
        token
      });
    }

    const hashedPassword = await hashPassword(password);
    const avatar = `https://ui-avatars.com/api/?name=${encodeURI(fullName)}&background=random`;

    const newUser = await userModel.create({
      fullName,
      phone,
      email,
      password: hashedPassword,
      avatar,
      isSocialLogin: false
    });

    const payload = {
      _id: newUser._id,
      fullName: newUser.fullName,
      email: newUser.email
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });

    const safeUser = {
      _id: newUser._id,
      fullName: newUser.fullName,
      email: newUser.email,
      phone: newUser.phone,
      avatar: newUser.avatar,
      isSocialLogin: newUser.isSocialLogin
    };

    return sendSuccessResponse(res, "New User Register Successful", {
      user: safeUser,
      token
    });
  } catch (error) {
    return sendErrorResponse(res, 500, "Error while createUser", error);
  }
};

export const userLogin = async (req, res) => {
  try {
    const { email, phone, password } = req.body;

    if (!email && !phone) {
      return sendBadRequestResponse(res, "Please provide email or phone number", 400);
    }

    const missing = checkRequired(req.body, ["password"]);
    if (missing.length > 0) {
      return sendBadRequestResponse(res, "Missing fields", 400, missing);
    }

    let user = email ? await userModel.findOne({ email }) : await userModel.findOne({ phone });

    if (!user) {
      return sendNotFoundResponse(res, "User not found");
    }

    if (user.isSocialLogin) {
      return sendBadRequestResponse(res, "Social login users cannot use password login. Please use social login.", 400);
    }

    if (!user.password) {
      return sendBadRequestResponse(res, "Please set a password for your account", 400);
    }

    const match = await comparePassword(password, user.password);
    if (!match) {
      return sendBadRequestResponse(res, "Invalid credentials", 401);
    }

    const payload = {
      _id: user._id,
      fullName: user.fullName,
      email: user.email
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });

    const safeUser = {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      avatar: user.avatar,
      isSocialLogin: user.isSocialLogin
    };

    return sendSuccessResponse(res, "User login successful", {
      user: safeUser,
      token
    });
  } catch (error) {
    return sendErrorResponse(res, 500, "Error while userLogin", error);
  }
};

export const socialLogin = async (req, res) => {
  try {
    const { email, fullName, avatar } = req.body;
    const missing = checkRequired(req.body, ["email"]);

    if (missing.length > 0) {
      return sendBadRequestResponse(res, "Missing email", 400, missing);
    }

    let user = await userModel.findOne({ email });

    if (!user) {
      user = await userModel.create({
        fullName: fullName || "",
        email,
        avatar: avatar || null,
        password: null,
        isSocialLogin: true,
        otp: null,
        otpExpiry: null
      });
    } else {
      if (!user.isSocialLogin) {
        return sendBadRequestResponse(res, "Manual registered users cannot use social login. Please use email/password login.", 400);
      }

      user.fullName = fullName || user.fullName;
      user.avatar = avatar || user.avatar;
      user.isSocialLogin = true;
      await user.save();
    }

    const payload = {
      _id: user._id,
      fullName: user.fullName,
      email: user.email
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });

    const safeUser = {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      avatar: user.avatar,
      phone: user.phone,
      isSocialLogin: user.isSocialLogin
    };

    return sendSuccessResponse(res, "Social login successful", {
      user: safeUser,
      token
    });
  } catch (error) {
    console.log("Error while socialLogin: " + error.message);
    return sendErrorResponse(res, 500, "Error while socialLogin", error);
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return sendBadRequestResponse(res, "Email is required", 400);
    }

    const user = await userModel.findOne({ email });
    if (!user) {
      return sendNotFoundResponse(res, "User not found");
    }

    const otp = Math.floor(100000 + Math.random() * 900000);
    const expiry = Date.now() + 5 * 60 * 1000;

    user.otp = otp;
    user.otpExpiry = expiry;
    await user.save();

    await transporter.sendMail({
      from: process.env.EMAIL_USER || "hit.kalathiyainfotech@gmail.com",
      to: email,
      subject: "Password Reset OTP",
      html: `
      <div style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif">
        <div style="max-width:520px;margin:auto;background:white;border-radius:18px;overflow:hidden;box-shadow:0 10px 35px rgba(0,0,0,0.08)">
        
        <div style="background:linear-gradient(135deg,#2563eb,#1e40af);padding:40px;text-align:center;position:relative">
          <img src="https://cdn.jsdelivr.net/gh/dhruvish12/imagestorage_repo@main/images/1764586037_electro-ecommerce.png" 
              style="width:80px;height:80px;border-radius:50%;background:white;padding:10px;box-shadow:0 4px 15px rgba(0,0,0,0.2)">
          <h1 style="color:white;margin:20px 0 0;font-size:30px;font-weight:700;letter-spacing:0.5px">
            Electro-Ecommerce
          </h1>
          <p style="color:#dbeafe;margin-top:8px;font-size:15px">
            Secure Password Reset Verification
          </p>
          <svg viewBox="0 0 500 50" preserveAspectRatio="none" style="position:absolute;bottom:-1px;left:0;width:100%;height:50px">
            <path d="M0,0 C150,50 350,0 500,30 L500,50 L0,50 Z" style="fill:#1e40af"></path>
          </svg>
        </div>

        <div style="padding:35px 40px">
          <p style="color:#111;font-size:19px;font-weight:600;margin:0 0 12px;text-align:center">
            Your One-Time Password (OTP)
          </p>

          <p style="color:#555;font-size:15px;margin:0 0 28px;line-height:1.6;text-align:center">
            Enter the verification code below to reset your password. This ensures your account stays safe.
          </p>

          <div style="text-align:center;margin-bottom:35px">
            <div style="
              display:inline-block;
              font-size:40px;
              font-weight:700;
              letter-spacing:12px;
              padding:18px 0;
              color:#1e3a8a;
              border-radius:14px;
              background:#e0efff;
              border:2px solid #bfdbfe;
              min-width:180px;
              text-align:center;
            ">
              ${otp}
            </div>
          </div>

          <p style="text-align:center;color:#444;font-size:14px;margin-bottom:30px">
            This OTP will expire in <b>5 minutes</b>.
          </p>

          <div style="text-align:center;margin-bottom:35px">
            <img src="https://cdn.jsdelivr.net/gh/dhruvish12/imagestorage_repo@main/images/1764586037_electro-ecommerce.png" 
                style="width:10%;border-radius:14px;box-shadow:0 6px 22px rgba(0,0,0,0.12)">
          </div>

          <p style="font-size:13px;color:#888;text-align:center;line-height:1.5">
            If you didn’t request this, you can safely ignore this message.
          </p>
        </div>

        <div style="background:#f9fafb;padding:20px;text-align:center;border-top:1px solid #eee;border-radius:0 0 18px 18px">
          <p style="margin:0;font-size:12px;color:#777">
            © ${new Date().getFullYear()} Electro-Ecommerce. All rights reserved.
          </p>
        </div>

      </div>
    </div>
      `
    });

    return sendSuccessResponse(res, "OTP sent successfully");
  } catch (error) {
    console.log(error.message)
    return sendErrorResponse(res, 500, "Error while forgotPassword", error);
  }
};

export const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return sendBadRequestResponse(res, "Email and OTP are required", 400);
    }

    const user = await userModel.findOne({ email });
    if (!user) {
      return sendNotFoundResponse(res, "User not found");
    }

    if (!user.otp || !user.otpExpiry) {
      return sendBadRequestResponse(res, "OTP not generated", 400);
    }

    if (Date.now() > user.otpExpiry) {
      return sendBadRequestResponse(res, "OTP expired", 400);
    }

    if (Number(otp) !== user.otp) {
      return sendBadRequestResponse(res, "Invalid OTP", 400);
    }

    user.otp = null;
    user.otpExpiry = null;
    await user.save();

    return sendSuccessResponse(res, "OTP verified successfully");
  } catch (error) {
    return sendErrorResponse(res, 500, "Error while verifyOtp", error);
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return sendBadRequestResponse(res, "Email and new password are required", 400);
    }

    const user = await userModel.findOne({ email });
    if (!user) {
      return sendNotFoundResponse(res, "User not found");
    }

    const hashedPassword = await hashPassword(password);

    user.password = hashedPassword;
    await user.save();

    return sendSuccessResponse(res, "Password reset successfully");
  } catch (error) {
    return sendErrorResponse(res, 500, "Error while resetPassword", error);
  }
};

export const getAllCountry = async (req, res) => {
  try {
    const { data } = await axios.get(
      "https://restcountries.com/v3.1/all?fields=name,flags,idd"
    );

    const countries = data.map(country => {
      let code = "";
      if (country.idd?.root && country.idd?.suffixes?.length) {
        code = country.idd.suffixes.map(s => `${country.idd.root}${s}`).join(", ");
      }

      return {
        name: country.name.common,
        code,
        flag: country.flags?.png || null
      };
    });

    countries.sort((a, b) => a.name.localeCompare(b.name));

    return res.status(200).json({
      success: true,
      message: "Countries fetched successfully",
      total: countries.length,
      countries
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error while fetching countries",
      error: error.message
    });
  }
};

export const selectCountry = async (req, res) => {
  try {
    const { country } = req.params;
    const { _id: userId } = req.user;
    if (!userId || !country) {
      return res.status(400).json({
        success: false,
        message: "userId and country Name are required"
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid userId"
      });
    }

    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }

    user.country = country;

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Country selected successfully",
      country: user.country
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error while selecting country",
      error: error.message
    });
  }
};

export const addNewAddress = async (req, res) => {
  try {
    const userId = req.user?._id;
    const { houseDetails, landmark, city, state, pincode, saveAs, long, lati, setAsSelected } = req.body;

    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    if (!houseDetails || !city || !state || !pincode) {
      return res.status(400).json({ success: false, message: "houseDetails, city, state, and pincode are required" });
    }

    const user = await userModel.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    let mapURL = null;

    if (long && lati) {
      mapURL = `https://www.google.com/maps?q=${lati},${long}`;
    }

    const newAddress = {
      houseDetails,
      landmark: landmark || null,
      city,
      state,
      pincode,
      saveAs: saveAs || "Home",
      mapURL
    };

    user.address.push(newAddress);

    if (setAsSelected) {
      user.selectedAddress = user.address[user.address.length - 1]._id;
    }

    await user.save();

    return res.status(200).json({
      success: true,
      message: "Address added successfully",
      address: user.address,
      selectedAddress: user.selectedAddress
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error while adding address",
      error: error.message
    });
  }
};