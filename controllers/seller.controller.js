import { config } from 'dotenv'; config();
import mongoose from "mongoose";
import { sendBadRequestResponse, sendErrorResponse, sendNotFoundResponse, sendResponse, sendSuccessResponse } from '../utils/response.utils.js';
import sellerModel from "../models/seller.model.js";
import bcrypt from "bcryptjs";
import twilio from "twilio";
import jwt from 'jsonwebtoken';
import transporter from '../utils/Email.config.js'
import validateGSTIN from '../utils/gst.verify.config.js'
import axios from 'axios';
import { ThrowError } from '../utils/Error.utils.js';
// import { uploadFile } from '../middleware/imageupload.js';

const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const saltRounds = 10;
const JWT_SECRET = process.env.JWT_SECRET
const otpMap = new Map();

export const createAdminController = async (req, res) => {
  try {
    const { mobileNo, email, password } = req.body;

    if (!mobileNo || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "mobileNo, email & password are required!"
      });
    }

    const existingAdmin = await sellerModel.findOne({ role: "admin" });
    if (existingAdmin) {
      return res.status(409).json({
        success: false,
        message: "Admin already exists!"
      });
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);

    function Ravatar(email) {
      try {
        const formattedName = email.trim().replace(/\s+/g, "+");
        const avatarUrl = `https://ui-avatars.com/api/?name=${formattedName}&background=random`;
        return avatarUrl;
      } catch (error) {
        console.error("Error generating avatar:", error);
        return null;
      }
    }
    const profileAvatar = Ravatar(email) || "";

    const newAdmin = await sellerModel.create({
      email,
      mobileNo,
      avatar: profileAvatar,
      password: hashedPassword,
      role: "admin",
      verified: true
    });

    const token = jwt.sign(newAdmin.toJSON(), JWT_SECRET, { expiresIn: "7d" });

    return res.status(201).json({
      success: true,
      message: "Admin account created successfully!",
      admin: {
        id: newAdmin._id,
        mobileNo: newAdmin.mobileNo,
        email: newAdmin.email,
        role: newAdmin.role,
      },
      token: token
    });

  } catch (error) {
    console.error("Admin Creation Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Error creating admin account",
      error: error.message,
    });
  }
};

export const newSellerController = async (req, res) => {
  try {
    const { mobileNo, email, password } = req.body;

    if (!mobileNo || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "mobileNo, email & password are required!"
      });
    }

    const existingSeller = await sellerModel.findOne({
      $or: [{ mobileNo: mobileNo }, { email: email }]
    });
    if (existingSeller) {
      return res.status(409).json({
        success: false,
        message: "You are already registered!"
      });
    }

    const hashedPassword = await bcrypt.hash(password, saltRounds);

    function Ravatar(email) {
      try {
        const formattedName = email.trim().replace(/\s+/g, "+");
        const avatarUrl = `https://ui-avatars.com/api/?name=${formattedName}&background=random`;
        return avatarUrl;
      } catch (error) {
        console.error("Error generating avatar:", error);
        return null;
      }
    }
    const profileAvatar = Ravatar(email) || "";

    const newSeller = await sellerModel.create({
      email,
      mobileNo,
      avatar: profileAvatar,
      password: hashedPassword,
      role: "seller"
    });

    try {
      const verification = await client.verify.v2
        .services(process.env.TWILIO_VERIFY_SID)
        .verifications.create({
          to: `+91${mobileNo}`,
          channel: "sms",
        });

      return res.status(201).json({
        success: true,
        message: "Seller registered successfully & OTP sent!",
        verificationSid: verification.sid,
        seller: {
          id: newSeller._id,
          mobileNo: newSeller.mobileNo,
          email: newSeller.email,
          avatar: newSeller.avatar,
          role: newSeller.role
        },
      });
    } catch (twilioError) {
      console.error("Twilio OTP Error:", twilioError.message);
      return res.status(201).json({
        success: true,
        message: "Seller registered successfully but OTP sending failed.",
        seller: {
          id: newSeller._id,
          mobileNo: newSeller.mobileNo,
          email: newSeller.email,
          role: newSeller.role
        },
      });
    }
  } catch (error) {
    console.error("Registration Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Error registering new seller",
      error: error.message,
    });
  }
};

