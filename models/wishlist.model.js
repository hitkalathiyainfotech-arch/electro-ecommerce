import mongoose from "mongoose";

const wishlistSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
    },
    items: [
      {
        productId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "product",
          required: true,
        },
        productVariantId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "productVariant",
          required: false,
        },
      },
    ],
  },
  { timestamps: true }
);

const wishlistModel = mongoose.model("wishlist", wishlistSchema);
