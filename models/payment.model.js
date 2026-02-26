import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "user",
            required: true
        },
        orderId: {
            type: String,
            required: true,
            index: true
        },
        orderObjectId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "order"
        },
        stripePaymentIntentId: {
            type: String,
            required: true,
            unique: true
        },
        stripeClientSecret: {
            type: String
        },
        amount: {
            type: Number,
            required: true
        },
        currency: {
            type: String,
            default: "INR"
        },
        status: {
            type: String,
            required: true
        },
        method: {
            type: String,
            default: "card"
        },
        email: {
            type: String
        },
        contact: {
            type: String
        },
        card: {
            brand: String,
            last4: String,
            expMonth: Number,
            expYear: Number,
            funding: String
        },
        fee: Number,
        tax: Number,
        error_code: String,
        error_description: String,
        created_at: {
            type: Date,
            default: Date.now
        }
    },
    { timestamps: true }
);

export default mongoose.model("payment", paymentSchema);