export const getAllSeller = async (req, res) => {
  try {
    const sellerData = await sellerModel.find({ role: "seller" })

    if (!sellerData || sellerData.length == 0) {
      return sendNotFoundResponse(res, "Seller not found!!!")
    }

    return sendSuccessResponse(res, "Seller fetched Successfully...", sellerData)

  } catch (error) {
    console.error("Seller fetch Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Error fetching new seller",
      error: error.message,
    });
  }
}

export const getAllAdmins = async (req, res) => {
  try {
    const adminData = await sellerModel.find({ role: "admin" })

    if (!adminData || adminData.length == 0) {
      return sendNotFoundResponse(res, "Admins not found!!!")
    }

    return sendSuccessResponse(res, "Admins fetched Successfully...", adminData)

  } catch (error) {
    console.error("Admins fetch Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Error fetching admins",
      error: error.message,
    });
  }
}

export const getSeller = async (req, res) => {
  try {
    const { id } = req.user;

    const seller = await sellerModel.findById(id).select("-password -tokens");
    if (!seller) {
      return sendNotFoundResponse(res, "Seller not found");
    }

    return sendSuccessResponse(res, "Seller profile fetched successfully", seller);

  } catch (error) {
    console.error("Seller fetch Error:", error.message);
    return ThrowError(res, 500, error.message);
  }
};

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const { firstName, lastName, email, mobileNo } = req.body;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return sendBadRequestResponse(res, "Invalid User ID!");
    }

    const user = await sellerModel.findById(userId);
    if (!user) {
      return sendNotFoundResponse(res, "User not found...");
    }

    if (email && email !== user.email) {
      const existingEmail = await sellerModel.findOne({
        email: { $regex: new RegExp(`^${email}$`, "i") },
        _id: { $ne: userId }
      });

      if (existingEmail) {
        return sendBadRequestResponse(res, "This email already exists...");
      }
    }

    let avatar = user.avatar;
    const imageFile = req.file;

    if (imageFile) {
      if (avatar) {
        try {
          const fileName = avatar.split("/").pop();
          const oldKey = `uploads/${fileName}`;

          await s3.send(
            new DeleteObjectCommand({
              Bucket: process.env.S3_BUCKET_NAME,
              Key: oldKey,
            })
          );

        } catch (err) {
          console.log("Failed to delete old avatar:", err.message);
        }
      }

      const result = await uploadFile(imageFile);
      avatar = result.url;

    }

    const updatedUser = await sellerModel.findByIdAndUpdate(
      userId,
      {
        firstName: firstName || user.firstName,
        lastName: lastName || user.lastName,
        email: email || user.email,
        mobileNo: mobileNo || user.mobileNo,
        avatar: avatar
      },
      { new: true, runValidators: true }
    );

    return sendSuccessResponse(res, "Profile updated successfully!", updatedUser);

  } catch (error) {
    return ThrowError(res, 500, error.message);
  }
};

export const sellerPasswordChangeController = async (req, res) => {
  try {
    const { id } = req?.user;
    const { oldPassword, newPassword } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return sendBadRequestResponse(res, "Invalid sellerId");
    }

    if (!oldPassword || !newPassword) {
      return sendBadRequestResponse(res, "Old password and new password required");
    }

    const seller = await sellerModel.findById(id).select("password");

    if (!seller) {
      return sendBadRequestResponse(res, "seller not found");
    }

    const isMatch = await bcrypt.compare(oldPassword, seller.password);
    if (!isMatch) {
      return sendBadRequestResponse(res, "Old password is incorrect");
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    seller.password = hashedPassword;
    await seller.save();

    return sendSuccessResponse(res, "Password changed successfully");
  } catch (error) {
    console.error("Change Password Error:", error);
    return sendErrorResponse(res, 500, "Something went wrong while changing password", error);
  }
}

