import mongoose from "mongoose";

const addressSchema = new mongoose.Schema(
  {
    houseDetails: { type: String, default: null },
    landmark: { type: String, default: null },
    city: { type: String, default: null },
    state: { type: String, default: null },
    pincode: { type: String, default: null },
    saveAs: { type: String, enum: ["Home", "Office", "Other"], default: "Home" }
  },
  { timestamps: true }
);

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true
    },
    phone: {
      type: String,
      default: null
    },
    email: {
      type: String,
      lowercase: true,
      default: null
    },
    password: {
      type: String,
      default: null
    },
    otp: {
      type: Number,
      default: null
    },
    otpExpiry: {
      type: Date,
      default: null
    },
    country: {
      type: String,
      default: null
    },
    avatar: {
      type: String,
      default: null
    },
    address: [addressSchema],
    selectedAddress: {
      type: mongoose.Schema.Types.ObjectId
    }
  },
  { timestamps: true }
);

const userModel = mongoose.model("user", userSchema);
export default userModel;