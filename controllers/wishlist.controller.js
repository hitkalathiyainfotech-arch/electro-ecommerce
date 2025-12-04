import mongoose from "mongoose";
import wishlistModel from "../models/wishlist.model.js";
import { ThrowError } from "../utils/Error.utils.js";
import { sendBadRequestResponse, sendNotFoundResponse, sendSuccessResponse } from "../utils/response.utils.js";
import productModel from "../models/product.model.js";

export const addToWishlist = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return sendBadRequestResponse(res, "Invalid product ID!");
    }

    const product = await productModel.findById(productId);
    if (!product) return sendNotFoundResponse(res, "Product not found!");

    let wishlist = await wishlistModel.findOne({ userId });
    if (!wishlist) {
      wishlist = new wishlistModel({ userId, items: [] });
    }

    if (!Array.isArray(wishlist.items)) {
      wishlist.items = [];
    }

    const exists = wishlist.items.some(
      (item) => item.productId.toString() === productId
    );
    if (exists) {
      return sendBadRequestResponse(res, "Product already in wishlist!");
    }

    wishlist.items.push({ productId });
    await wishlist.save();

    return sendSuccessResponse(res, "Added to wishlist!", wishlist);

  } catch (error) {
    return ThrowError(res, 500, error.message);
  }
};

export const getWishlist = async (req, res) => {
  try {
    const { id: userId } = req.user;

    const wishlist = await wishlistModel
      .findOne({ userId })
      .populate({
        path: "items.productId",
        model: "product",
        populate: {
          path: "categories",
          model:"category"
        }
      })
      .lean();

    if (!wishlist || !wishlist.items?.length) {
      return sendSuccessResponse(res, "Your wishlist is empty!", []);
    }

    wishlist.items = wishlist.items.filter((item) => item.productId);

    return sendSuccessResponse(
      res,
      "Wishlist fetched successfully!",
      wishlist
    );
  } catch (error) {
    return ThrowError(res, 500, error.message);
  }
};

export const removeFromWishlist = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return sendBadRequestResponse(res, "Invalid product ID!");
    }

    const wishlist = await wishlistModel.findOne({ userId });
    if (!wishlist) return sendNotFoundResponse(res, "Wishlist not found!");

    const exists = wishlist.items.some(
      (item) => item.productId.toString() === productId
    );
    if (!exists) {
      return sendNotFoundResponse(res, "Product not found in wishlist!");
    }

    wishlist.items = wishlist.items.filter(
      (item) => item.productId.toString() !== productId
    );
    await wishlist.save();

    return sendSuccessResponse(res, "Product removed from wishlist!", wishlist);

  } catch (error) {
    return ThrowError(res, 500, error.message);
  }
}