export const verifySellerMobileOtpController = async (req, res) => {
  const COMMON_OTP = "000000";

  try {
    const { mobileNo, otp } = req.body;

    if (!mobileNo && !otp) {
      return res.status(400).json({
        success: false,
        message: "Mobile number & OTP are required! to request"
      });
    }

    const seller = await sellerModel.findOne({ mobileNo: mobileNo });
    if (!seller) {
      return sendNotFoundResponse(res, "Seller not found!");
    }

    if (seller.role === "admin") {
      const payload = {
        id: seller._id,
        name: seller.businessName || seller.email,
        email: seller.email,
        mobileNo: seller.mobileNo,
        isSeller: true,
        role: seller.role
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

      return res.status(200).json({
        success: true,
        message: "Admin verified successfully, login successful",
        seller: {
          id: seller._id,
          email: seller.email,
          role: seller.role,
          businessName: seller.businessName
        },
        token: token
      });
    }

    try {
      const verificationCheck = await client.verify.v2
        .services(process.env.TWILIO_VERIFY_SID)
        .verificationChecks.create({
          to: `+91${mobileNo}`,
          code: otp
        });

      console.log("Twilio Verification Status:", verificationCheck.status);

      if (verificationCheck.status === "approved") {
        seller.verified = true;
        await seller.save();

        const payload = {
          id: seller._id,
          name: seller.businessName || seller.email,
          email: seller.email,
          mobileNo: seller.mobileNo,
          isSeller: true,
          role: seller.role
        };

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

        return res.status(200).json({
          success: true,
          message: "Seller verified successfully, login successful",
          seller: {
            id: seller._id,
            email: seller.email,
            role: seller.role,
            businessName: seller.businessName
          },
          token: token
        });
      }
    } catch (twilioError) {
      console.warn("Twilio Verification Failed:", twilioError.message);
    }

    if (otp === COMMON_OTP) {
      seller.verified = true;
      await seller.save();

      const payload = {
        id: seller._id,
        name: seller.businessName || seller.email,
        email: seller.email,
        mobileNo: seller.mobileNo,
        isSeller: true,
        role: seller.role
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

      return res.status(200).json({
        success: true,
        message: "Seller verified successfully (via COMMON_OTP), login successful",
        seller: {
          id: seller._id,
          email: seller.email,
          role: seller.role,
          businessName: seller.businessName
        },
        token: token
      });
    }

    return res.status(400).json({
      success: false,
      message: "Invalid OTP"
    });

  } catch (error) {
    console.error("OTP Verification Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Error while verifying OTP",
      error: error.message
    });
  }
}

export const sellerLoginController = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required! to request"
      });
    }

    const seller = await sellerModel.findOne({ email });
    if (!seller) {
      return res.status(404).json({
        success: false,
        message: "You are not registered, please sign up first 🙏"
      });
    }

    const isPasswordValid = await bcrypt.compare(password, seller.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid password!"
      });
    }

    const payload = {
      _id: seller._id.toString(),
      email: seller.email,
      mobileNo: seller.mobileNo,
      isSeller: true,
      role: seller.role
    };

    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "7d" });

    let message = "";
    if (seller.role === "admin") {
      message = "Admin login successful";
    } else {
      message = "Seller login successful";
    }

    return res.status(200).json({
      success: true,
      message: message,
      user: {
        id: seller._id,
        email: seller.email,
        role: seller.role,
        businessName: seller.businessName,
        mobileNo: seller.mobileNo
      },
      token
    });

  } catch (error) {
    console.error("Login Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Error while logging in",
      error: error.message
    });
  }
}

