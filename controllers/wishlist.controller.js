import mongoose from "mongoose";
import wishlistModel from "../models/wishlist.model.js";
import { ThrowError } from "../utils/Error.utils.js";
import { sendBadRequestResponse, sendNotFoundResponse, sendSuccessResponse } from "../utils/response.utils.js";
import productModel from "../models/product.model.js";
import productVariantModel from "../models/productVarient.model.js";

export const addToWishlist = async (req, res) => {
  try {
    const { id: userId } = req.user;
    const { productId, variantId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return sendBadRequestResponse(res, "Invalid product ID!");
    }

    const product = await productModel.findById(productId);
    if (!product) return sendNotFoundResponse(res, "Product not found!");

    if (variantId) {
      if (!mongoose.Types.ObjectId.isValid(variantId)) {
        return sendBadRequestResponse(res, "Invalid variant ID!");
      }
      const variant = await productVariantModel.findById(variantId);
      if (!variant) return sendNotFoundResponse(res, "Variant not found!");
    }

    let wishlist = await wishlistModel.findOne({ userId });
    if (!wishlist) {
      wishlist = new wishlistModel({ userId, items: [] });
    }

    if (!Array.isArray(wishlist.items)) {
      wishlist.items = [];
    }

    const exists = wishlist.items.some((item) => {
      const isSameProduct = item.productId.toString() === productId;
      const isSameVariant = variantId
        ? item.productVariantId && item.productVariantId.toString() === variantId
        : !item.productVariantId;

      return isSameProduct && isSameVariant;
    });

    if (exists) {
      return sendBadRequestResponse(res, "Product already in wishlist!");
    }

    wishlist.items.push({
      productId,
      productVariantId: variantId || undefined,
    });
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
        populate: [
          {
            path: "categories",
            model: "category",
          },
          {
            path: "variantId",
            model: "productVariant",
          },
        ],
      })
      .populate({
        path: "items.productVariantId",
        model: "productVariant",
      })
      .lean();

    if (!wishlist || !wishlist.items?.length) {
      return sendSuccessResponse(res, "Your wishlist is empty!", {});
    }

    wishlist.items = wishlist.items.filter((item) => item.productId);

    wishlist.items.forEach((item) => {
      if (item.productVariantId && item.productId && Array.isArray(item.productId.variantId)) {
        item.productId.variantId = item.productId.variantId.filter(
          (variant) => variant._id.toString() === item.productVariantId._id.toString()
        );
      }
    });

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
    const { productId, variantId } = req.body;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      return sendBadRequestResponse(res, "Invalid product ID!");
    }

    const wishlist = await wishlistModel.findOne({ userId });
    if (!wishlist) return sendNotFoundResponse(res, "Wishlist not found!");

    const existsIndex = wishlist.items.findIndex((item) => {
      const isSameProduct = item.productId.toString() === productId;
      const isSameVariant = variantId
        ? item.productVariantId && item.productVariantId.toString() === variantId
        : !item.productVariantId;

      return isSameProduct && isSameVariant;
    });

    if (existsIndex === -1) {
      return sendNotFoundResponse(res, "Product not found in wishlist!");
    }

    wishlist.items.splice(existsIndex, 1);

    await wishlist.save();

    return sendSuccessResponse(res, "Product removed from wishlist!", wishlist);

  } catch (error) {
    return ThrowError(res, 500, error.message);
  }
}