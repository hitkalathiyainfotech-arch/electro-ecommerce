import mongoose from "mongoose";
import comboModel from "../models/combo.model.js";
import Product from "../models/product.model.js";
import { sendBadRequestResponse, sendErrorResponse, sendNotFoundResponse, sendSuccessResponse, sendCreatedResponse } from "../utils/response.utils.js";

export const createCombo = async (req, res) => {
  try {
    const sellerId = req.user?._id;
    const { title, description, products, originalPrice, discountPrice } = req.body;

    if (!title || !products || !originalPrice || !discountPrice) {
      return sendBadRequestResponse(res, "title, products, originalPrice and discountPrice are required");
    }

    let parsedProducts = products;
    if (typeof products === "string") {
      try {
        parsedProducts = JSON.parse(products);
      } catch (err) {
        return sendBadRequestResponse(res, "Invalid products payload. Send as JSON array or object");
      }
    }

    if (!Array.isArray(parsedProducts) || parsedProducts.length === 0) {
      return sendBadRequestResponse(res, "At least one product required in combo");
    }

    // validate product ids
    const productIds = parsedProducts.map(p => p.product).filter(Boolean);
    if (!productIds.every(id => mongoose.Types.ObjectId.isValid(id))) {
      return sendBadRequestResponse(res, "One or more product IDs are invalid");
    }

    const foundProducts = await Product.find({ _id: { $in: productIds } }).lean();
    if (foundProducts.length !== productIds.length) {
      return sendNotFoundResponse(res, "Some products not found");
    }


    // if seller created, ensure ownership
    if (req.user?.role === "seller") {
      const notOwned = foundProducts.filter(p => p.sellerId.toString() !== sellerId.toString());
      if (notOwned.length > 0) return sendBadRequestResponse(res, "You can only add your own products to a combo");
    }

    const comboData = {
      title,
      description: description || "",
      products: parsedProducts,
      originalPrice,
      discountPrice,
      createdBy: sellerId
    };

    const newCombo = await comboModel.create(comboData);

    return sendCreatedResponse(res, "Combo created successfully", newCombo);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getAllCombos = async (req, res) => {
  try {
    const combos = await comboModel.find({ isActive: true })
      .populate({
        path: "products.product",
        populate: [
          { path: "brand", select: "-categories -sellerId -__v -updatedAt -createdAt" },
          { path: "categories", select: "-__v -createdAt -updatedAt " },
          { path: "variantId" }
        ]
      })
      .populate({
        path: "products.variant",
        model: "productVariant"
      })
      .populate("createdBy", "firstName email avatar");

    return sendSuccessResponse(res, "Combos fetched successfully", {
      total: combos.length,
      combos
    } || []);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};


export const getComboById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequestResponse(res, "Invalid combo ID");

    const combo = await comboModel.findById(id)
      .populate({
        path: "products.product",
        populate: [
          { path: "brand", select: "-categories -sellerId -__v -updatedAt -createdAt" },
          { path: "categories", select: "-__v -createdAt -updatedAt " },
          { path: "variantId" }
        ]
      })
      .populate({
        path: "products.variant",
        model: "productVariant"
      })
      .populate("createdBy", "firstName email avatar");

    if (!combo) return sendNotFoundResponse(res, "Combo not found");

    return sendSuccessResponse(res, "Combo fetched successfully", {
      total: combos.length,
      combo
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getSellerCombos = async (req, res) => {
  try {
    const sellerId = req.user?._id;
    const combos = await comboModel.find({ createdBy: sellerId })
      .populate({
        path: "products.product",
        populate: [
          { path: "brand", select: "-categories -sellerId -__v -updatedAt -createdAt" },
          { path: "categories", select: "-__v -createdAt -updatedAt " },
          { path: "variantId" }
        ]
      })
      .populate({
        path: "products.variant",
        model: "productVariant"
      })
      .populate("createdBy", "firstName email avatar")
      .sort({ createdAt: -1 });
    return sendSuccessResponse(res, "Seller combos fetched", {
      total: combos.length,
      combos
    } || []);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const updateCombo = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequestResponse(res, "Invalid combo ID");

    const combo = await comboModel.findById(id);
    if (!combo) return sendNotFoundResponse(res, "Combo not found");

    const userId = req.user?._id;
    if (req.user?.role === "seller" && combo.createdBy.toString() !== userId.toString()) {
      return sendBadRequestResponse(res, "You can only update your own combos");
    }

    const updates = req.body;
    // If products sent as stringified JSON
    if (typeof updates.products === "string") {
      try { updates.products = JSON.parse(updates.products); } catch (e) { }
    }

    Object.keys(updates).forEach(k => {
      combo[k] = updates[k];
    });

    await combo.save();

    return sendSuccessResponse(res, "Combo updated successfully", combo);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const deleteCombo = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequestResponse(res, "Invalid combo ID");

    const combo = await comboModel.findById(id);
    if (!combo) return sendNotFoundResponse(res, "Combo not found");

    const userId = req.user?._id;
    if (req.user?.role === "seller" && combo.createdBy.toString() !== userId.toString()) {
      return sendBadRequestResponse(res, "You can only delete your own combos");
    }

    await comboModel.findByIdAndDelete(id);
    return sendSuccessResponse(res, "Combo deleted successfully", combo);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const toggleComboActive = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequestResponse(res, "Invalid combo ID");

    const combo = await comboModel.findById(id);
    if (!combo) return sendNotFoundResponse(res, "Combo not found");

    const userId = req.user?._id;
    if (req.user?.role === "seller" && combo.createdBy.toString() !== userId.toString()) {
      return sendBadRequestResponse(res, "You can only change your own combos");
    }

    combo.isActive = !combo.isActive;
    await combo.save();

    return sendSuccessResponse(res, `Combo ${combo.isActive ? 'activated' : 'deactivated'} successfully`, combo);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

// Basic apply endpoint: returns computed saving for the combo
export const applyCombo = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return sendBadRequestResponse(res, "Invalid combo ID");

    const combo = await comboModel.findById(id).lean();
    if (!combo) return sendNotFoundResponse(res, "Combo not found");

    if (!combo.isActive) return sendBadRequestResponse(res, "Combo is not active");

    const result = {
      comboId: combo._id,
      title: combo.title,
      originalPrice: combo.originalPrice,
      discountPrice: combo.discountPrice,
      saving: combo.originalPrice - combo.discountPrice
    };

    return sendSuccessResponse(res, "Combo applied", result);
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};

export const getProductSellerCombos = async (req, res) => {
  try {
    const { productId } = req.params;

    if (!productId) return sendBadRequestResponse(res, "productId is required");
    if (!mongoose.Types.ObjectId.isValid(productId))
      return sendBadRequestResponse(res, "Invalid productId");

    const product = await Product.findById(productId).lean();
    if (!product) return sendNotFoundResponse(res, "Product not found");

    const sellerId = product.sellerId;

    const combos = await comboModel
      .find({ createdBy: sellerId, isActive: true })
      .populate({
        path: "products.product",
        model: "product",
        populate: [
          { path: "brand" },
          { path: "categories" },
          { path: "variantId" }
        ]
      })
      .populate({
        path: "products.variant",
        model: "productVariant"
      })
      .populate("createdBy", "firstName email avatar")
      .lean();     // <---- lean goes AFTER all populates

    return sendSuccessResponse(res, "Seller combos fetched for product", {
      total: combos.length,
      combos
    });
  } catch (error) {
    return sendErrorResponse(res, 500, error.message);
  }
};


export default {
  createCombo,
  getAllCombos,
  getComboById,
  getSellerCombos,
  updateCombo,
  deleteCombo,
  toggleComboActive,
  applyCombo,
  getProductSellerCombos
};