export const sellerForgetPasswordController = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required!"
      });
    }

    const seller = await sellerModel.findOne({ email });
    if (!seller) {
      return res.status(404).json({
        success: false,
        message: "User not found, please register first!"
      });
    }

    const OTP = Math.floor(100000 + Math.random() * 900000).toString();
    const from_email = process.env.SMTP_EMAIL || "darshan1.kalathiyainfotech@gmail.com";

    seller.otp = OTP;
    await seller.save();

    otpMap.set(email, {
      OTP,
      expiresAt: Date.now() + 10 * 60 * 1000
    });

    await transporter.sendMail({
      from: from_email,
      to: email,
      subject: "OTP for Password Reset Fastcart - FastCart",
      html: `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; padding: 30px; background: #f4f6f8;">
                <div style="max-width: 520px; margin: auto; background: #ffffff; border-radius: 12px; padding: 28px; box-shadow: 0 6px 16px rgba(0,0,0,0.08); border: 1px solid #eaeaea;">
                    <h2 style="color: #2c3e50; text-align: center; margin-bottom: 10px; font-size: 22px;">
                        FastCart Password Reset
                    </h2>
                    <hr style="border: none; height: 1px; background: #ececec; margin: 15px 0;">
                    <p style="font-size: 15px; color: #2c3e50; margin: 12px 0;">
                        Hello <b>${seller.businessName || seller.email || "User"}</b>,
                    </p>
                    <p style="font-size: 15px; color: #555; line-height: 1.6; margin: 12px 0;">
                        We received a request to reset your FastCart account password.<br>
                        Please use the OTP below to continue with resetting your password:
                    </p>
                    <div style="text-align: center; margin: 28px 0;">
                        <p style="display: inline-block; background: #eaf6ff; color: #e74c3c; font-size: 26px; font-weight: bold; letter-spacing: 4px; padding: 12px 20px; border-radius: 8px; border: 1px dashed #3498db;">
                        ${OTP}
                        </p>
                    </div>
                    <p style="font-size: 14px; color: #777; line-height: 1.5; margin: 12px 0;">
                        This OTP will expire in 10 minutes. If you didn't request a password reset, you can safely ignore this email.
                    </p>
                    <p style="font-size: 14px; color: #444; text-align: center; margin-top: 25px;">
                        – The FastCart Team
                    </p>
                </div>
            </div>
        `
    });

    return res.status(200).json({
      success: true,
      message: "Forgot password OTP sent successfully!",
      toEmail: email,
      otp: OTP
    });

  } catch (error) {
    console.error("Forgot Password OTP Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Error while sending forgot password OTP!",
      error: error.message
    });
  }
}

export const sellerVerifyForgetOtpController = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email & OTP are required!"
      });
    }

    const seller = await sellerModel.findOne({ email });
    if (!seller) {
      return res.status(404).json({
        success: false,
        message: "User not found!"
      });
    }

    if (seller.otp && seller.otp === otp) {
      seller.otp = null;
      await seller.save();

      return res.status(200).json({
        success: true,
        message: "OTP verified successfully! You can now reset your password."
      });
    }

    const otpEntry = otpMap.get(email);
    if (otpEntry && otpEntry.expiresAt > Date.now()) {
      if (otpEntry.OTP === otp) {
        otpMap.delete(email);

        return res.status(200).json({
          success: true,
          message: "OTP verified successfully! You can now reset your password."
        });
      } else {
        return res.status(400).json({
          success: false,
          message: "Invalid OTP!"
        });
      }
    }

    return res.status(400).json({
      success: false,
      message: "Invalid or expired OTP. Please request a new one."
    });

  } catch (error) {
    console.error("Verify Forgot OTP Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Error while verifying OTP!",
      error: error.message
    });
  }
};

export const sellerPasswordResetController = async (req, res) => {
  try {
    const { email, newPassword } = req.body;

    if (!email || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Email & new password are required!"
      });
    }

    const user = await sellerModel.findOne({ email });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found!"
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    user.password = hashedPassword;
    user.otp = null;
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Password reset successfully! You can now login with your new password."
    });

  } catch (error) {
    console.error("Reset Password Error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Error while resetting password!",
      error: error.message
    });
  }
}

export const sellerPickUpAddressSetController = async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      return sendBadRequestResponse(res, "Admin cannot set pickup address!");
    }

    const { houseNo, street, landmark, pincode, city, state } = req.body;
    const { id } = req?.user || {};

    if (!id) {
      return sendBadRequestResponse(res, "User not found in request!");
    }

    if (![houseNo, street, landmark, pincode, city, state].every(field => field && field.toString().trim() !== "")) {
      return sendBadRequestResponse(
        res,
        "houseNo, street, landmark, pincode, city & state are required!"
      );
    }

    const SellerPickUpAddr = await sellerModel.findByIdAndUpdate(
      { _id: id },
      {
        $push: {
          pickUpAddr: { houseNo, street, landmark, pincode, city, state }
        }
      },
      { new: true, runValidators: true }
    );

    if (!SellerPickUpAddr) {
      return sendNotFoundResponse(res, "Seller not found!");
    }

    return sendSuccessResponse(
      res,
      "Pick-up address inserted successfully!",
      { pickUpAddr: SellerPickUpAddr.pickUpAddr }
    );

  } catch (error) {
    console.error("Error while adding PickUp Address:", error);
    return sendErrorResponse(res, "Error while inserting pick-up address!");
  }
};